/**
 * Test the frontend asset issuance flow via CLI
 * Uses the same wallet mnemonic as the test wallet
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

async function rpcCall(method, params = []) {
  const auth = Buffer.from('phi:phi').toString('base64');
  const resp = await fetch('http://127.0.0.1:28966/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
    body: JSON.stringify({ jsonrpc: '1.0', method, params, id: 1 }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`RPC ${method} error ${data.error.code}: ${data.error.message.substring(0, 200)}`);
  return data.result;
}

// Signing functions matching txSigner.ts
function parseRawTx(raw) {
  const bytes = hexToArray(raw);
  let off = 0;
  const version = new DataView(bytes.buffer, bytes.byteOffset + off, 4).getInt32(0, true); off += 4;
  const inLen = readVarInt(bytes, off); off += inLen.size;
  const inputs = [];
  for (let i = 0; i < inLen.value; i++) {
    const prevTxId = toHex(bytes.slice(off, off + 32)); off += 32;
    const vout = new DataView(bytes.buffer, bytes.byteOffset + off, 4).getUint32(0, true); off += 4;
    const sLen = readVarInt(bytes, off); off += sLen.size;
    const scriptSig = bytes.slice(off, off + sLen.value); off += sLen.value;
    const sequence = new DataView(bytes.buffer, bytes.byteOffset + off, 4).getUint32(0, true); off += 4;
    inputs.push({ prevTxId, vout, scriptSig, sequence });
  }
  const outLen = readVarInt(bytes, off); off += outLen.size;
  const outputs = [];
  for (let i = 0; i < outLen.value; i++) {
    const value = new DataView(bytes.buffer, bytes.byteOffset + off, 8).getBigInt64(0, true); off += 8;
    const sLen = readVarInt(bytes, off); off += sLen.size;
    const scriptPubKey = bytes.slice(off, off + sLen.value); off += sLen.value;
    outputs.push({ value, scriptPubKey });
  }
  const locktime = new DataView(bytes.buffer, bytes.byteOffset + off, 4).getUint32(0, true);
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
    const vb = new Uint8Array(8); new DataView(vb.buffer).setBigInt64(0, out.value, true); parts.push(vb);
    parts.push(writeVarInt(out.scriptPubKey.length)); parts.push(out.scriptPubKey);
  }
  const lb = new Uint8Array(4); new DataView(lb.buffer).setUint32(0, tx.locktime, true); parts.push(lb);
  const total = parts.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { result.set(p, offset); offset += p.length; }
  return toHex(result);
}

function computeSighash(tx, inputIndex, scriptPubKey, hashType = 0x01) {
  const parts = [];
  const vBuf = new Uint8Array(4); new DataView(vBuf.buffer).setInt32(0, tx.version, true); parts.push(vBuf);
  parts.push(writeVarInt(tx.inputs.length));
  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    parts.push(hexToArray(inp.prevTxId));
    const vb = new Uint8Array(4); new DataView(vb.buffer).setUint32(0, inp.vout, true); parts.push(vb);
    if (i === inputIndex) {
      parts.push(writeVarInt(scriptPubKey.length)); parts.push(scriptPubKey);
    } else {
      parts.push(writeVarInt(0));
    }
    const sb = new Uint8Array(4); new DataView(sb.buffer).setUint32(0, inp.sequence, true); parts.push(sb);
  }
  parts.push(writeVarInt(tx.outputs.length));
  for (const out of tx.outputs) {
    const vb = new Uint8Array(8); new DataView(vb.buffer).setBigInt64(0, out.value, true); parts.push(vb);
    parts.push(writeVarInt(out.scriptPubKey.length)); parts.push(out.scriptPubKey);
  }
  const lb = new Uint8Array(4); new DataView(lb.buffer).setUint32(0, tx.locktime, true); parts.push(lb);
  const hb = new Uint8Array(4); new DataView(hb.buffer).setUint32(0, hashType, true); parts.push(hb);
  const total = parts.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { result.set(p, offset); offset += p.length; }
  return sha256(sha256(result));
}

function buildP2PKHScriptSig(signature, sighash, pubkey) {
  const sigData = new Uint8Array(signature.length + 1);
  sigData.set(signature); sigData[signature.length] = sighash;
  const parts = [];
  parts.push(writeVarInt(sigData.length)); parts.push(sigData);
  parts.push(writeVarInt(pubkey.length)); parts.push(pubkey);
  const total = parts.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { result.set(p, offset); offset += p.length; }
  return result;
}

function signRawTransaction(rawTxHex, signingInputs) {
  const tx = parseRawTx(rawTxHex);
  if (tx.inputs.length !== signingInputs.length) return null;
  const signedInputs = tx.inputs.map((inp, i) => {
    const si = signingInputs[i];
    const sighash = computeSighash(tx, i, si.scriptPubKey);
    const sig = nobleSecp.signSync(toHex(sighash), toHex(si.privateKey), { der: true });
    const pubkey = nobleSecp.getPublicKey(toHex(si.privateKey), true);
    const scriptSig = buildP2PKHScriptSig(hexToArray(sig), 0x01, hexToArray(pubkey));
    return { ...inp, scriptSig };
  });
  return buildRawTxHex({ ...tx, inputs: signedInputs });
}

// Build raw transaction manually (matching assetSerialization.ts buildRawTransaction)
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
  const total = parts.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { result.set(p, offset); offset += p.length; }
  return toHex(result);
}

// Serialize CNewAsset
function serializeCNewAsset(params) {
  const nameBytes = new TextEncoder().encode(params.name);
  const serialized = new Uint8Array(1 + nameBytes.length + 8 + 1 + 1 + 1);
  let off = 0;
  serialized[off++] = nameBytes.length;
  serialized.set(nameBytes, off); off += nameBytes.length;
  const amtBuf = new Uint8Array(8);
  new DataView(amtBuf.buffer).setBigInt64(0, BigInt(params.amount), true);
  serialized.set(amtBuf, off); off += 8;
  serialized[off++] = params.units;
  serialized[off++] = params.reissuable;
  serialized[off++] = params.hasIPFS;
  return serialized;
}

async function main() {
  const PUB_KEY_HASH = 0x38;
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const seed = mnemonicToSeedSync(mnemonic, '');
  const hdKey = HDKey.fromMasterSeed(seed);
  const coinType = 0; // MAINNET

  function deriveAddr(hdKey, path) {
    const d = hdKey.derive(path);
    const pk = d.publicKey;
    const comp = pk.length === 33 ? pk : new Uint8Array([pk[64]&1 ? 0x03:0x02, ...pk.slice(1,33)]);
    const h = hash160(comp);
    const p = new Uint8Array(21); p[0] = PUB_KEY_HASH; p.set(h,1);
    const c = sha256(sha256(p)).slice(0,4);
    return base58.encode(concatBytes(p,c));
  }

  // Check first 5 addresses and their UTXOs
  console.log('=== Checking wallet addresses ===');
  const addresses = [];
  for (let i = 0; i < 5; i++) {
    const path = `m/0'/${coinType}'/0'/0/${i}`;
    const addr = deriveAddr(hdKey, path);
    addresses.push({ path, addr });
    try {
      const utxos = await rpcCall('getaddressutxos', [{ addresses: [addr] }]);
      const total = utxos.reduce((s, u) => s + u.satoshis, 0);
      console.log(`  idx ${i}: ${addr}  UTXOs: ${utxos.length}  balance: ${(total/1e8).toFixed(4)} PHI`);
    } catch(e) {
      console.log(`  idx ${i}: ${addr}  Error: ${e.message}`);
    }
  }

  // Check for assets
  console.log('\n=== Checking for assets ===');
  const firstAddr = addresses[0].addr;
  try {
    const balances = await rpcCall('listassetbalancesbyaddress', [firstAddr, 1000, 0]);
    console.log('Asset balances:', JSON.stringify(balances).substring(0, 500));
  } catch(e) {
    console.log('No asset balances:', e.message.substring(0, 200));
  }

  // Gather UTXOs
  console.log('\n=== Gathering UTXOs ===');
  const allUtxos = [];
  for (const a of addresses) {
    try {
      const utxos = await rpcCall('getaddressutxos', [{ addresses: [a.addr] }]);
      allUtxos.push(...utxos);
    } catch(e) {}
  }
  console.log('Total UTXOs:', allUtxos.length);
  if (allUtxos.length === 0) {
    console.log('No UTXOs found! Send PHI to any of the addresses above.');
    return;
  }

  // Sort by amount, pick largest
  allUtxos.sort((a, b) => b.satoshis - a.satoshis);
  const selected = allUtxos[0];
  console.log('Selected UTXO:', selected.txid, 'vout:', selected.outputIndex, 'sat:', selected.satoshis);

  // Derive private key for this UTXO
  const scriptPubKey = hexToArray(selected.script);
  const targetH160 = scriptPubKey.slice(3, 23);
  let foundPk = null;
  for (const a of addresses) {
    const d = hdKey.derive(a.path);
    const pk = d.privateKey;
    const pubKey = d.publicKey;
    const comp = pubKey.length === 33 ? pubKey : new Uint8Array([pubKey[64]&1 ? 0x03:0x02, ...pubKey.slice(1,33)]);
    const h = hash160(comp);
    let match = true;
    for (let i = 0; i < 20; i++) if (h[i] !== targetH160[i]) { match = false; break; }
    if (match) { foundPk = pk; console.log('Found private key for path:', a.path); break; }
  }
  if (!foundPk) { console.log('ERROR: Cannot find private key for UTXO!'); return; }

  // Build 4-output ROOT issuance transaction (matching frontend assets.ts)
  console.log('\n=== Building ROOT issuance transaction ===');
  const assetName = 'WEBTEST';
  const quantity = 1000 * Math.pow(10, 8); // in satoshis
  const units = 8;
  const reissuable = 0;
  const hasIPFS = 0;

  const senderAddr = firstAddr;
  const changeScript = selected.script; // 76a914...88ac

  const feeSat = 500000;
  const burnAmount = Math.floor(0.1 * 1e8); // 10000000
  const totalInput = selected.satoshis;
  const changeValue = totalInput - feeSat - burnAmount;

  console.log('Input:', totalInput, 'Fee:', feeSat, 'Burn:', burnAmount, 'Change:', changeValue);

  const outputs = [];

  // 1. Change output
  if (changeValue > 546) {
    outputs.push({ scriptPubKey: changeScript, valueSatoshis: changeValue });
  }

  // 2. Burn output
  outputs.push({
    scriptPubKey: '76a9148684a6449c157dd0a2f393fc5147e47cd4fd9f2588ac',
    valueSatoshis: burnAmount,
  });

  // 3. Owner Token output (rvno magic) - matching CNewAsset::ConstructOwnerTransaction
  // ssOwner << std::string(this->strName + OWNER_TAG);  -- only name, no amount
  const ownerNameBytes = new TextEncoder().encode(assetName + '!');
  const ownerDataBuf = new Uint8Array(1 + ownerNameBytes.length);
  ownerDataBuf[0] = ownerNameBytes.length;
  ownerDataBuf.set(ownerNameBytes, 1);
  const rvnoMagic = new Uint8Array([0x72, 0x76, 0x6e, 0x6f]);
  const ownerPayload = new Uint8Array(4 + ownerDataBuf.length);
  ownerPayload.set(rvnoMagic, 0);
  ownerPayload.set(ownerDataBuf, 4);
  const ownerScriptWithP2PKH = changeScript + 'c0' + ownerPayload.length.toString(16).padStart(2, '0') + toHex(ownerPayload) + '61';
  console.log('Owner script:', ownerScriptWithP2PKH);
  outputs.push({ scriptPubKey: ownerScriptWithP2PKH, valueSatoshis: 0 });

  // 4. Issue Asset output (rvnq magic)
  const assetData = serializeCNewAsset({ name: assetName, amount: quantity, units, reissuable, hasIPFS });
  const issuePayload = new Uint8Array(4 + assetData.length);
  const MAGIC_NEW_ASSET = new Uint8Array([0x72, 0x76, 0x6e, 0x71]);
  issuePayload.set(MAGIC_NEW_ASSET, 0);
  issuePayload.set(assetData, 4);
  const issueScriptWithP2PKH = changeScript + 'c0' + issuePayload.length.toString(16).padStart(2, '0') + toHex(issuePayload) + '61';
  console.log('Issue script:', issueScriptWithP2PKH);
  outputs.push({ scriptPubKey: issueScriptWithP2PKH, valueSatoshis: 0 });

  console.log('\nOutputs:', outputs.length);

  // Build raw tx
  const rpcInputs = [{ txid: selected.txid, vout: selected.outputIndex }];
  const rawTxHex = await buildRawTransaction(rpcInputs, outputs);
  console.log('Raw tx hex:', rawTxHex.substring(0, 80) + '...');

  // Verify
  const decoded = await rpcCall('decoderawtransaction', [rawTxHex]);
  console.log('Decoded txid:', decoded.txid);
  console.log('vout count:', decoded.vout.length);
  decoded.vout.forEach((v, i) => {
    console.log(`  vout[${i}]: value=${v.value} type=${v.scriptPubKey.type} addr=${JSON.stringify(v.scriptPubKey.addresses)}`);
  });

  // Sign locally (matching txSigner.ts flow)
  console.log('\n=== Signing locally ===');

  const signingInputs = [{
    txid: selected.txid,
    vout: selected.outputIndex,
    scriptPubKey: hexToArray(selected.script),
    privateKey: foundPk,
  }];

  const signedHex = signRawTransaction(rawTxHex, signingInputs);
  if (!signedHex) {
    console.log('Local signing returned null!');
    return;
  }
  console.log('Signed hex:', signedHex.substring(0, 80) + '...');

  // Decode to verify scriptSig
  const decodedLocal = await rpcCall('decoderawtransaction', [signedHex]);
  const lScriptSig = decodedLocal.vin[0].scriptsig?.hex || decodedLocal.vin[0].scriptSig?.hex;
  console.log('Local scriptSig:', lScriptSig);

  // testmempoolaccept
  console.log('\n=== testmempoolaccept ===');
  try {
    const mempoolResult = await rpcCall('testmempoolaccept', [[signedHex], false]);
    console.log('Mempool:', JSON.stringify(mempoolResult[0]));
    if (mempoolResult[0].allowed !== true) {
      const reason = mempoolResult[0]['reject-reason'] ?? mempoolResult[0].reason ?? 'unknown';
      console.log('Mempool rejected:', reason);
    }
  } catch (e) {
    console.log('Error:', e.message.substring(0, 200));
  }

  // Verify the signed tx input
  const decodedSigned = await rpcCall('decoderawtransaction', [signedHex]);
  console.log('Signed txid:', decodedSigned.txid);
  console.log('Signed input txid:', decodedSigned.vin[0].txid);
  console.log('Signed input prevout:', decodedSigned.vin[0].prevout?.n ?? decodedSigned.vin[0].previousOutput?.n ?? 'N/A');

  // Check if input UTXO exists
  try {
    const inputInfo = await rpcCall('getrawtransaction', [decodedSigned.vin[0].txid, 1]);
    console.log('Input tx exists, vout count:', inputInfo.vout.length);
    console.log('Input vout[0]:', JSON.stringify(inputInfo.vout[0]).substring(0, 200));
  } catch(e) {
    console.log('Input tx not found:', e.message);
  }

  // Broadcast
  console.log('\n=== Broadcasting ===');
  try {
    const txid = await rpcCall('sendrawtransaction', [signedHex, true]);
    console.log('\n*** SUCCESS! ***');
    console.log('Asset "' + assetName + '" issued! txid:', txid);
  } catch (e) {
    console.log('FAILED:', e.message.substring(0, 300));
  }
}

main().catch(e => console.error(e));
