/**
 * Broadcast asset issuance - wait for mature UTXO then build and broadcast
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

function toHex(bytes) { return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''); }
function hexToArray(hex) { const bytes = new Uint8Array(hex.length / 2); for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16); return bytes; }
function concatBytes(...arrays) { const total = arrays.reduce((s, a) => s + a.length, 0); const result = new Uint8Array(total); let offset = 0; for (const a of arrays) { result.set(a, offset); offset += a.length; } return result; }
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
  if (data.error) throw new Error(`RPC ${method} error ${data.error.code}: ${data.error.message.substring(0, 300)}`);
  return data.result;
}

function buildP2PKHScriptPubKey(h160) { const s = new Uint8Array(25); s[0]=0x76; s[1]=0xa9; s[2]=0x14; s.set(h160,3); s[23]=0x88; s[24]=0xac; return s; }

function reverseBytes(hex) {
  const bytes = hexToArray(hex);
  for (let i = 0; i < Math.floor(bytes.length / 2); i++) {
    const j = bytes.length - 1 - i;
    const tmp = bytes[i];
    bytes[i] = bytes[j];
    bytes[j] = tmp;
  }
  return bytes;
}

function buildRawTxHex(inputs, outputs, version=2, locktime=0) {
  const parts = [];
  const vBuf = new Uint8Array(4); new DataView(vBuf.buffer).setInt32(0, version, true); parts.push(vBuf);
  parts.push(writeVarInt(inputs.length));
  for (const inp of inputs) {
    parts.push(reverseBytes(inp.txid));
    const vb = new Uint8Array(4); new DataView(vb.buffer).setUint32(0, inp.vout, true); parts.push(vb);
    parts.push(writeVarInt(0));
    const sb = new Uint8Array(4); new DataView(sb.buffer).setUint32(0, 0xffffffff, true); parts.push(sb);
  }
  parts.push(writeVarInt(outputs.length));
  for (const out of outputs) {
    const vb = new Uint8Array(8); new DataView(vb.buffer).setBigInt64(0, BigInt(out.value), true); parts.push(vb);
    parts.push(writeVarInt(out.script.length)); parts.push(out.script);
  }
  const lb = new Uint8Array(4); new DataView(lb.buffer).setUint32(0, locktime, true); parts.push(lb);
  const total = parts.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0; for (const p of parts) { result.set(p, offset); offset += p.length; }
  return toHex(result);
}

function parseRawTx(raw) {
  const bytes = hexToArray(raw); let off = 0;
  const version = new DataView(bytes.buffer, off, 4).getInt32(0, true); off += 4;
  const inLen = readVarInt(bytes, off); off += inLen.size;
  const inputs = [];
  for (let i = 0; i < inLen.value; i++) {
    const prevTxId = toHex(bytes.slice(off, off+32)); off += 32;
    const vout = new DataView(bytes.buffer, off, 4).getUint32(0, true); off += 4;
    const sLen = readVarInt(bytes, off); off += sLen.size;
    const scriptSig = bytes.slice(off, off+sLen.value); off += sLen.value;
    const sequence = new DataView(bytes.buffer, off, 4).getUint32(0, true); off += 4;
    inputs.push({ prevTxId, vout, scriptSig, sequence });
  }
  const outLen = readVarInt(bytes, off); off += outLen.size;
  const outputs = [];
  for (let i = 0; i < outLen.value; i++) {
    const value = new DataView(bytes.buffer, off, 8).getBigInt64(0, true); off += 8;
    const sLen = readVarInt(bytes, off); off += sLen.size;
    const scriptPubKey = bytes.slice(off, off+sLen.value); off += sLen.value;
    outputs.push({ value, scriptPubKey });
  }
  const locktime = new DataView(bytes.buffer, off, 4).getUint32(0, true);
  return { version, inputs, outputs, locktime };
}

function computeSighash(tx, inputIndex, scriptPubKey, hashType=0x01) {
  const parts = [];
  const vBuf = new Uint8Array(4); new DataView(vBuf.buffer).setInt32(0, tx.version, true); parts.push(vBuf);
  parts.push(writeVarInt(tx.inputs.length));
  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    parts.push(hexToArray(inp.prevTxId));
    const vb = new Uint8Array(4); new DataView(vb.buffer).setUint32(0, inp.vout, true); parts.push(vb);
    if (i === inputIndex) { parts.push(writeVarInt(scriptPubKey.length)); parts.push(scriptPubKey); } else parts.push(writeVarInt(0));
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
  let offset = 0; for (const p of parts) { result.set(p, offset); offset += p.length; }
  return sha256(sha256(result));
}

function buildP2PKHScriptSig(signature, sighash, pubkey) {
  const sigData = new Uint8Array(signature.length + 1); sigData.set(signature); sigData[signature.length] = sighash;
  const parts = [];
  parts.push(writeVarInt(sigData.length)); parts.push(sigData);
  parts.push(writeVarInt(pubkey.length)); parts.push(pubkey);
  const total = parts.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0; for (const p of parts) { result.set(p, offset); offset += p.length; }
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
  const parts = [];
  const vBuf = new Uint8Array(4); new DataView(vBuf.buffer).setInt32(0, tx.version, true); parts.push(vBuf);
  parts.push(writeVarInt(signedInputs.length));
  for (const inp of signedInputs) {
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
  let offset = 0; for (const p of parts) { result.set(p, offset); offset += p.length; }
  return toHex(result);
}

function buildAssetScriptWithP2PKH(h160, magic, payload) {
  const p2pkh = buildP2PKHScriptPubKey(h160);
  const fullPayload = concatBytes(magic, payload);
  const script = new Uint8Array(p2pkh.length + 1 + 1 + fullPayload.length + 1);
  script.set(p2pkh, 0); script[25] = 0xc0; script[26] = fullPayload.length; script.set(fullPayload, 27); script[27 + fullPayload.length] = 0x61;
  return script;
}

function serializeCNewAsset(name, amount, units, reissuable, hasIPFS, ipfsHash='') {
  const nameBytes = new TextEncoder().encode(name);
  let size = 1 + nameBytes.length + 8 + 1 + 1 + 1;
  if (ipfsHash) size += 1 + ipfsHash.length;
  const data = new Uint8Array(size); let off = 0;
  data[off++] = nameBytes.length; data.set(nameBytes, off); off += nameBytes.length;
  const amtBuf = new Uint8Array(8); new DataView(amtBuf.buffer).setBigInt64(0, BigInt(amount), true); data.set(amtBuf, off); off += 8;
  data[off++] = units; data[off++] = reissuable; data[off++] = hasIPFS;
  if (ipfsHash) { const ipfsBytes = new TextEncoder().encode(ipfsHash); data[off++] = ipfsBytes.length; data.set(ipfsBytes, off); off += ipfsBytes.length; }
  return data;
}

function serializeCAssetTransfer(name, amount) {
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(1 + nameBytes.length + 8); let off = 0;
  data[off++] = nameBytes.length; data.set(nameBytes, off); off += nameBytes.length;
  const amtBuf = new Uint8Array(8); new DataView(amtBuf.buffer).setBigInt64(0, BigInt(amount), true); data.set(amtBuf, off); off += 8;
  return data;
}

// Derive HD wallet
const PUB_KEY_HASH = 0x38;
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = mnemonicToSeedSync(mnemonic, '');
const hdKey = HDKey.fromMasterSeed(seed);
const derived = hdKey.derive("m/0'/0'/0'/0/0");
const pk = derived.privateKey;
const compressed = derived.publicKey.length === 33 ? derived.publicKey : new Uint8Array([derived.publicKey[64] & 1 ? 0x03 : 0x02, ...derived.publicKey.slice(1, 33)]);
const h160 = hash160(compressed);
const addrPayload = new Uint8Array(21); addrPayload[0] = PUB_KEY_HASH; addrPayload.set(h160, 1);
const addrChecksum = sha256(sha256(addrPayload)).slice(0, 4);
const address = base58.encode(concatBytes(addrPayload, addrChecksum));
const changeScript = buildP2PKHScriptPubKey(h160);

const burnScript = hexToArray('76a9148684a6449c157dd0a2f393fc5147e47cd4fd9f2588ac');

console.log('=== Wait for mature UTXO then broadcast ===');
console.log('Address:', address);

// Wait for spendable UTXOs (just need 1+ confirmation for non-coinbase)
let utxo = null;
for (let i = 0; i < 120; i++) {
  try {
    const walletUtxos = await rpcCall('listunspent', [1, 999999999, [address]]);
    if (walletUtxos.length > 0) {
      // Pick largest UTXO
      utxo = walletUtxos.reduce((a, b) => a.amount > b.amount ? a : b);
      console.log(`Found UTXO after ${i}s: ${utxo.txid} amount: ${utxo.amount} confirmations: ${utxo.confirmations}`);
      break;
    }
  } catch (e) {
    // console.log('RPC error:', e.message.substring(0, 100));
  }
  await new Promise(r => setTimeout(r, 1000));
  if (i % 10 === 0) console.log(`Waiting for UTXO... (${i}s)`);
}

if (!utxo) {
  console.log('No mature UTXOs found. Mining a coinbase to mature...');
  console.log('Please mine or send PHI to:', address);
  process.exit(1);
}

const utxoTxid = utxo.txid;
const utxoVout = utxo.vout;
const utxoSatoshis = Math.round(utxo.amount * 1e8);
const utxoScript = utxo.scriptPubKey;

// Build scripts
const assetName = 'CLITEST';
const assetQuantity = 1000 * Math.pow(10, 8);
const assetData = serializeCNewAsset(assetName, assetQuantity, 8, 0, 0);
const rvnqMagic = new Uint8Array([0x72, 0x76, 0x6e, 0x71]);
const issueScript = buildAssetScriptWithP2PKH(h160, rvnqMagic, assetData);
const ownerTransferData = serializeCAssetTransfer(assetName + '!', 1 * 100000000);
const rvnoMagic = new Uint8Array([0x72, 0x76, 0x6e, 0x6f]);
const ownerScript = buildAssetScriptWithP2PKH(h160, rvnoMagic, ownerTransferData);

const feeSat = 500000; // 0.005 PHI (relay fee is 0.01/KB)
const burnSat = 0.1 * 1e8;
const changeValue = utxoSatoshis - feeSat - burnSat;

const inputs = [{ txid: utxoTxid, vout: utxoVout }];
const outputs = [
  { script: changeScript, value: changeValue },
  { script: burnScript, value: burnSat },
  { script: ownerScript, value: 0 },
  { script: issueScript, value: 0 },
];

const rawHex = buildRawTxHex(inputs, outputs);
const decoded = await rpcCall('decoderawtransaction', [rawHex]);
console.log('txid:', decoded.txid);

// Derive WIF private key for daemon's signrawtransaction
const wifBody = new Uint8Array(34);
wifBody[0] = 0x80;
wifBody.set(pk, 1);
wifBody[33] = 0x01;
const wifChecksumVal = sha256(sha256(wifBody)).slice(0, 4);
const wifFull = new Uint8Array(38);
wifFull.set(wifBody, 0);
wifFull.set(wifChecksumVal, 34);
const wif = base58.encode(wifFull);

const utxoInfos = [{
  txid: utxoTxid,
  vout: utxoVout,
  scriptPubKey: utxoScript,
  amount: utxoSatoshis / 1e8,
}];
const signResult = await rpcCall('signrawtransaction', [rawHex, utxoInfos, [wif]]);
console.log('complete:', signResult.complete);
console.log('errors:', JSON.stringify(signResult.errors));
if (!signResult.complete) {
  throw new Error('Daemon signing failed: ' + JSON.stringify(signResult.errors));
}
const signedHex = signResult.hex;

const decodedSigned = await rpcCall('decoderawtransaction', [signedHex]);
console.log('Signed txid:', decodedSigned.txid);

console.log('Broadcasting...');
const txid = await rpcCall('sendrawtransaction', [signedHex, true]);
console.log('\n========================================');
console.log('*** ASSET ISSUED SUCCESSFULLY! ***');
console.log('Asset:', assetName);
console.log('txid:', txid);
console.log('Check: https://explorer.phicoin.net/tx/' + txid);
console.log('========================================');
