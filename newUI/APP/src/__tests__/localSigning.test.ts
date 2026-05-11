import { describe, it, expect } from '@jest/globals';
import * as nobleSecp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { hmac } from '@noble/hashes/hmac';
import { base58 } from '@scure/base';
import {
  buildRawTransaction,
  toSatoshis,
} from '@/services/assetSerialization';

const hmacSha256 = (key: Uint8Array, ...msgs: Uint8Array[]) => {
  const data = new Uint8Array(msgs.reduce((s, m) => s + m.length, 0));
  let off = 0;
  for (const m of msgs) { data.set(m, off); off += m.length; }
  return hmac(sha256, data, key);
};
nobleSecp.utils.hmacSha256Sync = hmacSha256;

// --- Helpers (mirror assets.ts internals) ---

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToArray(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

function compressPublicKey(pubKey: Uint8Array): Uint8Array {
  if (pubKey.length === 33) return pubKey;
  if (pubKey.length === 65) {
    const parity = pubKey[64] & 1;
    const compressed = new Uint8Array(33);
    compressed[0] = parity === 0 ? 0x02 : 0x03;
    compressed.set(pubKey.slice(1, 33), 1);
    return compressed;
  }
  throw new Error('Invalid public key length');
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

const PUB_KEY_HASH = 0x38; // PHICOIN mainnet P-prefixed

function buildP2PKHScriptPubKey(h160: Uint8Array): Uint8Array {
  const s = new Uint8Array(25);
  s[0] = 0x76; // OP_DUP
  s[1] = 0xa9; // OP_HASH160
  s[2] = 0x14; // OP_PUSH_20
  s.set(h160, 3);
  s[23] = 0x88; // OP_EQUALVERIFY
  s[24] = 0xac; // OP_CHECKSIG
  return s;
}

function publicKeyToAddress(pubKey: Uint8Array): string {
  const h = hash160(pubKey);
  const payload = new Uint8Array(21);
  payload[0] = PUB_KEY_HASH;
  payload.set(h, 1);
  const checksumHash = sha256(sha256(payload));
  const checksum = checksumHash.slice(0, 4);
  const withChecksum = new Uint8Array(25);
  withChecksum.set(payload);
  withChecksum.set(checksum, 21);
  return base58.encode(withChecksum);
}

function readVarInt(bytes: Uint8Array, offset: number): { value: number; size: number } {
  if (bytes[offset] < 0xfd) {
    return { value: bytes[offset], size: 1 };
  }
  if (bytes[offset] === 0xfd) {
    const value = bytes[offset + 1] | (bytes[offset + 2] << 8);
    return { value, size: 3 };
  }
  if (bytes[offset] === 0xfe) {
    const value =
      bytes[offset + 1] | (bytes[offset + 2] << 8) |
      (bytes[offset + 3] << 16) | (bytes[offset + 4] << 24);
    return { value, size: 5 };
  }
  const lo = bytes[offset + 1] | (bytes[offset + 2] << 8) |
    (bytes[offset + 3] << 16) | (bytes[offset + 4] << 24);
  return { value: lo, size: 9 };
}

function writeVarInt(number: number): Uint8Array {
  if (number < 0xfd) return new Uint8Array([number]);
  if (number <= 0xffff) {
    const b = new Uint8Array(3);
    b[0] = 0xfd;
    new DataView(b.buffer).setUint16(1, number, true);
    return b;
  }
  const b = new Uint8Array(5);
  b[0] = 0xfe;
  new DataView(b.buffer).setUint32(1, number, true);
  return b;
}

// --- Core signing functions (mirror assets.ts) ---

function parseRawTx(rawHex: string) {
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
  offset += 4;

  return { version, inputs, outputs, locktime };
}

function computeP2PKHSighash(
  tx: ReturnType<typeof parseRawTx>,
  inputIndex: number,
  scriptPubKey: Uint8Array
): Uint8Array {
  const parts: Uint8Array[] = [];

  const versionBuf = new Uint8Array(4);
  new DataView(versionBuf.buffer).setInt32(0, tx.version, true);
  parts.push(versionBuf);

  parts.push(writeVarInt(tx.inputs.length));

  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    const prevTxIdBytes = hexToArray(inp.prevTxId.split('').reverse().join(''));
    parts.push(prevTxIdBytes);
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
    new DataView(valBuf.buffer).setBigInt64(0, BigInt(out.value), true);
    parts.push(valBuf);
    parts.push(writeVarInt(out.scriptPubKey.length));
    parts.push(out.scriptPubKey);
  }

  const locktimeBuf = new Uint8Array(4);
  new DataView(locktimeBuf.buffer).setUint32(0, tx.locktime, true);
  parts.push(locktimeBuf);

  const sighashBuf = new Uint8Array(4);
  new DataView(sighashBuf.buffer).setUint32(0, 1, true);
  parts.push(sighashBuf);

  const serialized = concatBytes(...parts);
  return sha256(sha256(serialized));
}

function signTxLocally(
  rawHex: string,
  privateKey: Uint8Array,
  scriptPubKey: Uint8Array
): string {
  const tx = parseRawTx(rawHex);

  const sighash = computeP2PKHSighash(tx, 0, scriptPubKey);
  const sig = nobleSecp.signSync(sighash, privateKey.slice(0, 32), { der: true });

  const scriptSig = new Uint8Array(sig.length + 1);
  scriptSig.set(sig);
  scriptSig[sig.length] = 0x01; // SIGHASH_ALL

  // Rebuild with signature
  const parts: Uint8Array[] = [];
  const versionBuf = new Uint8Array(4);
  new DataView(versionBuf.buffer).setInt32(0, tx.version, true);
  parts.push(versionBuf);

  parts.push(writeVarInt(tx.inputs.length));
  for (const inp of tx.inputs) {
    const prevTxIdBytes = hexToArray(inp.prevTxId.split('').reverse().join(''));
    parts.push(prevTxIdBytes);
    const voutBuf = new Uint8Array(4);
    new DataView(voutBuf.buffer).setUint32(0, inp.vout, true);
    parts.push(voutBuf);
    parts.push(writeVarInt(scriptSig.length));
    parts.push(scriptSig);
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

  const locktimeBuf = new Uint8Array(4);
  new DataView(locktimeBuf.buffer).setUint32(0, tx.locktime, true);
  parts.push(locktimeBuf);

  return toHex(concatBytes(...parts));
}

function verifyP2PKHSignature(
  signedTxHex: string,
  inputIndex: number,
  scriptPubKey: Uint8Array,
  pubKey: Uint8Array
): boolean {
  const tx = parseRawTx(signedTxHex);
  const inp = tx.inputs[inputIndex];
  if (!inp || inp.scriptSig.length < 2) return false;

  // Extract DER sig (last byte is sighash)
  const derSig = inp.scriptSig.slice(0, -1);
  const sighash = computeP2PKHSighash(tx, inputIndex, scriptPubKey);

  try {
    return nobleSecp.verify(derSig, sighash, pubKey);
  } catch {
    return false;
  }
}

// --- Tests ---

describe('Local Transaction Signing', () => {
  describe('key derivation and address generation', () => {
    it('should derive a PHICOIN address from a private key', () => {
      const privateKey = new Uint8Array(32);
      for (let i = 0; i < 32; i++) privateKey[i] = i + 1;
      const pubKey = nobleSecp.getPublicKey(privateKey, true);
      const address = publicKeyToAddress(pubKey);
      expect(address.startsWith('P')).toBe(true);
      expect(address.length).toBeGreaterThan(20);
    });

    it('should produce consistent address for same key', () => {
      const privateKey = new Uint8Array(32);
      privateKey[0] = 42;
      const pubKey = nobleSecp.getPublicKey(privateKey, true);
      const addr1 = publicKeyToAddress(pubKey);
      const addr2 = publicKeyToAddress(pubKey);
      expect(addr1).toBe(addr2);
    });

    it('should produce different addresses for different keys', () => {
      const key1 = new Uint8Array(32); key1[0] = 1;
      const key2 = new Uint8Array(32); key2[0] = 2;
      const pub1 = nobleSecp.getPublicKey(key1, true);
      const pub2 = nobleSecp.getPublicKey(key2, true);
      expect(publicKeyToAddress(pub1)).not.toBe(publicKeyToAddress(pub2));
    });
  });

  describe('raw transaction parser', () => {
    it('should parse a simple 1-input 1-output raw tx', () => {
      const scriptPubKey = buildP2PKHScriptPubKey(new Uint8Array(20));
      const rawHex = buildRawTransaction(
        [{ txid: 'a'.repeat(64), vout: 0, sequence: 0xffffffff }],
        [{ scriptPubKey: toHex(scriptPubKey), valueSatoshis: toSatoshis(1) }]
      );

      const tx = parseRawTx(rawHex);
      expect(tx.version).toBe(2);
      expect(tx.inputs.length).toBe(1);
      expect(tx.outputs.length).toBe(1);
      expect(tx.locktime).toBe(0);
      expect(tx.inputs[0].vout).toBe(0);
      expect(tx.inputs[0].scriptSig.length).toBe(0);
    });

    it('should parse multi-input multi-output tx', () => {
      const spk = buildP2PKHScriptPubKey(new Uint8Array(20));
      const spkHex = toHex(spk);
      const rawHex = buildRawTransaction(
        [
          { txid: 'a'.repeat(64), vout: 0 },
          { txid: 'b'.repeat(64), vout: 1 },
        ],
        [
          { scriptPubKey: spkHex, valueSatoshis: 100000000 },
          { scriptPubKey: spkHex, valueSatoshis: 200000000 },
        ]
      );

      const tx = parseRawTx(rawHex);
      expect(tx.inputs.length).toBe(2);
      expect(tx.outputs.length).toBe(2);
    });
  });

  describe('signing flow', () => {
    it('should produce a signed tx with valid DER signature', () => {
      const privateKey = new Uint8Array(32);
      for (let i = 0; i < 32; i++) privateKey[i] = i + 1;
      const pubKey = nobleSecp.getPublicKey(privateKey, true);
      const spk = buildP2PKHScriptPubKey(hash160(pubKey));

      const rawHex = buildRawTransaction(
        [{ txid: 'a'.repeat(64), vout: 0 }],
        [{ scriptPubKey: toHex(spk), valueSatoshis: 100000000 }]
      );

      const signedHex = signTxLocally(rawHex, privateKey, spk);

      const signedTx = parseRawTx(signedHex);
      expect(signedTx.inputs[0].scriptSig.length).toBeGreaterThan(10);
      expect(signedTx.inputs[0].scriptSig[signedTx.inputs[0].scriptSig.length - 1]).toBe(0x01);
    });

    it('should verify signature against public key', () => {
      const privateKey = new Uint8Array(32);
      for (let i = 0; i < 32; i++) privateKey[i] = i + 1;
      const pubKey = nobleSecp.getPublicKey(privateKey, true);
      const spk = buildP2PKHScriptPubKey(hash160(pubKey));

      const rawHex = buildRawTransaction(
        [{ txid: 'a'.repeat(64), vout: 0 }],
        [{ scriptPubKey: toHex(spk), valueSatoshis: 100000000 }]
      );

      const signedHex = signTxLocally(rawHex, privateKey, spk);
      expect(verifyP2PKHSignature(signedHex, 0, spk, pubKey)).toBe(true);
    });

    it('should reject signature with wrong public key', () => {
      const privateKey = new Uint8Array(32);
      for (let i = 0; i < 32; i++) privateKey[i] = i + 1;
      const pubKey = nobleSecp.getPublicKey(privateKey, true);
      const spk = buildP2PKHScriptPubKey(hash160(pubKey));

      const wrongKey = new Uint8Array(32);
      wrongKey[0] = 99;
      const wrongPubKey = nobleSecp.getPublicKey(wrongKey, true);

      const rawHex = buildRawTransaction(
        [{ txid: 'a'.repeat(64), vout: 0 }],
        [{ scriptPubKey: toHex(spk), valueSatoshis: 100000000 }]
      );

      const signedHex = signTxLocally(rawHex, privateKey, spk);
      expect(verifyP2PKHSignature(signedHex, 0, spk, wrongPubKey)).toBe(false);
    });

    it('should produce different signatures for different input txids', () => {
      const privateKey = new Uint8Array(32);
      privateKey[0] = 1;
      const pubKey = nobleSecp.getPublicKey(privateKey, true);
      const spk = buildP2PKHScriptPubKey(hash160(pubKey));

      const raw1 = buildRawTransaction(
        [{ txid: 'a'.repeat(64), vout: 0 }],
        [{ scriptPubKey: toHex(spk), valueSatoshis: 100000000 }]
      );
      const raw2 = buildRawTransaction(
        [{ txid: 'b'.repeat(64), vout: 0 }],
        [{ scriptPubKey: toHex(spk), valueSatoshis: 100000000 }]
      );

      const sig1 = signTxLocally(raw1, privateKey, spk);
      const sig2 = signTxLocally(raw2, privateKey, spk);
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('sighash computation', () => {
    it('should produce deterministic sighash', () => {
      const privateKey = new Uint8Array(32);
      privateKey[0] = 1;
      const pubKey = nobleSecp.getPublicKey(privateKey, true);
      const spk = buildP2PKHScriptPubKey(hash160(pubKey));

      const rawHex = buildRawTransaction(
        [{ txid: 'a'.repeat(64), vout: 0 }],
        [{ scriptPubKey: toHex(spk), valueSatoshis: 100000000 }]
      );

      const tx = parseRawTx(rawHex);
      const hash1 = computeP2PKHSighash(tx, 0, spk);
      const hash2 = computeP2PKHSighash(tx, 0, spk);
      expect(toHex(hash1)).toBe(toHex(hash2));
    });

    it('should produce different sighash for different output values', () => {
      const privateKey = new Uint8Array(32);
      privateKey[0] = 1;
      const pubKey = nobleSecp.getPublicKey(privateKey, true);
      const spk = buildP2PKHScriptPubKey(hash160(pubKey));

      const raw1 = buildRawTransaction(
        [{ txid: 'a'.repeat(64), vout: 0 }],
        [{ scriptPubKey: toHex(spk), valueSatoshis: 100000000 }]
      );
      const raw2 = buildRawTransaction(
        [{ txid: 'a'.repeat(64), vout: 0 }],
        [{ scriptPubKey: toHex(spk), valueSatoshis: 200000000 }]
      );

      const tx1 = parseRawTx(raw1);
      const tx2 = parseRawTx(raw2);
      expect(toHex(computeP2PKHSighash(tx1, 0, spk))).not.toBe(
        toHex(computeP2PKHSighash(tx2, 0, spk))
      );
    });
  });

  describe('full round-trip: build, sign, verify', () => {
    it('should complete the full signing workflow', () => {
      const privateKey = new Uint8Array(32);
      for (let i = 0; i < 32; i++) privateKey[i] = (i * 37) % 256;
      const pubKey = nobleSecp.getPublicKey(privateKey, true);
      const compressedPubKey = compressPublicKey(pubKey);
      const address = publicKeyToAddress(compressedPubKey);

      const spk = buildP2PKHScriptPubKey(hash160(compressedPubKey));

      const rawHex = buildRawTransaction(
        [{ txid: 'a'.repeat(64), vout: 0 }],
        [{ scriptPubKey: toHex(spk), valueSatoshis: toSatoshis(10) }]
      );

      const signedHex = signTxLocally(rawHex, privateKey, spk);

      const signedTx = parseRawTx(signedHex);
      expect(signedTx.inputs.length).toBe(1);
      expect(signedTx.outputs.length).toBe(1);
      expect(signedTx.inputs[0].scriptSig.length).toBeGreaterThan(70);

      expect(verifyP2PKHSignature(signedHex, 0, spk, compressedPubKey)).toBe(true);

      expect(address.startsWith('P')).toBe(true);
    });
  });
});
