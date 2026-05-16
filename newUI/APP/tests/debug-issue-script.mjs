/** Debug exact script bytes for asset issuance - verify against IsAssetScript */

import { buildP2PKHScriptPubKeyHex } from './debug-helpers.mjs';

const BURN_ADDR_SCRIPT = '76a9148684a6449c157dd0a2f393fc5147e47cd4fd9f2588ac';
const TEST_ADDR = 'Pum3xBGkPWK9pcpvanoMyfGTdWYuzMWmsr';

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToArray(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
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
function concatBytes(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

// Build the issue asset script
async function main() {
  const changeScript = await buildP2PKHScriptPubKeyHex(TEST_ADDR);
  console.log('Change script:', changeScript);
  console.log('Change script length:', changeScript.length / 2, 'bytes');
  
  const assetName = 'TEST';
  const quantity = 100000 * 1e8;
  
  // Build rvno owner script
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
  
  console.log('\n=== Owner Script (rvno) ===');
  console.log('Hex:', ownerScriptHex);
  console.log('Length:', ownerScriptHex.length / 2, 'bytes');
  const ownerScript = hexToArray(ownerScriptHex);
  for (let i = 0; i < ownerScript.length; i++) {
    const byte = ownerScript[i];
    const char = byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.';
    console.log(`  [${i.toString().padStart(2)}] 0x${byte.toString(16).padStart(2)} (${byte}) '${char}'`);
  }
  
  // Check IsAssetScript conditions
  console.log('\n--- IsAssetScript checks ---');
  console.log('Size > 31?', ownerScript.length > 31, `(${ownerScript.length})`);
  console.log('Byte[25] == 0xc0?', ownerScript[25] === 0xc0, `(0x${ownerScript[25]?.toString(16)})`);
  console.log('Byte[26] (pushdata len):', ownerScript[26]);
  console.log('Byte[27] == 0x72 (r)?', ownerScript[27] === 0x72, `(0x${ownerScript[27]?.toString(16)})`);
  console.log('Byte[28] == 0x76 (v)?', ownerScript[28] === 0x76, `(0x${ownerScript[28]?.toString(16)})`);
  console.log('Byte[29] == 0x6e (n)?', ownerScript[29] === 0x6e, `(0x${ownerScript[29]?.toString(16)})`);
  const byte4 = ownerScript[30];
  console.log('Byte[30]:', `0x${byte4.toString(16)}`, `(expected 0x6f for owner)`);
  console.log('Is owner (PHI_O=0x6f)?', byte4 === 0x6f);
  
  // Build rvnq issue script
  const CNewAsset = concatBytes(
    writeVarString(assetName),
    writeInt64(quantity),
    new Uint8Array([8]),
    new Uint8Array([1]),
    new Uint8Array([0]),
  );
  console.log('\nCNewAsset data:', toHex(CNewAsset));
  console.log('CNewAsset length:', CNewAsset.length);
  
  const rvnqMagic = new Uint8Array([0x72, 0x76, 0x6e, 0x71]);
  const issuePayload = new Uint8Array(4 + CNewAsset.length);
  issuePayload.set(rvnqMagic, 0); issuePayload.set(CNewAsset, 4);
  const issueScriptHex = changeScript + 'c0' + issuePayload.length.toString(16).padStart(2, '0') + toHex(issuePayload) + '61';
  
  console.log('\n=== Issue Script (rvnq) ===');
  console.log('Hex:', issueScriptHex);
  console.log('Length:', issueScriptHex.length / 2, 'bytes');
  const issueScript = hexToArray(issueScriptHex);
  for (let i = 0; i < issueScript.length; i++) {
    const byte = issueScript[i];
    const char = byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.';
    console.log(`  [${i.toString().padStart(2)}] 0x${byte.toString(16).padStart(2)} (${byte}) '${char}'`);
  }
  
  console.log('\n--- IsAssetScript checks ---');
  console.log('Size > 31?', issueScript.length > 31, `(${issueScript.length})`);
  console.log('Size > 39?', issueScript.length > 39, `(${issueScript.length})`);
  console.log('Byte[25] == 0xc0?', issueScript[25] === 0xc0, `(0x${issueScript[25]?.toString(16)})`);
  console.log('Byte[26] (pushdata len):', issueScript[26]);
  console.log('Byte[27] == 0x72 (r)?', issueScript[27] === 0x72, `(0x${issueScript[27]?.toString(16)})`);
  console.log('Byte[28] == 0x76 (v)?', issueScript[28] === 0x76, `(0x${issueScript[28]?.toString(16)})`);
  console.log('Byte[29] == 0x6e (n)?', issueScript[29] === 0x6e, `(0x${issueScript[29]?.toString(16)})`);
  const issueByte4 = issueScript[30];
  console.log('Byte[30]:', `0x${issueByte4.toString(16)}`, `(expected 0x71 for new asset)`);
  console.log('Is new asset (PHI_Q=0x71)?', issueByte4 === 0x71);
  
  // Build the burn script and check
  console.log('\n=== Burn Script ===');
  console.log('Hex:', BURN_ADDR_SCRIPT);
  console.log('Length:', BURN_ADDR_SCRIPT.length / 2, 'bytes');
  
  // Verify with daemon decoderawtransaction
  const auth = Buffer.from('phi:phi').toString('base64');
  
  // Build a minimal raw transaction with just these outputs to test
  // We'll use decoderawtransaction to verify the daemon recognizes them
  const rpcCall = async (method, params = []) => {
    const resp = await fetch('http://127.0.0.1:28966/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
      body: JSON.stringify({ jsonrpc: '1.0', method, params, id: 1 }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(`RPC ${method} error ${data.error.code}: ${data.error.message.substring(0, 300)}`);
    return data.result;
  };
  
  // Build minimal tx with change + burn + owner + issue outputs
  const writeVarInt = (n) => {
    if (n < 0xfd) return new Uint8Array([n]);
    if (n <= 0xffff) { const b = new Uint8Array(3); b[0] = 0xfd; new DataView(b.buffer).setUint16(1, n, true); return b; }
    return new Uint8Array([0xfe]);
  };
  
  const parts = [];
  const version = new Uint8Array(4); new DataView(version.buffer).setInt32(0, 2, true); parts.push(version);
  parts.push(writeVarInt(1)); // 1 input
  const fakeTxid = new Uint8Array(32); fakeTxid.fill(0); fakeTxid[0] = 0xff; parts.push(fakeTxid); // fake prev txid
  const fakeVout = new Uint8Array(4); new DataView(fakeVout.buffer).setUint32(0, 0, true); parts.push(fakeVout);
  parts.push(writeVarInt(0)); parts.push(new Uint8Array(0)); // empty scriptSig
  const seq = new Uint8Array(4); new DataView(seq.buffer).setUint32(0, 0xffffffff, true); parts.push(seq);
  
  const outputs = [
    { scriptPubKey: changeScript, valueSatoshis: 1000000 },
    { scriptPubKey: BURN_ADDR_SCRIPT, valueSatoshis: 10000000 },
    { scriptPubKey: ownerScriptHex, valueSatoshis: 0 },
    { scriptPubKey: issueScriptHex, valueSatoshis: 0 },
  ];
  
  parts.push(writeVarInt(outputs.length));
  for (const out of outputs) {
    const value = new Uint8Array(8); new DataView(value.buffer).setBigInt64(0, BigInt(out.valueSatoshis), true); parts.push(value);
    const script = hexToArray(out.scriptPubKey); parts.push(writeVarInt(script.length)); parts.push(script);
  }
  const locktime = new Uint8Array(4); parts.push(locktime);
  const rawHex = toHex(concatBytes(...parts));
  
  const decoded = await rpcCall('decoderawtransaction', [rawHex]);
  console.log('\n=== Daemon Decoderawtransaction ===');
  console.log('txid:', decoded.txid);
  console.log('version:', decoded.version);
  console.log('vin count:', decoded.vin.length);
  console.log('vout count:', decoded.vout.length);
  
  decoded.vout.forEach((v, i) => {
    console.log(`\n  Output ${i}:`);
    console.log(`    value: ${v.value}`);
    console.log(`    type: ${v.scriptPubKey.type}`);
    console.log(`    asm: ${v.scriptPubKey.asm?.substring(0, 120)}`);
    console.log(`    hex: ${v.scriptPubKey.hex?.substring(0, 60)}...`);
    console.log(`    reqSigs: ${v.scriptPubKey.reqSigs}`);
  });
}

main().catch(e => console.error('Fatal:', e.message));
