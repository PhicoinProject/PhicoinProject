/** Debug helpers for asset issuance testing */
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

export async function buildP2PKHScriptPubKeyHex(address) {
  const decoded = base58.decode(address);
  if (decoded.length < 25) throw new Error('Invalid address');
  const checksum = decoded.slice(-4);
  const payload = decoded.slice(0, -4);
  const h = sha256(sha256(payload));
  if (h[0] !== checksum[0] || h[1] !== checksum[1] || h[2] !== checksum[2] || h[3] !== checksum[3]) {
    throw new Error('Invalid checksum');
  }
  const h160 = payload.slice(1, 21);
  const OP_DUP = 0x76, OP_HASH160 = 0xa9, OP_PUSH_20 = 0x14, OP_EQUALVERIFY = 0x88, OP_CHECKSIG = 0xac;
  const s = new Uint8Array(25);
  s[0] = OP_DUP; s[1] = OP_HASH160; s[2] = OP_PUSH_20;
  s.set(h160, 3); s[23] = OP_EQUALVERIFY; s[24] = OP_CHECKSIG;
  return toHex(s);
}

export { toHex, hexToArray, concatBytes, hash160 };
