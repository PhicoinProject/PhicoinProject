/**
 * Test txSigner.ts signing logic against daemon's signrawtransaction RPC.
 * 
 * This test:
 * 1. Creates a raw tx via createrawtransaction RPC
 * 2. Signs it with the frontend's txSigner module
 * 3. Signs it with the daemon's signrawtransaction RPC
 * 4. Compares the results
 * 5. Broadcasts if they match
 */

import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import * as nobleSecp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { hmac } from '@noble/hashes/hmac';
import { base58 } from '@scure/base';

// Init noble
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

function parseRawTx(raw) {
  const bytes = hexToArray(raw);
  let off = 0;
  const version = new DataView(bytes.buffer, off, 4).getInt32(0, true);
  off += 4;
  const inLen = readVarInt(bytes, off);
  off += inLen.size;
  const inputs = [];
  for (let i = 0; i < inLen.value; i++) {
    const prevTxId = toHex(bytes.slice(off, off + 32));
    off += 32;
    const vout = new DataView(bytes.buffer, off, 4).getUint32(0, true);
    off += 4;
    const scriptLen = readVarInt(bytes, off);
    off += scriptLen.size;
    const scriptSig = bytes.slice(off, off + scriptLen.value);
    off += scriptLen.value;
    const sequence = new DataView(bytes.buffer, off, 4).getUint32(0, true);
    off += 4;
    inputs.push({ prevTxId, vout, scriptSig, sequence });
  }
  const outLen = readVarInt(bytes, off);
  off += outLen.size;
  const outputs = [];
  for (let i = 0; i < outLen.value; i++) {
    const value = new DataView(bytes.buffer, off, 8).getBigInt64(0, true);
    off += 8;
    const scriptLen = readVarInt(bytes, off);
    off += scriptLen.size;
    const scriptPubKey = bytes.slice(off, off + scriptLen.value);
    off += scriptLen.value;
    outputs.push({ value, scriptPubKey });
  }
  const locktime = new DataView(bytes.buffer, off, 4).getUint32(0, true);
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
  const total = parts.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { result.set(p, offset); offset += p.length; }
  return toHex(result);
}

function computeSighash(tx, inputIndex, scriptPubKey, hashType = 0x01) {
  const parts = [];
  const versionBuf = new Uint8Array(4);
  new DataView(versionBuf.buffer).setInt32(0, tx.version, true);
  parts.push(versionBuf);
  parts.push(writeVarInt(tx.inputs.length));
  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    parts.push(hexToArray(inp.prevTxId));
    const voutBuf = new Uint8Array(4);
    new DataView(voutBuf.buffer).setUint32(0, inp.vout, true);
    parts.push(voutBuf);
    if (i === inputIndex) {
      parts.push(writeVarInt(scriptPubKey.length));
      parts.push(scriptPubKey);
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
  const total = parts.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { result.set(p, offset); offset += p.length; }
  return sha256(sha256(result));
}

function buildP2PKHScriptSig(signature, sighash, pubkey) {
  const sigData = new Uint8Array(signature.length + 1);
  sigData.set(signature);
  sigData[signature.length] = sighash;
  const parts = [];
  parts.push(writeVarInt(sigData.length));
  parts.push(sigData);
  parts.push(writeVarInt(pubkey.length));
  parts.push(pubkey);
  return concatBytes(...parts);
}

async function main() {
  // Derive a test HD wallet
  const PUB_KEY_HASH = 0x38;
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const seed = mnemonicToSeedSync(mnemonic, '');
  const hdKey = HDKey.fromMasterSeed(seed);
  
  const derived = hdKey.derive("m/0'/0'/0'/0/0");
  const pk = derived.privateKey;
  const pubKey = derived.publicKey;
  const pkHex = toHex(pk);
  
  const compressed = pubKey.length === 33 ? pubKey : new Uint8Array([pubKey[64] & 1 ? 0x03 : 0x02, ...pubKey.slice(1, 33)]);
  const h160 = hash160(compressed);
  
  const payload = new Uint8Array(21);
  payload[0] = PUB_KEY_HASH;
  payload.set(h160, 1);
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const address = base58.encode(concatBytes(payload, checksum));
  
  const script = new Uint8Array(25);
  script[0] = 0x76; script[1] = 0xa9; script[2] = 0x14;
  script.set(h160, 3); script[23] = 0x88; script[24] = 0xac;
  const scriptPubKey = toHex(script);
  
  console.log('=== Derived Address ===');
  console.log('Address:', address);
  console.log('scriptPubKey:', scriptPubKey);
  
  // Import key to daemon
  console.log('\n=== Import key to daemon ===');
  try {
    await rpcCall('importprivkey', [pkHex, 'testkey', false]);
    console.log('Imported private key');
  } catch (e) {
    if (e.message.includes('already') || e.message.includes('import')) {
      console.log('Key already imported');
    } else {
      throw e;
    }
  }
  
  // Check UTXOs
  console.log('\n=== Check UTXOs ===');
  let utxos = await rpcCall('getaddressutxos', [{ addresses: [address] }]);
  console.log('UTXOs:', utxos.length);
  
  if (utxos.length === 0) {
    console.log('No UTXOs for this address. Need to fund it first.');
    console.log('\nTo fund via daemon, run:');
    console.log(`curl -s http://127.0.0.1:28966/ -u phi:phi -d '{"jsonrpc":1,"method":"generatetoaddress","params":[101,"${address}"],"id":0}'`);
    console.log('\nOr use sendtoaddress if daemon has balance.');
    return;
  }
  
  const utxo = utxos[0];
  console.log('txid:', utxo.txid);
  console.log('vout:', utxo.outputIndex);
  console.log('satoshis:', utxo.satoshis);
  console.log('script:', utxo.script);
  
  // Build a simple PHI transfer tx
  console.log('\n=== Build simple transfer tx ===');
  const inputSat = utxo.satoshis;
  const feeSat = 10000;
  const changeValue = inputSat - feeSat - 1000;
  
  if (changeValue < 0) {
    console.log('UTXO too small for transfer, trying smaller fee...');
    const smallFee = Math.floor(inputSat * 0.01);
    const change2 = inputSat - smallFee;
    if (change2 < 546) {
      console.log('UTXO too small');
      return;
    }
  }
  
  const inputs = [{ txid: utxo.txid, vout: utxo.outputIndex }];
  const outputs = {};
  outputs[address] = Number((changeValue / 1e8).toFixed(8));
  
  const rawHex = await rpcCall('createrawtransaction', [inputs, outputs]);
  console.log('Raw tx:', rawHex.substring(0, 80) + '...');
  
  // Decode raw tx
  const decoded = await rpcCall('decoderawtransaction', [rawHex]);
  console.log('Decoded txid:', decoded.txid);
  console.log('vin[0] scriptsig:', decoded.vin[0].scriptsig?.hex || decoded.vin[0].scriptSig?.hex || 'none');
  
  // Sign with daemon's signrawtransaction
  console.log('\n=== Sign with daemon ===');
  const prevTxs = [{
    txid: utxo.txid,
    vout: utxo.outputIndex,
    scriptPubKey: utxo.script,
    amount: Number((utxo.satoshis / 1e8).toFixed(8)),
  }];
  
  const daemonSigned = await rpcCall('signrawtransaction', [rawHex, prevTxs, [pkHex]]);
  console.log('Daemon complete:', daemonSigned.complete);
  
  const decodedDaemon = await rpcCall('decoderawtransaction', [daemonSigned.hex]);
  const daemonScriptSig = decodedDaemon.vin[0].scriptsig?.hex || decodedDaemon.vin[0].scriptSig?.hex;
  console.log('Daemon scriptSig:', daemonScriptSig);
  
  // Now sign with frontend
  console.log('\n=== Sign with frontend ===');
  const tx = parseRawTx(rawHex);
  console.log('Parsed tx version:', tx.version);
  console.log('Parsed inputs:', tx.inputs.length);
  console.log('Parsed outputs:', tx.outputs.length);
  console.log('Parsed locktime:', tx.locktime);
  console.log('Parsed vin[0] prevTxId (LE):', tx.inputs[0].prevTxId);
  console.log('UTXO txid (BE):', utxo.txid);
  
  const sighash = computeSighash(tx, 0, hexToArray(utxo.script));
  console.log('Sighash:', toHex(sighash));
  
  const sig = nobleSecp.signSync(toHex(sighash), pkHex, { der: true });
  console.log('Signature (DER):', sig);
  
  const compressedPubkey = nobleSecp.getPublicKey(pkHex, true);
  console.log('Compressed pubkey:', compressedPubkey);
  
  const scriptSig = buildP2PKHScriptSig(hexToArray(sig), 0x01, hexToArray(compressedPubkey));
  console.log('Frontend scriptSig:', toHex(scriptSig));
  
  // Compare
  console.log('\n=== Comparison ===');
  console.log('Daemon scriptSig:   ', daemonScriptSig);
  console.log('Frontend scriptSig: ', toHex(scriptSig));
  console.log('Match:', daemonScriptSig === toHex(scriptSig));
  
  if (daemonScriptSig !== toHex(scriptSig)) {
    console.log('\nScriptSig mismatch! Analyzing:');
    console.log('Daemon length:', daemonScriptSig.length / 2);
    console.log('Frontend length:', scriptSig.length);
    
    const daemonBytes = hexToArray(daemonScriptSig);
    console.log('Daemon push1 length:', daemonBytes[0]);
    console.log('Frontend push1 length:', scriptSig[0]);
    console.log('Daemon push2 offset:', daemonBytes[0] + 1);
    console.log('Daemon push2 length:', daemonBytes[daemonBytes[0] + 1]);
    console.log('Frontend push2 offset:', scriptSig[0] + 1);
    console.log('Frontend push2 length:', scriptSig[scriptSig[0] + 1]);
  }
  
  // Build signed tx with frontend
  tx.inputs[0].scriptSig = scriptSig;
  const frontendSigned = buildRawTxHex(tx);
  
  console.log('\n=== Broadcast test ===');
  try {
    const txid = await rpcCall('sendrawtransaction', [frontendSigned, true]);
    console.log('SUCCESS! txid:', txid);
  } catch (e) {
    console.log('FAILED:', e.message.substring(0, 300));
  }
}

main().catch(e => console.error(e));
