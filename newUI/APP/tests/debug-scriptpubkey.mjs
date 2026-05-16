/** Debug asset issuance - trace exact script bytes */

import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToArray(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}
function hash160(data) { return ripemd160(sha256(data)); }
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
function concatBytes(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}
function writeVarInt(n) {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) { const b = new Uint8Array(3); b[0] = 0xfd; new DataView(b.buffer).setUint16(1, n, true); return b; }
  const b = new Uint8Array(5); b[0] = 0xfe; new DataView(b.buffer).setUint32(1, n, true); return b;
}

const PUB_KEY_HASH = 0x38;
import { base58 } from '@scure/base';

async function rpcCall(method, params = []) {
  const auth = Buffer.from('phi:phi').toString('base64');
  const resp = await fetch('http://127.0.0.1:28966/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
    body: JSON.stringify({ jsonrpc: '1.0', method, params, id: 1 }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`RPC ${method} error ${data.error.code}: ${data.error.message.substring(0, 500)}`);
  return data.result;
}

function IsAssetScript(scriptBytes) {
  if (scriptBytes.length <= 31) {
    console.log(`  -> IsAssetScript FAIL: size ${scriptBytes.length} <= 31`);
    return { match: false };
  }
  if (scriptBytes[25] !== 0xc0) {
    console.log(`  -> IsAssetScript FAIL: byte[25]=0x${scriptBytes[25].toString(16)} != 0xc0`);
    return { match: false };
  }
  const PHI_R = 0x72, PHI_V = 0x76, PHI_N = 0x6e;
  let index = -1;
  if (scriptBytes[26] < 0xfd) {
    if (scriptBytes[27] === PHI_R && scriptBytes[28] === PHI_V && scriptBytes[29] === PHI_N) index = 30;
  } else if (scriptBytes[26] === 0xfd) {
    if (scriptBytes[28] === PHI_R && scriptBytes[29] === PHI_V && scriptBytes[30] === PHI_N) index = 31;
  } else if (scriptBytes[26] === 0xfe) {
    if (scriptBytes[29] === PHI_R && scriptBytes[30] === PHI_V && scriptBytes[31] === PHI_N) index = 32;
  }
  
  if (index < 0) {
    console.log(`  -> IsAssetScript FAIL: magic not found at index ${index}`);
    return { match: false };
  }
  
  const byte4 = scriptBytes[index];
  const PHI_T = 0x74, PHI_Q = 0x71, PHI_O = 0x6f, PHI_R2 = 0x72;
  if (byte4 === PHI_T) return { match: true, type: 'TX_TRANSFER_ASSET', byte4 };
  if (byte4 === PHI_Q && scriptBytes.length > 39) return { match: true, type: 'TX_NEW_ASSET', byte4 };
  if (byte4 === PHI_O) return { match: true, type: 'TX_NEW_ASSET (owner)', byte4 };
  if (byte4 === PHI_R2) return { match: true, type: 'TX_REISSUE_ASSET', byte4 };
  
  console.log(`  -> IsAssetScript FAIL: byte[${index}]=0x${byte4.toString(16)} ('${String.fromCharCode(byte4)}')`);
  if (byte4 === PHI_Q) console.log(`  -> Also: size=${scriptBytes.length} not > 39`);
  return { match: false };
}

async function main() {
  // Get a UTXO and its script
  const addr = 'Pum3xBGkPWK9pcpvanoMyfGTdWYuzMWmsr';
  const utxos = await rpcCall('getaddressutxos', [{ addresses: [addr] }]);
  const utxoList = Array.isArray(utxos) ? utxos : (utxos?.utxos || [utxos]);
  
  console.log(`Found ${utxoList.length} UTXOs`);
  
  // Build issue asset scripts and check
  const changeScript = utxoList[0]?.script || '';
  console.log(`\nChange script (${changeScript.length} hex chars, ${changeScript.length/2} bytes):`);
  console.log(`  ${changeScript}`);
  
  // Build rvno owner script
  const assetName = 'TEST';
  const quantity = 100000 * 1e8;
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
  const ownerScriptHex = changeScript + 'c0' + ownerPayload.length.toString(16).padStart(2, '0') + toHex(ownerPayload) + '61';
  const ownerScript = hexToArray(ownerScriptHex);
  
  console.log(`\nOwner script (${ownerScript.length} bytes):`);
  console.log(`  ${ownerScriptHex.substring(0, 60)}...`);
  const ownerCheck = IsAssetScript(ownerScript);
  console.log(`  Result: ${ownerCheck.match ? ownerCheck.type : 'FAIL'}`);
  
  // Build rvnq issue script
  const CNewAsset = concatBytes(
    writeVarString(assetName),
    writeInt64(quantity),
    new Uint8Array([8]),
    new Uint8Array([1]),
    new Uint8Array([0]),
  );
  const rvnqMagic = new Uint8Array([0x72, 0x76, 0x6e, 0x71]);
  const issuePayload = new Uint8Array(4 + CNewAsset.length);
  issuePayload.set(rvnqMagic, 0); issuePayload.set(CNewAsset, 4);
  const issueScriptHex = changeScript + 'c0' + issuePayload.length.toString(16).padStart(2, '0') + toHex(issuePayload) + '61';
  const issueScript = hexToArray(issueScriptHex);
  
  console.log(`\nIssue script (${issueScript.length} bytes):`);
  console.log(`  ${issueScriptHex.substring(0, 60)}...`);
  const issueCheck = IsAssetScript(issueScript);
  console.log(`  Result: ${issueCheck.match ? issueCheck.type : 'FAIL'}`);
  
  // Now build the full transaction
  const burnAmount = Math.floor(0.1 * 1e8);
  const feeSat = 500000;
  const totalSat = utxoList.reduce((s, u) => s + u.satoshis, 0);
  const changeValue = totalSat - feeSat - burnAmount;
  console.log(`\nBalance: ${totalSat} sat, Burn: ${burnAmount}, Fee: ${feeSat}, Change: ${changeValue}`);
  
  if (changeValue <= 0) {
    console.log('\n!! INSUFFICIENT FUNDS - cannot issue asset');
    console.log('Need at least 0.105 PHI for burn + fees, have', (totalSat / 1e8).toFixed(4), 'PHI');
    return;
  }
  
  const outputs = [];
  if (changeValue > 546) {
    outputs.push({ scriptPubKey: changeScript, valueSatoshis: changeValue });
  }
  outputs.push({ scriptPubKey: '76a9148684a6449c157dd0a2f393fc5147e47cd4fd9f2588ac', valueSatoshis: burnAmount });
  outputs.push({ scriptPubKey: ownerScriptHex, valueSatoshis: 0 });
  outputs.push({ scriptPubKey: issueScriptHex, valueSatoshis: 0 });
  
  // Build raw tx
  const parts = [];
  const version = new Uint8Array(4); new DataView(version.buffer).setInt32(0, 2, true); parts.push(version);
  parts.push(writeVarInt(1));
  const txidBytes = new Uint8Array(32);
  const origTxid = hexToArray(utxoList[0].txid);
  for (let j = 0; j < 32; j++) txidBytes[j] = origTxid[31 - j];
  parts.push(txidBytes);
  const vout = new Uint8Array(4); new DataView(vout.buffer).setUint32(0, utxoList[0].outputIndex, true); parts.push(vout);
  parts.push(writeVarInt(0)); parts.push(new Uint8Array(0));
  const seq = new Uint8Array(4); new DataView(seq.buffer).setUint32(0, 0xffffffff, true); parts.push(seq);
  parts.push(writeVarInt(outputs.length));
  for (const out of outputs) {
    const value = new Uint8Array(8); new DataView(value.buffer).setBigInt64(0, BigInt(out.valueSatoshis), true); parts.push(value);
    const script = hexToArray(out.scriptPubKey); parts.push(writeVarInt(script.length)); parts.push(script);
  }
  const locktimeBytes = new Uint8Array(4); new DataView(locktimeBytes.buffer).setUint32(0, 0, true); parts.push(locktimeBytes);
  const rawTxHex = toHex(concatBytes(...parts));
  
  console.log(`\nRaw tx (${rawTxHex.length} hex chars):`);
  
  // Decode with daemon
  const decoded = await rpcCall('decoderawtransaction', [rawTxHex]);
  console.log(`Decoded txid: ${decoded.txid}`);
  console.log(`\nDaemon decoded outputs:`);
  decoded.vout.forEach((v, i) => {
    const hex = v.scriptPubKey.hex;
    const script = hexToArray(hex);
    console.log(`  [${i}] value=${v.value} (${v.scriptPubKey.reqSigs || 0} sigs) type=${v.scriptPubKey.type}`);
    console.log(`      ${v.scriptPubKey.asm?.substring(0, 100)}`);
    const check = IsAssetScript(script);
    if (!check.match && (hex.length > 50)) {
      console.log(`      -> IsAssetScript check: ${JSON.stringify(check)}`);
    }
  });
}

main().catch(e => console.error('Fatal:', e.message));
