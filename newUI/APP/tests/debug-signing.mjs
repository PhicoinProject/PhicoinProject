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

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = mnemonicToSeedSync(mnemonic, '');
const hdKey = HDKey.fromMasterSeed(seed);
const derived = hdKey.derive("m/0'/0'/0'/0/0");
const pk = derived.privateKey;
const pkHex = toHex(pk);
const hdCompressed = derived.publicKey.length === 33 ? derived.publicKey :
  new Uint8Array([derived.publicKey[64] & 1 ? 0x03 : 0x02, ...derived.publicKey.slice(1, 33)]);
console.log('PK hex:', pkHex);
console.log('PK length:', pk.length);
console.log('HDKey pub:', toHex(hdCompressed));

// Test nobleSecp sign
const testMsg = sha256(new Uint8Array([1,2,3]));
const sig1 = nobleSecp.signSync(toHex(testMsg), pkHex);
console.log('\nSign result type:', typeof sig1);
if (typeof sig1 === 'string') {
  console.log('Sign length:', sig1.length);
  console.log('Sign:', sig1.substring(0, 80));
} else {
  console.log('Sign length:', sig1.length);
  console.log('Sign:', toHex(sig1).substring(0, 80));
}

// Get pubkey
const pub1 = nobleSecp.getPublicKey(pkHex, true);
console.log('\nPub key type:', typeof pub1);
if (typeof pub1 === 'string') {
  console.log('Pub key:', pub1);
} else {
  console.log('Pub key length:', pub1.length);
  console.log('Pub key:', toHex(pub1));
}

// Try signing with nobleSecp.sign instead
const sig2 = await nobleSecp.sign(toHex(testMsg), { der: true });
console.log('\nAsync sign result type:', typeof sig2);
if (typeof sig2 === 'string') {
  console.log('Sign:', sig2.substring(0, 80));
} else {
  console.log('Sign length:', sig2.length);
  console.log('Sign:', toHex(sig2).substring(0, 80));
}

// Try signing with private key bytes
const sig3 = await nobleSecp.sign(toHex(testMsg), pk, { der: true });
console.log('\nAsync sign with bytes type:', typeof sig3);
if (typeof sig3 === 'string') {
  console.log('Sign:', sig3.substring(0, 80));
} else {
  console.log('Sign length:', sig3.length);
  console.log('Sign:', toHex(sig3).substring(0, 80));
}
