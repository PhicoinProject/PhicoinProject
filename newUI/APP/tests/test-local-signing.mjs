import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { base58 } from '@scure/base';

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
  if (data.error) throw new Error(`RPC ${method} error ${data.error.code}: ${data.error.message.substring(0, 300)}`);
  return data.result;
}

// Import txSigner functions (replicate from source since we can't import .ts in .mjs)
import * as nobleSecp from '@noble/secp256k1';
import { hmac } from '@noble/hashes/hmac';

const hmacSha256 = (key, ...msgs) => {
  const data = new Uint8Array(msgs.reduce((s, m) => s + m.length, 0));
  let off = 0;
  for (const m of msgs) { data.set(m, off); off += m.length; }
  return hmac(sha256, data, key);
};
nobleSecp.utils.hmacSha256Sync = hmacSha256;

function sighashLegacyP2PKH(tx, inputIndex, scriptCode, hashType = 0x01) {
  const parts = [];
  const versionBuf = new Uint8Array(4);
  new DataView(versionBuf.buffer).setInt32(0, tx.version, true);
  parts.push(versionBuf);
  parts.push(writeVarInt(tx.inputs.length));
  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    const prevTxIdBytes = hexToArray(inp.prevTxId);
    parts.push(prevTxIdBytes);
    const voutBuf = new Uint8Array(4);
    new DataView(voutBuf.buffer).setUint32(0, inp.vout, true);
    parts.push(voutBuf);
    if (i === inputIndex) {
      parts.push(writeVarInt(scriptCode.length));
      parts.push(scriptCode);
    } else {
      parts.push(writeVarInt(0));
    }
    const seqBuf = new Uint8Array(4);
    new DataView(seqBuf.buffer).setUint32(0, inp.sequence, true);
    parts.push(seqBuf);
  }
  parts.push(writeVarInt(tx.outputs.length));
  for (const out of tx.outputs) {
    const valBuf = new Uint8Array(8);
    new DataView(valBuf.buffer).setBigInt64(0, out.value, true);
    parts.push(valBuf);
    parts.push(writeVarInt(out.scriptPubKey.length));
    parts.push(out.scriptPubKey);
  }
  const locktimeBuf = new Uint8Array(4);
  new DataView(locktimeBuf.buffer).setUint32(0, tx.locktime, true);
  parts.push(locktimeBuf);
  const sighashBuf = new Uint8Array(4);
  new DataView(sighashBuf.buffer).setUint32(0, hashType, true);
  parts.push(sighashBuf);
  const serialized = concatBytes(...parts);
  return sha256(sha256(serialized));
}

function buildP2PKHScriptSig(signature, sighash, pubkey) {
  const parts = [];
  const sigData = new Uint8Array(signature.length + 1);
  sigData.set(signature);
  sigData[signature.length] = sighash;
  parts.push(writeVarInt(sigData.length));
  parts.push(sigData);
  parts.push(writeVarInt(pubkey.length));
  parts.push(pubkey);
  return concatBytes(...parts);
}

function parseRawTx(rawHex) {
  const bytes = hexToArray(rawHex);
  let offset = 0;
  const version = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true);
  offset += 4;
  const inLen = readVarInt(bytes, offset);
  offset += inLen.size;
  const inputs = [];
  for (let i = 0; i < inLen.value; i++) {
    const prevTxId = toHex(bytes.slice(offset, offset + 32));
    offset += 32;
    const vout = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
    offset += 4;
    const scriptLen = readVarInt(bytes, offset);
    offset += scriptLen.size;
    const scriptSig = bytes.slice(offset, offset + scriptLen.value);
    offset += scriptLen.value;
    const sequence = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
    offset += 4;
    inputs.push({ prevTxId, vout, scriptSig, sequence });
  }
  const outLen = readVarInt(bytes, offset);
  offset += outLen.size;
  const outputs = [];
  for (let i = 0; i < outLen.value; i++) {
    const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigInt64(0, true);
    offset += 8;
    const scriptLen = readVarInt(bytes, offset);
    offset += scriptLen.size;
    const scriptPubKey = bytes.slice(offset, offset + scriptLen.value);
    offset += scriptLen.value;
    outputs.push({ value, scriptPubKey });
  }
  const locktime = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
  return { version, inputs, outputs, locktime };
}

function buildRawTxHex(tx) {
  const parts = [];
  const versionBuf = new Uint8Array(4);
  new DataView(versionBuf.buffer).setInt32(0, tx.version, true);
  parts.push(versionBuf);
  parts.push(writeVarInt(tx.inputs.length));
  for (const inp of tx.inputs) {
    parts.push(hexToArray(inp.prevTxId));
    const voutBuf = new Uint8Array(4);
    new DataView(voutBuf.buffer).setUint32(0, inp.vout, true);
    parts.push(voutBuf);
    parts.push(writeVarInt(inp.scriptSig.length));
    parts.push(inp.scriptSig);
    const seqBuf = new Uint8Array(4);
    new DataView(seqBuf.buffer).setUint32(0, inp.sequence, true);
    parts.push(seqBuf);
  }
  parts.push(writeVarInt(tx.outputs.length));
  for (const out of tx.outputs) {
    const valBuf = new Uint8Array(8);
    new DataView(valBuf.buffer).setBigInt64(0, out.value, true);
    parts.push(valBuf);
    parts.push(writeVarInt(out.scriptPubKey.length));
    parts.push(out.scriptPubKey);
  }
  const locktimeBuf = new Uint8Array(4);
  new DataView(locktimeBuf.buffer).setUint32(0, tx.locktime, true);
  parts.push(locktimeBuf);
  return toHex(concatBytes(...parts));
}

function signRawTransaction(rawTxHex, inputs) {
  const tx = parseRawTx(rawTxHex);
  if (tx.inputs.length !== inputs.length) return null;
  const signedInputs = tx.inputs.map((inp, i) => {
    const signingInput = inputs[i];
    const scriptPubKey = signingInput.scriptPubKey;
    const privateKey = signingInput.privateKey;
    const sighashType = signingInput.sighashType ?? 0x01;
    const sighash = sighashLegacyP2PKH(tx, i, scriptPubKey, sighashType);
    const sighashHex = toHex(sighash);
    const privateKeyHex = toHex(privateKey);
    const sig = nobleSecp.signSync(sighashHex, privateKeyHex, { der: true });
    const pubkey = nobleSecp.getPublicKey(privateKeyHex, true);
    const scriptSig = buildP2PKHScriptSig(sig, sighashType, pubkey);
    return { prevTxId: inp.prevTxId, vout: inp.vout, scriptSig, sequence: inp.sequence };
  });
  const signedTx = { version: tx.version, inputs: signedInputs, outputs: tx.outputs, locktime: tx.locktime };
  return buildRawTxHex(signedTx);
}

// ---- Test ----
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = mnemonicToSeedSync(mnemonic, '');
const hdKey = HDKey.fromMasterSeed(seed);
const derived = hdKey.derive("m/0'/0'/0'/0/0");
const pk = derived.privateKey;
const pkHex = toHex(pk);
const hdCompressed = derived.publicKey.length === 33 ? derived.publicKey :
  new Uint8Array([derived.publicKey[64] & 1 ? 0x03 : 0x02, ...derived.publicKey.slice(1, 33)]);
console.log('HDKey pub:', toHex(hdCompressed));

const noblePub = nobleSecp.getPublicKey(pkHex, true);
console.log('Noble pub:', toHex(noblePub));
console.log('Pubkeys match:', toHex(hdCompressed) === toHex(noblePub));

// Find UTXO
const utxos = await rpcCall('getaddressutxos', [{ addresses: ['Pum3xBGkPWK9pcpvanoMyfGTdWYuzMWmsr'] }]);
if (!utxos || !utxos.length) { console.log('No UTXOs found'); process.exit(1); }
const selected = utxos[0];
console.log('\nUTXO:', selected.txid, 'vout:', selected.outputIndex, 'sat:', selected.satoshis);

const scriptPubKey = hexToArray(selected.script);

// Build raw tx (higher fee this time)
const feeSat = 50000;
// Send to self: one small output, one change output
const sendValue = 1000; // 0.00001 PHI
const changeValue = selected.satoshis - feeSat - sendValue;
const outputs = [];
outputs.push({ script: selected.script, value: sendValue });
if (changeValue > 546) outputs.push({ script: selected.script, value: changeValue });

function buildRawTransaction(inpTxid, inpVout, outs) {
  const parts = [];
  const version = new Uint8Array(4); new DataView(version.buffer).setInt32(0, 2, true); parts.push(version);
  parts.push(writeVarInt(1));
  const txidBytesOrig = hexToArray(inpTxid);
  const txidBytes = new Uint8Array(32);
  for (let j = 0; j < 32; j++) txidBytes[j] = txidBytesOrig[31 - j];
  parts.push(txidBytes);
  const vout = new Uint8Array(4); new DataView(vout.buffer).setUint32(0, inpVout, true); parts.push(vout);
  parts.push(writeVarInt(0)); parts.push(new Uint8Array(0));
  const seq = new Uint8Array(4); new DataView(seq.buffer).setUint32(0, 0xffffffff, true); parts.push(seq);
  parts.push(writeVarInt(outs.length));
  for (const out of outs) {
    const value = new Uint8Array(8); new DataView(value.buffer).setBigInt64(0, BigInt(out.value), true); parts.push(value);
    const script = hexToArray(out.script); parts.push(writeVarInt(script.length)); parts.push(script);
  }
  const locktime = new Uint8Array(4); new DataView(locktime.buffer).setUint32(0, 0, true); parts.push(locktime);
  const total = parts.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { result.set(p, offset); offset += p.length; }
  return toHex(result);
}

const rawHex = buildRawTransaction(selected.txid, selected.outputIndex, outputs);
console.log('Raw hex (80):', rawHex.substring(0, 80));

// Sign locally
const signedHex = signRawTransaction(rawHex, [{
  txid: selected.txid,
  vout: selected.outputIndex,
  scriptPubKey,
  privateKey: pk,
}]);

if (!signedHex) { console.log('Signing returned null'); process.exit(1); }
console.log('Signed hex (80):', signedHex.substring(0, 80));

// Decode
const decoded = await rpcCall('decoderawtransaction', [signedHex]);
console.log('\nDecoded txid:', decoded.txid);
const scriptSigHex = decoded.vin[0].scriptsig?.hex || decoded.vin[0].scriptSig?.hex;
console.log('scriptSig:', scriptSigHex);
console.log('vout count:', decoded.vout.length);
decoded.vout.forEach((v, i) => console.log(`  vout[${i}]: ${v.value} -> ${v.scriptPubKey.hex}`));

// Test mempool
console.log('\n=== testmempoolaccept ===');
try {
  const mempoolResult = await rpcCall('testmempoolaccept', [[signedHex], false]);
  console.log('Result:', JSON.stringify(mempoolResult[0]));
  if (mempoolResult[0].allowed) {
    console.log('*** LOCAL SIGNING ACCEPTED! Broadcasting...');
    const txid = await rpcCall('sendrawtransaction', [signedHex, true]);
    console.log('*** BROADCAST SUCCESS! txid:', txid);
  }
} catch(e) {
  console.log('Error:', e.message.substring(0, 400));
}
