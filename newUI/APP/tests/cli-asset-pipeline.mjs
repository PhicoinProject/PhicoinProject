/**
 * CLI Asset Issuance Pipeline Test
 *
 * Matches the exact code paths in:
 * - src/services/assetSerialization.ts (serialization + raw tx building)
 * - src/services/assets.ts (signing + broadcast)
 * - src/services/addressDerivation.ts (address derivation)
 *
 * Run: node tests/cli-asset-pipeline.mjs
 */

import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import * as nobleSecp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { hmac } from '@noble/hashes/hmac';
import { base58 } from '@scure/base';

// HMAC init
const hmacSha256 = (key, ...msgs) => {
  const data = new Uint8Array(msgs.reduce((s, m) => s + m.length, 0));
  let off = 0;
  for (const m of msgs) { data.set(m, off); off += m.length; }
  return hmac(sha256, data, key);
};
nobleSecp.utils.hmacSha256Sync = hmacSha256;

// Helpers
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
  if (n <= 0xffff) {
    const b = new Uint8Array(3); b[0] = 0xfd;
    new DataView(b.buffer).setUint16(1, n, true); return b;
  }
  const b = new Uint8Array(5); b[0] = 0xfe;
  new DataView(b.buffer).setUint32(1, n, true); return b;
}
function readVarInt(bytes, offset) {
  if (bytes[offset] < 0xfd) return { value: bytes[offset], size: 1 };
  if (bytes[offset] === 0xfd) return { value: bytes[offset+1] | (bytes[offset+2] << 8), size: 3 };
  if (bytes[offset] === 0xfe) return { value: bytes[offset+1] | (bytes[offset+2] << 8) | (bytes[offset+3] << 16) | (bytes[offset+4] << 24), size: 5 };
  return { value: 0, size: 9 };
}

// RPC
async function rpcCall(method, params = []) {
  const auth = Buffer.from('phi:phi').toString('base64');
  const resp = await fetch('http://127.0.0.1:28966/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
    body: JSON.stringify({ jsonrpc: '1.0', method, params, id: 1 }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`RPC ${method} error ${data.error.code}: ${data.error.message}`);
  return data.result;
}

// Address derivation
const PUB_KEY_HASH = 0x38;
const MAINNET_COIN_TYPE = 0;
function receivePath(index) { return `m/0'/${MAINNET_COIN_TYPE}'/0'/0/${index}`; }

function deriveAddress(hdKey, path) {
  const derived = hdKey.derive(path);
  const pubKey = derived.publicKey;
  if (!pubKey) throw new Error('No public key');
  const compressed = pubKey.length === 33 ? pubKey : new Uint8Array([
    pubKey[64] & 1 ? 0x03 : 0x02, ...pubKey.slice(1, 33)
  ]);
  const h160 = hash160(compressed);
  const script = new Uint8Array(25);
  script[0] = 0x76; script[1] = 0xa9; script[2] = 0x14;
  script.set(h160, 3); script[23] = 0x88; script[24] = 0xac;
  const payload = new Uint8Array(21);
  payload[0] = PUB_KEY_HASH; payload.set(h160, 1);
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const address = base58.encode(concatBytes(payload, checksum));
  return { address, scriptPubKey: toHex(script), privateKey: toHex(derived.privateKey) };
}

// Asset serialization - matching C++ ConstructTransaction exactly
const OP_PHI_ASSET = 0xc0;
const OP_DROP = 0x61;

// Magic bytes from src/assets/assets.h
const MAGIC_NEW_ASSET = new Uint8Array([114, 118, 110, 113]); // 'r','v','n','q'

function writeVarString(str) {
  const bytes = new TextEncoder().encode(str);
  const result = new Uint8Array(1 + bytes.length);
  result[0] = bytes.length;
  result.set(bytes, 1);
  return result;
}
function writeInt64(value) {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigInt64(0, BigInt(Math.floor(value)), true);
  return buf;
}
function writeInt8(value) { return new Uint8Array([value & 0xff]); }

function serializeCNewAsset({ name, amount, units, reissuable, hasIPFS }) {
  return concatBytes(
    writeVarString(name), writeInt64(amount), writeInt8(units),
    writeInt8(reissuable), writeInt8(hasIPFS)
  );
}

/**
 * buildAssetScript: OP_PHI_ASSET << pushdata_len << magic << serialized << OP_DROP
 * This matches C++ ConstructTransaction:
 *   vchMessage = {PHI_R, PHI_V, PHI_N, PHI_Q, ...serialized_data}
 *   script << OP_PHI_ASSET << ToByteVector(vchMessage) << OP_DROP
 */
function buildAssetScript(serialized, magic) {
  const payload = concatBytes(magic, serialized);
  const pushByte = payload.length; // < 0xfd
  const script = new Uint8Array(1 + 1 + payload.length + 1);
  script[0] = OP_PHI_ASSET;
  script[1] = pushByte;
  script.set(payload, 2);
  script[2 + payload.length] = OP_DROP;
  return toHex(script);
}

// Raw transaction builder
function buildRawTransaction(inputs, outputs, locktime = 0) {
  const parts = [];
  const version = new Uint8Array(4);
  new DataView(version.buffer).setInt32(0, 2, true);
  parts.push(version);
  parts.push(writeVarInt(inputs.length));
  for (const inp of inputs) {
    const txidBytes = hexToArray(inp.txid.split('').reverse().join(''));
    parts.push(txidBytes);
    const vout = new Uint8Array(4);
    new DataView(vout.buffer).setUint32(0, inp.vout, true);
    parts.push(vout);
    parts.push(writeVarInt(0));
    parts.push(new Uint8Array(0));
    const seq = new Uint8Array(4);
    new DataView(seq.buffer).setUint32(0, inp.sequence ?? 0xffffffff, true);
    parts.push(seq);
  }
  parts.push(writeVarInt(outputs.length));
  for (const out of outputs) {
    const value = new Uint8Array(8);
    new DataView(value.buffer).setBigInt64(0, BigInt(out.valueSatoshis), true);
    parts.push(value);
    const script = hexToArray(out.scriptPubKey);
    parts.push(writeVarInt(script.length));
    parts.push(script);
  }
  const locktimeBytes = new Uint8Array(4);
  new DataView(locktimeBytes.buffer).setUint32(0, locktime, true);
  parts.push(locktimeBytes);
  return toHex(concatBytes(...parts));
}

// Parse raw tx
function parseRawTx(rawHex) {
  const bytes = hexToArray(rawHex);
  let offset = 0;
  const version = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true);
  offset += 4;
  const inLen = readVarInt(bytes, offset); offset += inLen.size;
  const inputs = [];
  for (let i = 0; i < inLen.value; i++) {
    const prevTxId = toHex(bytes.slice(offset, offset + 32)); offset += 32;
    const vout = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true); offset += 4;
    const scriptLen = readVarInt(bytes, offset); offset += scriptLen.size;
    const scriptSig = bytes.slice(offset, offset + scriptLen.value); offset += scriptLen.value;
    const sequence = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true); offset += 4;
    inputs.push({ prevTxId, vout, scriptSig, sequence });
  }
  const outLen = readVarInt(bytes, offset); offset += outLen.size;
  const outputs = [];
  for (let i = 0; i < outLen.value; i++) {
    const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigInt64(0, true); offset += 8;
    const scriptLen = readVarInt(bytes, offset); offset += scriptLen.size;
    const scriptPubKey = bytes.slice(offset, offset + scriptLen.value); offset += scriptLen.value;
    outputs.push({ value, scriptPubKey });
  }
  const locktime = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
  return { version, inputs, outputs, locktime };
}

// Sighash
function computeP2PKHSighash(tx, inputIndex, scriptPubKey) {
  const parts = [];
  const vb = new Uint8Array(4);
  new DataView(vb.buffer).setInt32(0, tx.version, true);
  parts.push(vb);
  parts.push(writeVarInt(tx.inputs.length));
  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    parts.push(hexToArray(inp.prevTxId));
    const voutBuf = new Uint8Array(4);
    new DataView(voutBuf.buffer).setUint32(0, inp.vout, true);
    parts.push(voutBuf);
    if (i === inputIndex) { parts.push(writeVarInt(scriptPubKey.length)); parts.push(scriptPubKey); }
    else parts.push(writeVarInt(0));
    const seqBuf = new Uint8Array(4);
    new DataView(seqBuf.buffer).setUint32(0, inp.sequence, true);
    parts.push(seqBuf);
  }
  parts.push(writeVarInt(tx.outputs.length));
  for (const out of tx.outputs) {
    const valBuf = new Uint8Array(8);
    new DataView(valBuf.buffer).setBigInt64(0, BigInt(out.value), true);
    parts.push(valBuf);
    parts.push(writeVarInt(out.scriptPubKey.length));
    parts.push(out.scriptPubKey);
  }
  const lb = new Uint8Array(4);
  new DataView(lb.buffer).setUint32(0, tx.locktime, true);
  parts.push(lb);
  const sb = new Uint8Array(4);
  new DataView(sb.buffer).setUint32(0, 1, true);
  parts.push(sb);
  return sha256(sha256(concatBytes(...parts)));
}

// Sign
function signRawTransactionLocally(rawHex, scriptPubKeys, privateKeys) {
  const tx = parseRawTx(rawHex);
  const signedScriptSigs = [];
  for (let i = 0; i < tx.inputs.length; i++) {
    const sighash = computeP2PKHSighash(tx, i, scriptPubKeys[i]);
    const sig = nobleSecp.signSync(sighash, privateKeys[i], { der: true });
    const scriptSig = new Uint8Array(sig.length + 1);
    scriptSig.set(sig);
    scriptSig[sig.length] = 0x01;
    signedScriptSigs.push(scriptSig);
  }
  const parts = [];
  const vb = new Uint8Array(4);
  new DataView(vb.buffer).setInt32(0, tx.version, true);
  parts.push(vb);
  parts.push(writeVarInt(tx.inputs.length));
  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    parts.push(hexToArray(inp.prevTxId));
    const voutBuf = new Uint8Array(4);
    new DataView(voutBuf.buffer).setUint32(0, inp.vout, true);
    parts.push(voutBuf);
    const sig = signedScriptSigs[i];
    parts.push(writeVarInt(sig.length));
    parts.push(sig);
    const seqBuf = new Uint8Array(4);
    new DataView(seqBuf.buffer).setUint32(0, inp.sequence, true);
    parts.push(seqBuf);
  }
  parts.push(writeVarInt(tx.outputs.length));
  for (const out of tx.outputs) {
    const valBuf = new Uint8Array(8);
    new DataView(valBuf.buffer).setBigInt64(0, BigInt(out.value), true);
    parts.push(valBuf);
    parts.push(writeVarInt(out.scriptPubKey.length));
    parts.push(out.scriptPubKey);
  }
  const lb = new Uint8Array(4);
  new DataView(lb.buffer).setUint32(0, tx.locktime, true);
  parts.push(lb);
  return toHex(concatBytes(...parts));
}

// ============================================================
// Main Pipeline
// ============================================================
async function run() {
  console.log('=== PHICOIN Asset Issuance CLI Pipeline ===\n');

  // 1. Generate wallet
  console.log('[1/8] Generating wallet...');
  const mnemonic = 'owner cabin beef fault obtain rack tip resist wine mule love broken lawsuit tape motion hub sting aunt mushroom bomb black clutch horn bottom';
  const seed = mnemonicToSeedSync(mnemonic, '');
  const hdKey = HDKey.fromMasterSeed(seed);
  const path = receivePath(0);
  const { address, scriptPubKey, privateKey } = deriveAddress(hdKey, path);
  console.log(`  Path: ${path}`);
  console.log(`  Address: ${address}`);
  console.log(`  ScriptPubKey: ${scriptPubKey}\n`);

  // 2. Validate address
  console.log('[2/8] Validating address with daemon...');
  const validation = await rpcCall('validateaddress', [address]);
  console.log(`  isvalid: ${validation.isvalid}\n`);
  if (!validation.isvalid) { console.error('  ERROR: Address invalid'); process.exit(1); }

  // 3. Get UTXOs
  console.log('[3/8] Fetching UTXOs...');
  const utxos = await rpcCall('getaddressutxos', [address]);
  console.log(`  Found ${utxos.length} UTXOs\n`);

  if (!utxos.length) {
    console.log('  No UTXOs. Running serialization validation only...\n');
    await runValidationOnly(scriptPubKey, privateKey);
    return;
  }

  // 4. Build CNewAsset
  console.log('[4/8] Building CNewAsset...');
  const assetName = 'CLITEST';
  const quantity = 1000;
  const amountSat = Math.floor(quantity * 1e8);
  const serialized = serializeCNewAsset({
    name: assetName, amount: amountSat, units: 8, reissuable: 0, hasIPFS: 0,
  });
  console.log(`  Serialized: ${toHex(serialized)}\n`);

  // 5. Build scriptPubKey
  console.log('[5/8] Building asset scriptPubKey...');
  const assetScriptHex = buildAssetScript(serialized, MAGIC_NEW_ASSET);
  console.log(`  Asset scriptPubKey: ${assetScriptHex}\n`);

  // 6. Build raw tx
  console.log('[6/8] Building raw transaction...');
  const utxo = utxos[0];
  const inputs = [{ txid: utxo.txid, vout: utxo.vout, sequence: 0xffffffff }];
  const outputs = [
    { scriptPubKey: assetScriptHex, valueSatoshis: 1000 },
    { scriptPubKey, valueSatoshis: Math.floor(utxo.satoshis) - 1000 - 500 },
  ];
  const rawHex = buildRawTransaction(inputs, outputs);
  console.log(`  Raw (${rawHex.length} chars): ${rawHex.substring(0, 80)}...\n`);

  // 7. Validate unsigned tx
  console.log('[7/8] Validating with decoderawtransaction...');
  try {
    const decoded = await rpcCall('decoderawtransaction', [rawHex]);
    console.log(`  OK - txid: ${decoded.txid}, ${decoded.vin.length} in, ${decoded.vout.length} out\n`);
  } catch (err) { console.log(`  Error: ${err.message}\n`); }

  // 8. Sign & validate
  console.log('[8/8] Signing & validating...');
  const spkBytes = utxo.scriptPubKey ? hexToArray(utxo.scriptPubKey) : hexToArray(scriptPubKey);
  const signedHex = signRawTransactionLocally(rawHex, [spkBytes], [privateKey]);
  console.log(`  Signed (${signedHex.length} chars): ${signedHex.substring(0, 80)}...\n`);

  try {
    const decoded = await rpcCall('decoderawtransaction', [signedHex]);
    console.log(`  Decoded OK - txid: ${decoded.txid}`);
  } catch (err) { console.log(`  Decode error: ${err.message}`); }

  console.log('\nPre-flight: testmempoolaccept...');
  try {
    const mempoolResult = await rpcCall('testmempoolaccept', [[signedHex], false]);
    console.log('  Result:', JSON.stringify(mempoolResult));
    if (mempoolResult[0]?.allowed) {
      console.log('  Broadcasting...');
      const txid = await rpcCall('sendrawtransaction', [signedHex, true]);
      console.log(`  SUCCESS! TXID: ${txid}`);
    } else {
      console.log(`  Rejected: ${mempoolResult[0]?.['reject-reason']}`);
    }
  } catch (err) { console.log(`  Error: ${err.message}`); }

  console.log('\n=== Pipeline Complete ===');
}

async function runValidationOnly(scriptPubKey, privateKey) {
  const fakeTxid = '0'.repeat(64);

  console.log('[4/8] Building CNewAsset...');
  const serialized = serializeCNewAsset({
    name: 'CLITEST', amount: 1000 * 1e8, units: 8, reissuable: 0, hasIPFS: 0,
  });
  console.log(`  Serialized: ${toHex(serialized)}\n`);

  console.log('[5/8] Building asset scriptPubKey...');
  const assetScriptHex = buildAssetScript(serialized, MAGIC_NEW_ASSET);
  console.log(`  Asset scriptPubKey: ${assetScriptHex}`);
  console.log(`  Length: ${hexToArray(assetScriptHex).length} bytes`);
  console.log(`  Bytes: ${assetScriptHex.match(/.{2}/g).map(b => parseInt(b,16)).join(' ')}`);
  console.log(`  Structure: OP_PHI_ASSET(${parseInt(assetScriptHex.slice(0,2),16)}) pushdata_len(${parseInt(assetScriptHex.slice(2,4),16)}) [magic+data] OP_DROP(${parseInt(assetScriptHex.slice(-2),16)})\n`);

  console.log('[6/8] Building raw transaction (simulated)...');
  const inputs = [{ txid: fakeTxid, vout: 0, sequence: 0xffffffff }];
  const outputs = [
    { scriptPubKey: assetScriptHex, valueSatoshis: 1000 },
    { scriptPubKey, valueSatoshis: 1000 },
  ];
  const rawHex = buildRawTransaction(inputs, outputs);

  console.log('[7/8] Signing...');
  const spkBytes = hexToArray(scriptPubKey);
  const signedHex = signRawTransactionLocally(rawHex, [spkBytes], [privateKey]);
  const parsed = parseRawTx(signedHex);
  console.log(`  Parsed: ${parsed.inputs.length} inputs, ${parsed.outputs.length} outputs`);
  const out0Script = parsed.outputs[0].scriptPubKey;
  console.log(`  Output 0 scriptPubKey (${out0Script.length} bytes):`);
  console.log(`    Byte 0: 0x${toHex(new Uint8Array([out0Script[0]]))} (OP_PHI_ASSET)`);
  console.log(`    Byte 1: ${out0Script[1]} (pushdata length)`);
  console.log(`    Bytes 2-5: ${toHex(out0Script.slice(2,6))} (magic: rvnq = 72 76 6e 71)`);
  console.log(`    Last byte: 0x${toHex(new Uint8Array([out0Script[out0Script.length-1]]))} (OP_DROP)`);

  console.log('\n=== Validation Complete ===');
}

run().catch(err => { console.error('Pipeline failed:', err); process.exit(1); });