/**
 * Monitor for mature UTXOs and issue asset automatically.
 * Uses createrawtransaction's built-in asset issuance format.
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
  if (data.error) throw new Error(`RPC ${method} error ${data.error.code}: ${data.error.message.substring(0, 300)}`);
  return data.result;
}

// Signing
function parseRawTx(raw) {
  const bytes = hexToArray(raw);
  let off = 0;
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

// Derive HD wallet
const PUB_KEY_HASH = 0x38;
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = mnemonicToSeedSync(mnemonic, '');
const hdKey = HDKey.fromMasterSeed(seed);
const derived = hdKey.derive("m/0'/0'/0'/0/0");
const pk = derived.privateKey;

const compressed = derived.publicKey.length === 33 ? derived.publicKey :
  new Uint8Array([derived.publicKey[64] & 1 ? 0x03 : 0x02, ...derived.publicKey.slice(1, 33)]);
const h160 = hash160(compressed);
const payload = new Uint8Array(21);
payload[0] = PUB_KEY_HASH; payload.set(h160, 1);
const checksum = sha256(sha256(payload)).slice(0, 4);
const address = base58.encode(concatBytes(payload, checksum));

console.log('=== Asset Issue Monitor ===');
console.log('Address:', address);
console.log('Checking every 20 seconds...\n');

async function issueAsset() {
  try {
    const utxos = await rpcCall('getaddressutxos', [{ addresses: [address] }]);

    if (utxos.length === 0) return;

    console.log(`\n*** Found ${utxos.length} mature UTXOs! Issuing asset... ***\n`);

    const utxo = utxos[0];
    console.log('Selected UTXO:');
    console.log('  txid:', utxo.txid);
    console.log('  vout:', utxo.outputIndex);
    console.log('  satoshis:', utxo.satoshis);
    console.log('  confirmations:', utxo.confirmations);
    console.log('  script:', utxo.script);

    // Build transaction using createrawtransaction's built-in asset format
    // Format: {"change_address": amount, "issuer_address": {"issue": {...}}}
    const inputSat = utxo.satoshis;
    const feeSat = 10000;
    const assetQuantity = 1000 * Math.pow(10, 8); // 1000 units with 8 decimals
    const changeValue = inputSat - feeSat; // issue burns 0

    const rpcInputs = [{ txid: utxo.txid, vout: utxo.outputIndex }];
    const rpcOutputs = {
      [address]: Number((changeValue / 1e8).toFixed(8)),
      [`${address}_issuer`]: {
        issue: {
          asset_name: 'CLITEST',
          asset_quantity: assetQuantity,
          units: 8,
          reissuable: 0,
          has_ipfs: 0,
        }
      }
    };

    console.log('\nRPC Outputs:', JSON.stringify(rpcOutputs, null, 2));

    const rawHex = await rpcCall('createrawtransaction', [rpcInputs, rpcOutputs]);
    console.log('\nRaw tx:', rawHex.substring(0, 120) + '...');

    const decoded = await rpcCall('decoderawtransaction', [rawHex]);
    console.log('Decoded txid:', decoded.txid);
    console.log('Outputs:', JSON.stringify(decoded.vout.map(o => ({ value: o.value, scriptPubKey: o.scriptPubKey.hex?.substring(0, 80) })), null, 2));

    // Sign - need to sign all inputs that belong to our wallet
    const signingInputs = [{
      txid: utxo.txid,
      vout: utxo.outputIndex,
      scriptPubKey: hexToArray(utxo.script),
      privateKey: pk,
    }];

    const signedHex = signRawTransaction(rawHex, signingInputs);
    if (!signedHex) throw new Error('Signing returned null');

    const decodedSigned = await rpcCall('decoderawtransaction', [signedHex]);
    const scriptSig = decodedSigned.vin[0].scriptsig?.hex || decodedSigned.vin[0].scriptSig?.hex;
    console.log('ScriptSig:', scriptSig?.substring(0, 80));

    // testmempoolaccept
    console.log('\ntestmempoolaccept...');
    try {
      const mempoolResult = await rpcCall('testmempoolaccept', [signedHex, false]);
      console.log('Result:', JSON.stringify(mempoolResult[0]));
      if (mempoolResult[0].allowed !== true) {
        const reason = mempoolResult[0]['reject-reason'] ?? mempoolResult[0].reason ?? 'unknown';
        console.log('Rejected:', reason);
        return;
      }
    } catch (e) {
      console.log('testmempoolaccept error:', e.message.substring(0, 300));
    }

    // Broadcast!
    console.log('\nBroadcasting...');
    const txid = await rpcCall('sendrawtransaction', [signedHex, true]);
    console.log('\n========================================');
    console.log('*** ASSET ISSUED SUCCESSFULLY! ***');
    console.log('Asset: CLITEST');
    console.log('txid:', txid);
    console.log('Check: https://explorer.phicoin.net/tx/' + txid);
    console.log('========================================\n');

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message.substring(0, 500));
  }
}

// Check every 20 seconds
issueAsset();
setInterval(issueAsset, 20000);
