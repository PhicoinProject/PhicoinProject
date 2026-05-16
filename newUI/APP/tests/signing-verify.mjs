/**
 * Verify frontend signing logic matches daemon's signrawtransaction RPC.
 *
 * This test creates a fake transaction and compares sighash outputs
 * without needing mature UTXOs. It validates:
 * 1. sighash computation matches daemon
 * 2. scriptSig format matches daemon
 * 3. Full signed tx can be decoded
 */

import * as nobleSecp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';

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
  const vBuf = new Uint8Array(4); new DataView(vBuf.buffer).setInt32(0, tx.version, true);
  parts.push(vBuf);
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
  const vBuf = new Uint8Array(4); new DataView(vBuf.buffer).setInt32(0, tx.version, true);
  parts.push(vBuf);
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

async function main() {
  // Test private key (known test vector)
  const pkHex = '13df7e37022e16e0cdab6d07851ad455c95e665b26bb9b8dd1c1542624cb1672';

  // Compressed pubkey
  const pubkey = nobleSecp.getPublicKey(pkHex, true);
  console.log('Compressed pubkey:', pubkey);

  // Build P2PKH scriptPubKey
  const pkBytes = hexToArray(pubkey);
  const ripemd160 = (await import('@noble/hashes/ripemd160')).ripemd160;
  const h160 = ripemd160(sha256(pkBytes));
  const scriptPubKey = new Uint8Array(25);
  scriptPubKey[0] = 0x76; scriptPubKey[1] = 0xa9; scriptPubKey[2] = 0x14;
  scriptPubKey.set(h160, 3); scriptPubKey[23] = 0x88; scriptPubKey[24] = 0xac;
  const spkHex = toHex(scriptPubKey);
  console.log('scriptPubKey:', spkHex);

  // Get a recent block and use one of its txids
  const blockCount = await rpcCall('getblockcount');
  const blockHash = await rpcCall('getblockhash', [blockCount]);
  const block = await rpcCall('getblock', [blockHash, 1]);
  const coinbaseTxId = block.tx[0];
  console.log('Using coinbase tx:', coinbaseTxId);

  // Build a raw tx with this input - use daemon address for output
  const inputs = [{ txid: coinbaseTxId, vout: 0 }];
  const outputs = {};
  const addr = 'Pum3xBGkPWK9pcpvanoMyfGTdWYuzMWmsr'; // HD wallet address
  outputs[addr] = 0.001;

  const rawHex = await rpcCall('createrawtransaction', [inputs, outputs]);
  console.log('Raw tx hex:', rawHex.substring(0, 80) + '...');

  // Verify with decoderawtransaction
  const decoded = await rpcCall('decoderawtransaction', [rawHex]);
  console.log('Decoded txid:', decoded.txid);
  console.log('Locktime:', decoded.locktime);
  console.log('Version:', decoded.version);

  // Sign with daemon's signrawtransaction
  const prevTxs = [{
    txid: coinbaseTxId,
    vout: 0,
    scriptPubKey: spkHex,
    amount: 50, // Fake amount
  }];

  const daemonSigned = await rpcCall('signrawtransaction', [rawHex, prevTxs, [pkHex]]);
  console.log('\nDaemon complete:', daemonSigned.complete);

  if (daemonSigned.errors && daemonSigned.errors.length) {
    console.log('Daemon errors:', JSON.stringify(daemonSigned.errors));
  }

  const decodedDaemon = await rpcCall('decoderawtransaction', [daemonSigned.hex]);
  const daemonScriptSig = decodedDaemon.vin[0].scriptsig?.hex || decodedDaemon.vin[0].scriptSig?.hex;
  console.log('Daemon scriptSig:', daemonScriptSig);

  // Now sign with frontend logic
  const tx = parseRawTx(rawHex);
  console.log('\nParsed tx version:', tx.version);
  console.log('Parsed locktime:', tx.locktime);
  console.log('Parsed vin[0] prevTxId:', tx.inputs[0].prevTxId);

  // Compute sighash
  const sighash = computeSighash(tx, 0, scriptPubKey);
  console.log('Frontend sighash:', toHex(sighash));

  // Sign
  const sig = nobleSecp.signSync(toHex(sighash), pkHex, { der: true });
  console.log('Frontend signature length:', hexToArray(sig).length);

  const compressedPubkey = hexToArray(pubkey);
  const scriptSig = buildP2PKHScriptSig(hexToArray(sig), 0x01, compressedPubkey);
  console.log('Frontend scriptSig:', toHex(scriptSig));

  // Compare
  console.log('\n=== Comparison ===');
  console.log('Daemon scriptSig:   ', daemonScriptSig);
  console.log('Frontend scriptSig: ', toHex(scriptSig));
  console.log('Match:', daemonScriptSig === toHex(scriptSig));

  if (daemonScriptSig !== toHex(scriptSig)) {
    console.log('\nMismatch details:');
    const db = hexToArray(daemonScriptSig);
    const fb = scriptSig;
    console.log('Daemon length:', db.length, '| Frontend length:', fb.length);
    console.log('Daemon push1 len:', db[0], '| Frontend push1 len:', fb[0]);
    console.log('Daemon push2 len:', db[db[0] + 1], '| Frontend push2 len:', fb[fb[0] + 1]);

    // Compare signature bytes
    const dSigLen = db[0] - 1; // subtract sighash byte
    const fSigLen = fb[0] - 1;
    console.log('Daemon sig len:', dSigLen, '| Frontend sig len:', fSigLen);
    console.log('Daemon sighash byte:', db[db[0]].toString(16));
    console.log('Frontend sighash byte:', fb[fb[0]].toString(16));

    if (dSigLen === fSigLen) {
      let sigMatch = true;
      for (let i = 1; i <= dSigLen; i++) {
        if (db[i] !== fb[i]) {
          console.log('Sig byte mismatch at index', i, ':', db[i].toString(16), 'vs', fb[i].toString(16));
          sigMatch = false;
          break;
        }
      }
      console.log('Signature bytes match:', sigMatch);
    }

    if (db.length > db[0] + 2 && fb.length > fb[0] + 2) {
      const dPubOff = db[0] + 1;
      const fPubOff = fb[0] + 1;
      const dPubLen = db[dPubOff];
      const fPubLen = fb[fPubOff];
      let pubMatch = true;
      for (let i = 0; i < Math.min(dPubLen, fPubLen); i++) {
        if (db[dPubOff + 1 + i] !== fb[fPubOff + 1 + i]) {
          console.log('Pubkey byte mismatch at index', i);
          pubMatch = false;
          break;
        }
      }
      console.log('Pubkey match:', pubMatch);
    }
  }

  // Build signed tx with frontend and verify
  tx.inputs[0].scriptSig = scriptSig;
  const frontendSigned = buildRawTxHex(tx);
  const decodedFrontend = await rpcCall('decoderawtransaction', [frontendSigned]);
  const frontendScriptSig = decodedFrontend.vin[0].scriptsig?.hex || decodedFrontend.vin[0].scriptSig?.hex;
  console.log('\nRebuilt frontend scriptSig:', frontendScriptSig);
  console.log('Match daemon rebuilt:', frontendScriptSig === daemonScriptSig);

  // Test broadcast (will fail since coinbase UTXO isn't mature, but validates signing format)
  console.log('\n=== Broadcast test (expect mempool rejection, not signing error) ===');
  try {
    const txid = await rpcCall('sendrawtransaction', [frontendSigned, true]);
    console.log('SUCCESS! txid:', txid);
  } catch (e) {
    const msg = e.message.substring(0, 300);
    if (msg.includes('bad-txns-inputs-missingorspent') || msg.includes('txn-missing-pubkey') || msg.includes('non-mandatory-script-verify-flag')) {
      console.log('Expected rejection (UTXO issue, not signing issue):', msg);
    } else if (msg.includes('scriptsig') || msg.includes('signing')) {
      console.log('SIGNING ERROR:', msg);
    } else {
      console.log('Rejection:', msg);
    }
  }
}

main().catch(e => console.error(e));
