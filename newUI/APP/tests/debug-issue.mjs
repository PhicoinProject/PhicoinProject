/** Debug asset issuance - compare frontend vs CLI script outputs */

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

const OP_PHI_ASSET = 0xc0;
const OP_DROP = 0x61;
const BURN_ADDR_SCRIPT = '76a9148684a6449c157dd0a2f393fc5147e47cd4fd9f2588ac';
const PUB_KEY_HASH = 0x38;

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

async function main() {
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

  const utxos = await rpcCall('getaddressutxos', [{ addresses: [addr] }]);
  let utxoList = Array.isArray(utxos) ? utxos : (utxos.utxos ? utxos.utxos : [utxos]);
  utxoList.sort((a, b) => b.satoshis - a.satoshis);
  const sel = utxoList[0];
  const changeScript = sel.script;
  const foundPk = hdKey.derive("m/0'/0'/0'/0'/0/0").privateKey;

  const ts = Date.now().toString().slice(-6);
  const assetName = `DEBUG${ts}`;
  const quantity = Math.floor(100000 * 1e8);
  const burnAmount = Math.floor(0.1 * 1e8);
  const feeSat = 500000;
  const changeValue = sel.satoshis - feeSat - burnAmount;

  console.log(`\nBuilding issue for "${assetName}" (amount=${quantity}, burn=${burnAmount}, fee=${feeSat})`);
  console.log(`UTXO satoshis: ${sel.satoshis}, change: ${changeValue}`);

  const outputs = [];

  // 1. Change
  if (changeValue > 546) {
    outputs.push({ scriptPubKey: changeScript, valueSatoshis: changeValue });
    console.log(`[Output 0] Change: ${changeValue} sat`);
  }

  // 2. Burn
  outputs.push({ scriptPubKey: BURN_ADDR_SCRIPT, valueSatoshis: burnAmount });
  console.log(`[Output ${outputs.length-1}] Burn: ${burnAmount} sat`);

  // 3. Owner Token (rvno)
  const ownerNameBytes = new TextEncoder().encode(assetName + '!');
  const ownerDataBuf = new Uint8Array(1 + ownerNameBytes.length + 8);
  let o = 0;
  ownerDataBuf[o++] = ownerNameBytes.length;
  ownerDataBuf.set(ownerNameBytes, o); o += ownerNameBytes.length;
  const ownerAmtBuf = new Uint8Array(8);
  new DataView(ownerAmtBuf.buffer).setBigInt64(0, BigInt(quantity), true);
  ownerDataBuf.set(ownerAmtBuf, o);
  const rvnoMagic = new Uint8Array([0x72, 0x76, 0x6e, 0x6f]);
  const ownerPayload = new Uint8Array(4 + ownerDataBuf.length);
  ownerPayload.set(rvnoMagic, 0); ownerPayload.set(ownerDataBuf, 4);
  const ownerScript = changeScript + 'c0' + ownerPayload.length.toString(16).padStart(2, '0') + toHex(ownerPayload) + '61';
  outputs.push({ scriptPubKey: ownerScript, valueSatoshis: 0 });
  console.log(`[Output ${outputs.length-1}] Owner Token: script len=${hexToArray(ownerScript).length}`);

  // 4. Issue Asset (rvnq)
  const CNewAsset = concatBytes(
    writeVarString(assetName),
    writeInt64(quantity),
    new Uint8Array([8]),  // units
    new Uint8Array([1]),  // reissuable
    new Uint8Array([0]),  // hasIPFS
  );
  const rvnqMagic = new Uint8Array([0x72, 0x76, 0x6e, 0x71]);
  const issuePayload = new Uint8Array(4 + CNewAsset.length);
  issuePayload.set(rvnqMagic, 0); issuePayload.set(CNewAsset, 4);
  const issueScript = changeScript + 'c0' + issuePayload.length.toString(16).padStart(2, '0') + toHex(issuePayload) + '61';
  outputs.push({ scriptPubKey: issueScript, valueSatoshis: 0 });
  console.log(`[Output ${outputs.length-1}] Issue Asset: script len=${hexToArray(issueScript).length}`);

  const rawTxHex = buildRawTransaction([{ txid: sel.txid, vout: sel.outputIndex }], outputs);
  console.log(`\nRaw tx len: ${rawTxHex.length} hex chars`);

  // Decode with daemon
  const decoded = await rpcCall('decoderawtransaction', [rawTxHex]);
  console.log(`Decoded txid: ${decoded.txid}`);
  console.log(`\nOutputs:`);
  decoded.vout.forEach((v, i) => {
    console.log(`  [${i}] value=${v.value} script=${v.scriptPubKey.asm?.substring(0,80) || v.scriptPubKey.hex?.substring(0,80)}`);
  });

  // Sign and test
  const signedHex = signRawTransaction(rawTxHex, [{
    txid: sel.txid, vout: sel.outputIndex,
    scriptPubKey: hexToArray(sel.script), privateKey: foundPk,
  }]);
  if (!signedHex) throw new Error('Signing failed');

  // Check script structure
  const decodedSigned = await rpcCall('decoderawtransaction', [signedHex]);
  console.log(`\nSigned tx outputs:`);
  decodedSigned.vout.forEach((v, i) => {
    const hex = v.scriptPubKey.hex;
    const bytes = hexToArray(hex);
    console.log(`  [${i}] value=${v.value} scriptLen=${bytes.length} hex=${hex.substring(0, 60)}...`);
    // Check IsAssetScript conditions
    if (bytes.length > 31 && bytes[25] === 0xc0) {
      console.log(`     -> OP_PHI_ASSET at index 25 ✓`);
      console.log(`     -> byte[26]=${bytes[26]} (pushdata or OP_PUSHDATA1)`);
      const pushIdx = bytes[26] < 0xfd ? 27 : (bytes[26] === 0xfd ? 28 : 30);
      console.log(`     -> byte[${pushIdx}]='${String.fromCharCode(bytes[pushIdx])}' (should be 'r')`);
      console.log(`     -> byte[${pushIdx+1}]='${String.fromCharCode(bytes[pushIdx+1])}' (should be 'v')`);
      console.log(`     -> byte[${pushIdx+2}]='${String.fromCharCode(bytes[pushIdx+2])}' (should be 'n')`);
      const magic4 = String.fromCharCode(bytes[pushIdx+3]);
      console.log(`     -> byte[${pushIdx+3}]='${magic4}' (should be 'q','t','o','r')`);
    } else {
      console.log(`     -> NOT an asset script (len=${bytes.length}, byte[25]=0x${bytes[25]?.toString(16)})`);
    }
  });

  const mempool = await rpcCall('testmempoolaccept', [[signedHex], false]);
  if (!mempool[0].allowed) {
    console.log(`\nMempool rejected: ${mempool[0]['reject-reason']}`);
  } else {
    console.log(`\nMempool accepted! Broadcasting...`);
    const txid = await rpcCall('sendrawtransaction', [signedHex, true]);
    console.log(`Issued! txid: ${txid}`);
  }
}

main().catch(e => console.error('Fatal:', e.message));
