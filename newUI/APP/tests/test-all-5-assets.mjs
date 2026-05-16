/**
 * Test all 5 asset types issuance with local signing.
 * 
 * Asset types:
 * 1. ROOT - Standard fungible token
 * 2. SUB - Sub-asset of a ROOT (name with #)
 * 3. UNIQUE - NFT (quantity=1, units=0, not reissuable)
 * 4. QUALIFIER - Qualifier for restricted transfers (1-10 PHI, units=0, not reissuable)
 * 5. RESTRICTED - Restricted transfer asset (name with $)
 */

import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import * as nobleSecp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { hmac } from '@noble/hashes/hmac';
import { base58 } from '@scure/base';

const hmacSha256 = (key, ...msgs) => {
  const data = new Uint8Array(msgs.reduce((s, m) => s + m.length, 0));
  let off = 0;
  for (const m of msgs) { data.set(m, off); off += m.length; }
  return hmac(sha256, data, key);
};
nobleSecp.utils.hmacSha256Sync = hmacSha256;

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToArray(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}
function concatBytes(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}
function hash160(data) { return ripemd160(sha256(data)); }
function writeVarInt(n) {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) { const b = new Uint8Array(3); b[0] = 0xfd; new DataView(b.buffer).setUint16(1, n, true); return b; }
  const b = new Uint8Array(5); b[0] = 0xfe; new DataView(b.buffer).setUint32(1, n, true); return b;
}
function readVarInt(b, o) {
  if (b[o] < 0xfd) return { value: b[o], size: 1 };
  if (b[o] === 0xfd) return { value: b[o+1] | (b[o+2] << 8), size: 3 };
  if (b[o] === 0xfe) return { value: b[o+1] | (b[o+2] << 8) | (b[o+3] << 16) | (b[o+4] << 24), size: 5 };
  return { value: 0, size: 9 };
}
function writeVarString(str) {
  const bytes = new TextEncoder().encode(str);
  const result = new Uint8Array(1 + bytes.length);
  result[0] = bytes.length;
  result.set(bytes, 1);
  return result;
}
function writeInt64(value) {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigInt64(0, BigInt(value), true);
  return buf;
}
function writeInt8(value) { return new Uint8Array([value & 0xff]); }

async function rpcCall(method, params = []) {
  const auth = Buffer.from('phi:phi').toString('base64');
  const resp = await fetch('http://127.0.0.1:28966/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
    body: JSON.stringify({ jsonrpc: '1.0', method, params, id: 1 }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`RPC ${method} error ${data.error.code}: ${data.error.message.substring(0, 300)}`);
  return data.result;
}

// Sighash + signing functions (matching txSigner.ts)
function sighashLegacyP2PKH(tx, inputIndex, scriptCode, hashType = 0x01) {
  const parts = [];
  const vBuf = new Uint8Array(4); new DataView(vBuf.buffer).setInt32(0, tx.version, true); parts.push(vBuf);
  parts.push(writeVarInt(tx.inputs.length));
  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    parts.push(hexToArray(inp.prevTxId));
    const vb = new Uint8Array(4); new DataView(vb.buffer).setUint32(0, inp.vout, true); parts.push(vb);
    if (i === inputIndex) { parts.push(writeVarInt(scriptCode.length)); parts.push(scriptCode); }
    else parts.push(writeVarInt(0));
    const sb = new Uint8Array(4); new DataView(sb.buffer).setUint32(0, inp.sequence, true); parts.push(sb);
  }
  parts.push(writeVarInt(tx.outputs.length));
  for (const out of tx.outputs) {
    const valBuf = new Uint8Array(8); new DataView(valBuf.buffer).setBigInt64(0, out.value, true); parts.push(valBuf);
    parts.push(writeVarInt(out.scriptPubKey.length)); parts.push(out.scriptPubKey);
  }
  const ltBuf = new Uint8Array(4); new DataView(ltBuf.buffer).setUint32(0, tx.locktime, true); parts.push(ltBuf);
  const shBuf = new Uint8Array(4); new DataView(shBuf.buffer).setUint32(0, hashType, true); parts.push(shBuf);
  return sha256(sha256(concatBytes(...parts)));
}

function parseRawTx(rawHex) {
  const bytes = hexToArray(rawHex);
  let offset = 0;
  const version = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true); offset += 4;
  const inLen = readVarInt(bytes, offset); offset += inLen.size;
  const inputs = [];
  for (let i = 0; i < inLen.value; i++) {
    const prevTxId = toHex(bytes.slice(offset, offset + 32)); offset += 32;
    const vout = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true); offset += 4;
    const sLen = readVarInt(bytes, offset); offset += sLen.size;
    const scriptSig = bytes.slice(offset, offset + sLen.value); offset += sLen.value;
    const sequence = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true); offset += 4;
    inputs.push({ prevTxId, vout, scriptSig, sequence });
  }
  const outLen = readVarInt(bytes, offset); offset += outLen.size;
  const outputs = [];
  for (let i = 0; i < outLen.value; i++) {
    const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigInt64(0, true); offset += 8;
    const sLen = readVarInt(bytes, offset); offset += sLen.size;
    const scriptPubKey = bytes.slice(offset, offset + sLen.value); offset += sLen.value;
    outputs.push({ value, scriptPubKey });
  }
  const locktime = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
  return { version, inputs, outputs, locktime };
}

function buildRawTxHex(tx) {
  const parts = [];
  const vBuf = new Uint8Array(4); new DataView(vBuf.buffer).setInt32(0, tx.version, true); parts.push(vBuf);
  parts.push(writeVarInt(tx.inputs.length));
  for (const inp of tx.inputs) {
    parts.push(hexToArray(inp.prevTxId));
    const vb = new Uint8Array(4); new DataView(vb.buffer).setUint32(0, inp.vout, true); parts.push(vb);
    parts.push(writeVarInt(inp.scriptSig.length)); parts.push(inp.scriptSig);
    const sb = new Uint8Array(4); new DataView(sb.buffer).setUint32(0, inp.sequence, true); parts.push(sb);
  }
  parts.push(writeVarInt(tx.outputs.length));
  for (const out of tx.outputs) {
    const valBuf = new Uint8Array(8); new DataView(valBuf.buffer).setBigInt64(0, out.value, true); parts.push(valBuf);
    parts.push(writeVarInt(out.scriptPubKey.length)); parts.push(out.scriptPubKey);
  }
  const ltBuf = new Uint8Array(4); new DataView(ltBuf.buffer).setUint32(0, tx.locktime, true); parts.push(ltBuf);
  return toHex(concatBytes(...parts));
}

function buildRawTransaction(inputs, outputs, locktime = 0) {
  const parts = [];
  const version = new Uint8Array(4); new DataView(version.buffer).setInt32(0, 2, true); parts.push(version);
  parts.push(writeVarInt(inputs.length));
  for (const inp of inputs) {
    const txidBytesOrig = hexToArray(inp.txid);
    const txidBytes = new Uint8Array(32);
    for (let j = 0; j < 32; j++) txidBytes[j] = txidBytesOrig[31 - j];
    parts.push(txidBytes);
    const vout = new Uint8Array(4); new DataView(vout.buffer).setUint32(0, inp.vout, true); parts.push(vout);
    parts.push(writeVarInt(0)); parts.push(new Uint8Array(0));
    const seq = new Uint8Array(4); new DataView(seq.buffer).setUint32(0, inp.sequence ?? 0xffffffff, true); parts.push(seq);
  }
  parts.push(writeVarInt(outputs.length));
  for (const out of outputs) {
    const value = new Uint8Array(8); new DataView(value.buffer).setBigInt64(0, BigInt(out.valueSatoshis), true); parts.push(value);
    const script = hexToArray(out.scriptPubKey); parts.push(writeVarInt(script.length)); parts.push(script);
  }
  const locktimeBytes = new Uint8Array(4); new DataView(locktimeBytes.buffer).setUint32(0, locktime, true); parts.push(locktimeBytes);
  return toHex(concatBytes(...parts));
}

function signRawTransaction(rawTxHex, signingInputs) {
  const tx = parseRawTx(rawTxHex);
  if (tx.inputs.length !== signingInputs.length) return null;
  const signedInputs = tx.inputs.map((inp, i) => {
    const si = signingInputs[i];
    const sighash = sighashLegacyP2PKH(tx, i, si.scriptPubKey);
    const sig = nobleSecp.signSync(toHex(sighash), toHex(si.privateKey), { der: true });
    const pubkey = nobleSecp.getPublicKey(toHex(si.privateKey), true);
    const sigData = new Uint8Array(sig.length + 1);
    sigData.set(sig); sigData[sig.length] = 0x01;
    const parts = [writeVarInt(sigData.length), sigData, writeVarInt(pubkey.length), pubkey];
    const scriptSig = concatBytes(...parts);
    return { prevTxId: inp.prevTxId, vout: inp.vout, scriptSig, sequence: inp.sequence };
  });
  return buildRawTxHex({ version: tx.version, inputs: signedInputs, outputs: tx.outputs, locktime: tx.locktime });
}

// ---- Asset script builders ----

const OP_PHI_ASSET = 0xc0;
const OP_DROP = 0x61;
const OP_RESERVED = 0x50;
const MAGIC_NEW = new Uint8Array([0x72, 0x76, 0x6e, 0x71]); // rvnq
const MAGIC_OWNER = new Uint8Array([0x72, 0x76, 0x6e, 0x6f]); // rvno
const MAGIC_TRANSFER = new Uint8Array([0x72, 0x76, 0x6e, 0x74]); // rvnt

// Build: P2PKH + OP_PHI_ASSET + dataLen + payload + OP_DROP
function buildAssetScriptWithP2PKH(p2pkhHex, magic, data) {
  const payload = concatBytes(magic, data);
  const script = p2pkhHex + 'c0' + payload.length.toString(16).padStart(2, '0') + toHex(payload) + '61';
  return script;
}

function serializeCNewAsset(name, amount, units, reissuable, hasIPFS) {
  return concatBytes(
    writeVarString(name),
    writeInt64(amount),
    writeInt8(units),
    writeInt8(reissuable),
    writeInt8(hasIPFS),
  );
}

function serializeCAssetTransfer(name, amount, message = '') {
  return concatBytes(writeVarString(name), writeInt64(amount), writeVarString(message));
}

function serializeCNullAssetTxVerifierString(verifier) {
  return concatBytes(writeVarString(verifier));
}

// ---- Asset issuance functions ----

const BURN_ADDR_SCRIPT = '76a9148684a6449c157dd0a2f393fc5147e47cd4fd9f2588ac';

async function issueAsset(name, amountPhi, units, reissuable, changeScript, selected, foundPk) {
  const amountSat = Math.floor(amountPhi * 1e8);
  const feeSat = 500000;
  const burnAmount = Math.floor(0.1 * 1e8);
  const changeValue = selected.satoshis - feeSat - burnAmount;

  const outputs = [];
  if (changeValue > 546) outputs.push({ scriptPubKey: changeScript, valueSatoshis: changeValue });
  outputs.push({ scriptPubKey: BURN_ADDR_SCRIPT, valueSatoshis: burnAmount });

  // Owner token (rvno) - second to last
  const ownerNameBytes = new TextEncoder().encode(name + '!');
  const ownerDataBuf = new Uint8Array(1 + ownerNameBytes.length);
  ownerDataBuf[0] = ownerNameBytes.length;
  ownerDataBuf.set(ownerNameBytes, 1);
  const ownerPayload = new Uint8Array(4 + ownerDataBuf.length);
  ownerPayload.set(MAGIC_OWNER, 0); ownerPayload.set(ownerDataBuf, 4);
  const ownerScript = changeScript + 'c0' + ownerPayload.length.toString(16).padStart(2, '0') + toHex(ownerPayload) + '61';
  outputs.push({ scriptPubKey: ownerScript, valueSatoshis: 0 });

  // Issue asset (rvnq) - last
  const assetData = serializeCNewAsset(name, amountSat, units, reissuable ? 1 : 0, 0);
  const issuePayload = new Uint8Array(4 + assetData.length);
  issuePayload.set(MAGIC_NEW, 0); issuePayload.set(assetData, 4);
  const issueScript = changeScript + 'c0' + issuePayload.length.toString(16).padStart(2, '0') + toHex(issuePayload) + '61';
  outputs.push({ scriptPubKey: issueScript, valueSatoshis: 0 });

  const rawTxHex = buildRawTransaction([{ txid: selected.txid, vout: selected.outputIndex }], outputs);
  const signedHex = signRawTransaction(rawTxHex, [{ txid: selected.txid, vout: selected.outputIndex, scriptPubKey: hexToArray(selected.script), privateKey: foundPk }]);
  if (!signedHex) throw new Error('Signing failed');

  const mempool = await rpcCall('testmempoolaccept', [[signedHex], false]);
  if (!mempool[0].allowed) {
    throw new Error(`Mempool rejected: ${mempool[0]['reject-reason']}`);
  }
  return await rpcCall('sendrawtransaction', [signedHex, true]);
}

async function issueSubAsset(rootName, changeScript, selected, foundPk) {
  // First issue ROOT
  const rootTxid = await issueAsset(rootName, 100000, 8, true, changeScript, selected, foundPk);
  console.log(`  ROOT "${rootName}" issued for SUB! txid: ${rootTxid}`);
  return rootTxid;
}

async function issueSubOnly(rootName, subName, changeScript, selected, foundPk) {
  // SUB needs: burn + ROOT owner transfer (rvnt) + owner token (rvno) + issue (rvnq)
  const feeSat = 500000;
  const burnAmount = Math.floor(0.1 * 1e8);
  const changeValue = selected.satoshis - feeSat - burnAmount;

  const outputs = [];
  if (changeValue > 546) outputs.push({ scriptPubKey: changeScript, valueSatoshis: changeValue });
  outputs.push({ scriptPubKey: BURN_ADDR_SCRIPT, valueSatoshis: burnAmount });

  // ROOT owner transfer (rvnt) - sends ROOTNAME! back to self
  const rootOwnerName = rootName + '!';
  const transferData = serializeCAssetTransfer(rootOwnerName, 1);
  const transferPayload = new Uint8Array(4 + transferData.length);
  transferPayload.set(MAGIC_TRANSFER, 0); transferPayload.set(transferData, 4);
  const transferScript = changeScript + 'c0' + transferPayload.length.toString(16).padStart(2, '0') + toHex(transferPayload) + '61';
  outputs.push({ scriptPubKey: transferScript, valueSatoshis: 0 });

  // Owner token (rvno) - second to last
  const ownerNameBytes = new TextEncoder().encode(subName + '!');
  const ownerDataBuf = new Uint8Array(1 + ownerNameBytes.length);
  ownerDataBuf[0] = ownerNameBytes.length;
  ownerDataBuf.set(ownerNameBytes, 1);
  const ownerPayload = new Uint8Array(4 + ownerDataBuf.length);
  ownerPayload.set(MAGIC_OWNER, 0); ownerPayload.set(ownerDataBuf, 4);
  const ownerScript = changeScript + 'c0' + ownerPayload.length.toString(16).padStart(2, '0') + toHex(ownerPayload) + '61';
  outputs.push({ scriptPubKey: ownerScript, valueSatoshis: 0 });

  // Issue asset (rvnq) - last
  const assetData = serializeCNewAsset(subName, Math.floor(50000 * 1e8), 8, true, 0);
  const issuePayload = new Uint8Array(4 + assetData.length);
  issuePayload.set(MAGIC_NEW, 0); issuePayload.set(assetData, 4);
  const issueScript = changeScript + 'c0' + issuePayload.length.toString(16).padStart(2, '0') + toHex(issuePayload) + '61';
  outputs.push({ scriptPubKey: issueScript, valueSatoshis: 0 });

  const rawTxHex = buildRawTransaction([{ txid: selected.txid, vout: selected.outputIndex }], outputs);
  const signedHex = signRawTransaction(rawTxHex, [{ txid: selected.txid, vout: selected.outputIndex, scriptPubKey: hexToArray(selected.script), privateKey: foundPk }]);
  if (!signedHex) throw new Error('Signing failed');

  const mempool = await rpcCall('testmempoolaccept', [[signedHex], false]);
  if (!mempool[0].allowed) {
    throw new Error(`Mempool rejected: ${mempool[0]['reject-reason']}`);
  }
  return await rpcCall('sendrawtransaction', [signedHex, true]);
}

async function issueUnique(rootName, tags, changeScript, selected, foundPk) {
  // Each unique costs 5 PHI burn
  const burnPerUnique = 5 * 1e8;
  const feeSat = 1000000;
  const totalBurn = burnPerUnique * tags.length;
  const changeValue = selected.satoshis - feeSat - totalBurn;

  const outputs = [];
  if (changeValue > 546) outputs.push({ scriptPubKey: changeScript, valueSatoshis: changeValue });

  // Burn output
  outputs.push({ scriptPubKey: BURN_ADDR_SCRIPT, valueSatoshis: totalBurn });

  // ROOT owner token transfer (rvnt magic) - sends ROOTNAME! back to self
  const rootOwnerName = rootName + '!';
  const transferData = serializeCAssetTransfer(rootOwnerName, 1);
  const transferPayload = new Uint8Array(4 + transferData.length);
  transferPayload.set(MAGIC_TRANSFER, 0); transferPayload.set(transferData, 4);
  const transferScript = changeScript + 'c0' + transferPayload.length.toString(16).padStart(2, '0') + toHex(transferPayload) + '61';
  outputs.push({ scriptPubKey: transferScript, valueSatoshis: 0 });

  // For each tag, create an issue output (UNIQUE: amount=1COIN, units=0, reissuable=0)
  // nOwners must be 0, so NO owner token data outputs
  for (const tag of tags) {
    const fullName = `${rootName}#${tag}`;

    const assetData = serializeCNewAsset(fullName, 1e8, 0, 0, 0);
    const issuePayload = new Uint8Array(4 + assetData.length);
    issuePayload.set(MAGIC_NEW, 0); issuePayload.set(assetData, 4);
    const issueScript = changeScript + 'c0' + issuePayload.length.toString(16).padStart(2, '0') + toHex(issuePayload) + '61';
    outputs.push({ scriptPubKey: issueScript, valueSatoshis: 0 });
  }

  const rawTxHex = buildRawTransaction([{ txid: selected.txid, vout: selected.outputIndex }], outputs);
  const signedHex = signRawTransaction(rawTxHex, [{ txid: selected.txid, vout: selected.outputIndex, scriptPubKey: hexToArray(selected.script), privateKey: foundPk }]);
  if (!signedHex) throw new Error('Signing failed');

  const mempool = await rpcCall('testmempoolaccept', [[signedHex], false]);
  if (!mempool[0].allowed) {
    throw new Error(`Mempool rejected: ${mempool[0]['reject-reason']}`);
  }
  return await rpcCall('sendrawtransaction', [signedHex, true]);
}

async function issueQualifierAsset(name, amount, changeScript, selected, foundPk) {
  const feeSat = 500000;
  const burnAmount = Math.floor(0.1 * 1e8);
  const changeValue = selected.satoshis - feeSat - burnAmount;

  const outputs = [];
  if (changeValue > 546) outputs.push({ scriptPubKey: changeScript, valueSatoshis: changeValue });
  outputs.push({ scriptPubKey: BURN_ADDR_SCRIPT, valueSatoshis: burnAmount });

  // QUALIFIER has NO owner token (nOwners must be 0 in GetTxOutAssetTypes)
  // Issue (QUALIFIER: amount 1*COIN to 10*COIN, units=0, reissuable=0)
  const assetData = serializeCNewAsset(name, amount, 0, 0, 0);
  const issuePayload = new Uint8Array(4 + assetData.length);
  issuePayload.set(MAGIC_NEW, 0); issuePayload.set(assetData, 4);
  const issueScript = changeScript + 'c0' + issuePayload.length.toString(16).padStart(2, '0') + toHex(issuePayload) + '61';
  outputs.push({ scriptPubKey: issueScript, valueSatoshis: 0 });

  const rawTxHex = buildRawTransaction([{ txid: selected.txid, vout: selected.outputIndex }], outputs);
  const signedHex = signRawTransaction(rawTxHex, [{ txid: selected.txid, vout: selected.outputIndex, scriptPubKey: hexToArray(selected.script), privateKey: foundPk }]);
  if (!signedHex) throw new Error('Signing failed');

  const mempool = await rpcCall('testmempoolaccept', [[signedHex], false]);
  if (!mempool[0].allowed) {
    throw new Error(`Mempool rejected: ${mempool[0]['reject-reason']}`);
  }
  return await rpcCall('sendrawtransaction', [signedHex, true]);
}

async function issueRestrictedAsset(name, amountPhi, units, reissuable, verifierString, changeScript, selected, foundPk) {
  // name starts with $, e.g. "$EPSILON123"
  // stripped root = name without $, e.g. "EPSILON123"
  const strippedRoot = name.startsWith('$') ? name.substring(1) : name;
  
  // First issue ROOT
  const rootTxid = await issueAsset(strippedRoot, 100000, 8, true, changeScript, selected, foundPk);
  console.log(`  ROOT "${strippedRoot}" issued for RESTRICTED! txid: ${rootTxid}`);
  return rootTxid;
}

async function issueRestrictedOnly(name, amountPhi, units, reissuable, verifierString, changeScript, selected, foundPk) {
  const amountSat = Math.floor(amountPhi * 1e8);
  const feeSat = 500000;
  const burnAmount = Math.floor(0.2 * 1e8); // 0.2 PHI for restricted
  const changeValue = selected.satoshis - feeSat - burnAmount;

  const outputs = [];
  if (changeValue > 546) outputs.push({ scriptPubKey: changeScript, valueSatoshis: changeValue });

  // Burn output
  outputs.push({ scriptPubKey: BURN_ADDR_SCRIPT, valueSatoshis: burnAmount });

  // strippedRoot! owner token transfer (rvnt magic) - sends ROOT! back to self
  const strippedRoot = name.startsWith('$') ? name.substring(1) : name;
  const rootOwnerName = strippedRoot + '!';
  const transferData = serializeCAssetTransfer(rootOwnerName, 1);
  const transferPayload = new Uint8Array(4 + transferData.length);
  transferPayload.set(MAGIC_TRANSFER, 0); transferPayload.set(transferData, 4);
  const transferScript = changeScript + 'c0' + transferPayload.length.toString(16).padStart(2, '0') + toHex(transferPayload) + '61';
  outputs.push({ scriptPubKey: transferScript, valueSatoshis: 0 });

  // Verifier string output (OP_PHI_ASSET + OP_RESERVED + verifier data)
  const verifierData = serializeCNullAssetTxVerifierString(verifierString);
  const verifierScript = 'c050' + toHex(verifierData);
  outputs.push({ scriptPubKey: verifierScript, valueSatoshis: 0 });

  // Issue asset (rvnq) - last
  const assetData = serializeCNewAsset(name, amountSat, units, reissuable ? 1 : 0, 0);
  const issuePayload = new Uint8Array(4 + assetData.length);
  issuePayload.set(MAGIC_NEW, 0); issuePayload.set(assetData, 4);
  const issueScript = changeScript + 'c0' + issuePayload.length.toString(16).padStart(2, '0') + toHex(issuePayload) + '61';
  outputs.push({ scriptPubKey: issueScript, valueSatoshis: 0 });

  const rawTxHex = buildRawTransaction([{ txid: selected.txid, vout: selected.outputIndex }], outputs);
  const signedHex = signRawTransaction(rawTxHex, [{ txid: selected.txid, vout: selected.outputIndex, scriptPubKey: hexToArray(selected.script), privateKey: foundPk }]);
  if (!signedHex) throw new Error('Signing failed');

  const mempool = await rpcCall('testmempoolaccept', [[signedHex], false]);
  if (!mempool[0].allowed) {
    throw new Error(`Mempool rejected: ${mempool[0]['reject-reason']}`);
  }
  return await rpcCall('sendrawtransaction', [signedHex, true]);
}

// ---- Main ----

async function main() {
  const PUB_KEY_HASH = 0x38;
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const seed = mnemonicToSeedSync(mnemonic, '');
  const hdKey = HDKey.fromMasterSeed(seed);

  function deriveAddr(hdKey, path) {
    const d = hdKey.derive(path);
    const pk = d.publicKey;
    const comp = pk.length === 33 ? pk : new Uint8Array([pk[64]&1 ? 0x03:0x02, ...pk.slice(1,33)]);
    const h = hash160(comp);
    const p = new Uint8Array(21); p[0] = PUB_KEY_HASH; p.set(h,1);
    const c = sha256(sha256(p)).slice(0,4);
    return base58.encode(concatBytes(p,c));
  }

  const addr = deriveAddr(hdKey, "m/0'/0'/0'/0/0");
  console.log('Wallet address:', addr);

  // Find UTXO
  const utxos = await rpcCall('getaddressutxos', [{ addresses: [addr] }]);
  console.log('UTXO count:', Array.isArray(utxos) ? utxos.length : (utxos.utxos ? utxos.utxos.length : 1));

  let utxoList = [];
  if (Array.isArray(utxos)) {
    utxoList = utxos;
  } else if (utxos.utxos) {
    utxoList = utxos.utxos;
  } else {
    utxoList = [utxos];
  }

  if (utxoList.length === 0) {
    console.log('No UTXOs found!');
    return;
  }

  utxoList.sort((a, b) => b.satoshis - a.satoshis);
  const selected = utxoList[0];
  const changeScript = selected.script;
  const foundPk = hdKey.derive("m/0'/0'/0'/0/0").privateKey;

  const ts = Date.now().toString().slice(-6);

  // Results tracking
  const results = {};

  // Track spent UTXOs to avoid double-spends
  const spentTxids = new Set();

  // Helper to refresh UTXO selection
  async function refreshUTXO(minSat = 5000000) {
    const utxos = await rpcCall('getaddressutxos', [{ addresses: [addr] }]);
    let u = [];
    if (Array.isArray(utxos)) u = utxos;
    else if (utxos.utxos) u = utxos.utxos;
    else u = [utxos];
    u.sort((a, b) => b.satoshis - a.satoshis);
    const s = u.find(x => x.satoshis > minSat && !spentTxids.has(x.txid));
    if (!s) throw new Error('No sufficient UTXO available. UTXOs: ' + u.map(x => `${x.txid} sat:${x.satoshis} conf:${x.confirmations}`).join(', '));
    return s;
  }

  // Helper to mark UTXO as spent and broadcast
  async function spendUTXO(selected, issueFn) {
    spentTxids.add(selected.txid);
    return issueFn();
  }

  // ========================================
  // 1. ROOT Asset
  // ========================================
  console.log('\n========== 1. ROOT Asset ==========');
  try {
    const rootName = `ALPHA${ts}`;
    spentTxids.add(selected.txid);
    const txid = await issueAsset(rootName, 100000, 8, true, changeScript, selected, foundPk);
    console.log(`ROOT "${rootName}" issued! txid: ${txid}`);
    results.ROOT = { name: rootName, txid, status: 'SUCCESS' };
  } catch(e) {
    console.log(`ROOT FAILED: ${e.message.substring(0, 300)}`);
    results.ROOT = { status: 'FAILED', error: e.message.substring(0, 300) };
  }

  // ========================================
  // 2. SUB Asset (under ROOT)
  // ========================================
  console.log('\n========== 2. SUB Asset ==========');
  try {
    const s2 = await refreshUTXO();
    const rootName = `BETA${ts}`;
    await issueSubAsset(rootName, changeScript, s2, foundPk);
    const s2b = await refreshUTXO();
    const subName = `${rootName}#ALPHA`;
    const txid = await issueSubOnly(rootName, subName, changeScript, s2b, foundPk);
    console.log(`SUB "${subName}" issued! txid: ${txid}`);
    results.SUB = { name: subName, txid, status: 'SUCCESS' };
  } catch(e) {
    console.log(`SUB FAILED: ${e.message.substring(0, 300)}`);
    results.SUB = { status: 'FAILED', error: e.message.substring(0, 300) };
  }

  // ========================================
  // 3. UNIQUE Asset (NFT under ROOT)
  // ========================================
  console.log('\n========== 3. UNIQUE Asset ==========');
  try {
    const s3 = await refreshUTXO();
    const rootName = `GAMMA${ts}`;
    await issueSubAsset(rootName, changeScript, s3, foundPk);
    const s3b = await refreshUTXO();
    const tags = [`first${ts}`];
    const txid = await issueUnique(rootName, tags, changeScript, s3b, foundPk);
    console.log(`UNIQUE under "${rootName}" issued! txid: ${txid}`);
    results.UNIQUE = { name: rootName, tags, txid, status: 'SUCCESS' };
  } catch(e) {
    console.log(`UNIQUE FAILED: ${e.message.substring(0, 300)}`);
    results.UNIQUE = { status: 'FAILED', error: e.message.substring(0, 300) };
  }

  // ========================================
  // 4. QUALIFIER Asset (amount: 1*COIN to 10*COIN, units=0, name starts with #)
  // ========================================
  console.log('\n========== 4. QUALIFIER Asset ==========');
  try {
    const s4 = await refreshUTXO();
    const qualName = `#DELTA${ts}`; // Must start with #
    const amount = 100000000; // 1 * COIN = 1 PHI in base units
    const txid = await issueQualifierAsset(qualName, amount, changeScript, s4, foundPk);
    console.log(`QUALIFIER "${qualName}" issued! txid: ${txid}`);
    results.QUALIFIER = { name: qualName, txid, status: 'SUCCESS' };
  } catch(e) {
    console.log(`QUALIFIER FAILED: ${e.message.substring(0, 300)}`);
    results.QUALIFIER = { status: 'FAILED', error: e.message.substring(0, 300) };
  }

  // ========================================
  // 5. RESTRICTED Asset
  // ========================================
  console.log('\n========== 5. RESTRICTED Asset ==========');
  try {
    const s5 = await refreshUTXO();
    const restName = `$EPSILON${ts}`;
    await issueRestrictedAsset(restName, 100000, 8, true, 'verifier-test', changeScript, s5, foundPk);
    const s5b = await refreshUTXO();
    const txid = await issueRestrictedOnly(restName, 200000, 8, true, 'verifier-test', changeScript, s5b, foundPk);
    console.log(`RESTRICTED "${restName}" issued! txid: ${txid}`);
    results.RESTRICTED = { name: restName, txid, status: 'SUCCESS' };
  } catch(e) {
    console.log(`RESTRICTED FAILED: ${e.message.substring(0, 300)}`);
    results.RESTRICTED = { status: 'FAILED', error: e.message.substring(0, 300) };
  }

  // ========================================
  // Summary
  // ========================================
  console.log('\n========================================');
  console.log('         ASSET ISSUE SUMMARY');
  console.log('========================================');
  for (const [type, result] of Object.entries(results)) {
    const icon = result.status === 'SUCCESS' ? '[OK]' : '[FAIL]';
    console.log(`${icon} ${type}: ${result.name || ''} ${result.status === 'SUCCESS' ? `(txid: ${result.txid})` : result.error}`);
  }
  const successCount = Object.values(results).filter(r => r.status === 'SUCCESS').length;
  console.log(`\nTotal: ${successCount}/${Object.keys(results).length} passed`);
}

main().catch(e => console.error('Fatal:', e.message));
