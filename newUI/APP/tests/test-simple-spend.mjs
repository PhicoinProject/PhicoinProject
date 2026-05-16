/**
 * Simple P2PKH spend test - isolate the missing-inputs issue
 */
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import * as nobleSecp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { hmac } from '@noble/hashes/hmac';

const hmacSha256 = (key, ...msgs) => {
  const data = new Uint8Array(msgs.reduce((s, m) => s + m.length, 0));
  let off = 0;
  for (const m of msgs) { data.set(m, off); off += m.length; }
  return hmac(sha256, data, key);
};
nobleSecp.utils.hmacSha256Sync = hmacSha256;

function toHex(bytes) { return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''); }
function hexToArray(hex) { const bytes = new Uint8Array(hex.length / 2); for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16); return bytes; }
function hash160(data) { return ripemd160(sha256(data)); }

function reverseBytes(hex) {
  const bytes = hexToArray(hex);
  for (let i = 0; i < Math.floor(bytes.length / 2); i++) {
    const j = bytes.length - 1 - i;
    const tmp = bytes[i]; bytes[i] = bytes[j]; bytes[j] = tmp;
  }
  return bytes;
}

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

function buildP2PKHScriptPubKey(h160) {
  const s = new Uint8Array(25);
  s[0] = 0x76; s[1] = 0xa9; s[2] = 0x14;
  s.set(h160, 3);
  s[23] = 0x88; s[24] = 0xac;
  return s;
}

function buildRawTxHex(inputs, outputs, version = 2, locktime = 0) {
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
    const prevTxId = toHex(bytes.slice(off, off + 32)); off += 32;
    const vout = new DataView(bytes.buffer, off, 4).getUint32(0, true); off += 4;
    const sLen = readVarInt(bytes, off); off += sLen.size;
    const scriptSig = bytes.slice(off, off + sLen.value); off += sLen.value;
    const sequence = new DataView(bytes.buffer, off, 4).getUint32(0, true); off += 4;
    inputs.push({ prevTxId, vout, scriptSig, sequence });
  }
  const outLen = readVarInt(bytes, off); off += outLen.size;
  const outputs = [];
  for (let i = 0; i < outLen.value; i++) {
    const value = new DataView(bytes.buffer, off, 8).getBigInt64(0, true); off += 8;
    const sLen = readVarInt(bytes, off); off += sLen.size;
    const scriptPubKey = bytes.slice(off, off + sLen.value); off += sLen.value;
    outputs.push({ value, scriptPubKey });
  }
  const locktime = new DataView(bytes.buffer, off, 4).getUint32(0, true);
  return { version, inputs, outputs, locktime };
}

function computeSighash(tx, inputIndex, scriptPubKey, hashType = 0x01) {
  const parts = [];
  const vBuf = new Uint8Array(4); new DataView(vBuf.buffer).setInt32(0, tx.version, true); parts.push(vBuf);
  parts.push(writeVarInt(tx.inputs.length));
  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    parts.push(reverseBytes(inp.prevTxId));
    const vb = new Uint8Array(4); new DataView(vb.buffer).setUint32(0, inp.vout, true); parts.push(vb);
    if (i === inputIndex) {
      parts.push(writeVarInt(scriptPubKey.length)); parts.push(scriptPubKey);
    } else parts.push(writeVarInt(0));
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
  const sigData = new Uint8Array(signature.length + 1);
  sigData.set(signature); sigData[signature.length] = sighash;
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
    parts.push(reverseBytes(inp.prevTxId));
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

// Derive HD wallet
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = mnemonicToSeedSync(mnemonic, '');
const hdKey = HDKey.fromMasterSeed(seed);
const derived = hdKey.derive("m/0'/0'/0'/0/0");
const pk = derived.privateKey;
const compressed = derived.publicKey.length === 33 ? derived.publicKey :
  new Uint8Array([derived.publicKey[64] & 1 ? 0x03 : 0x02, ...derived.publicKey.slice(1, 33)]);
const h160 = hash160(compressed);
const changeScript = buildP2PKHScriptPubKey(h160);

// Get UTXOs
const walletUtxos = await rpcCall('listunspent', [1, 999999999, ["Pum3xBGkPWK9pcpvanoMyfGTdWYuzMWmsr"]]);
console.log('Available UTXOs:', walletUtxos.length);
// Pick the largest UTXO
const utxo = walletUtxos.reduce((a, b) => a.amount > b.amount ? a : b);
console.log('Chosen UTXO:', utxo.txid, 'vout:', utxo.vout, 'amount:', utxo.amount);

// Build simple P2PKH tx: spend to self with 1 PHI fee
const utxoSat = Math.round(utxo.amount * 1e8);
const fee = 100000;
const change = utxoSat - fee;
console.log('Fee:', fee, 'Change:', change);

const rawHex = buildRawTxHex(
  [{ txid: utxo.txid, vout: utxo.vout }],
  [{ script: changeScript, value: change }]
);
const decoded = await rpcCall('decoderawtransaction', [rawHex]);
console.log('Raw txid:', decoded.txid);
console.log('Raw hex:', rawHex);

// Verify input matches what we expect
console.log('Input prevTxId (reversed):', decoded.vin[0].txid);

// Sign locally
const signedHex = signRawTransaction(rawHex, [{
  txid: utxo.txid, vout: utxo.vout,
  scriptPubKey: hexToArray(utxo.scriptPubKey),
  privateKey: pk,
}]);
const decodedSigned = await rpcCall('decoderawtransaction', [signedHex]);
console.log('Signed txid:', decodedSigned.txid);

// Broadcast
console.log('Broadcasting...');
const txid = await rpcCall('sendrawtransaction', [signedHex, true]);
console.log('SUCCESS! txid:', txid);
