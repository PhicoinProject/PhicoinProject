import { describe, it, expect } from '@jest/globals';
import * as nobleSecp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { hmac } from '@noble/hashes/hmac';
import { base58 } from '@scure/base';

const hmacSha256 = (key: Uint8Array, ...msgs: Uint8Array[]) => {
  const data = new Uint8Array(msgs.reduce((s, m) => s + m.length, 0));
  let off = 0;
  for (const m of msgs) { data.set(m, off); off += m.length; }
  return hmac(sha256, data, key);
};
nobleSecp.utils.hmacSha256Sync = hmacSha256;

// Inline the message signer functions for testing
const PUB_KEY_HASH = 0x38;

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
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

function signMessage(message: string, privateKey: Uint8Array): string {
  const prefix = '\x18PHICOIN Signed Message:\n';
  const payload = new TextEncoder().encode(prefix + message.length + message);
  const hash = sha256(sha256(payload));

  const derSig = nobleSecp.signSync(hash, privateKey.slice(0, 32), { der: true });

  const sigWithRecovery = new Uint8Array(derSig.length + 1);
  sigWithRecovery.set(derSig);
  sigWithRecovery[derSig.length] = 27;

  return Buffer.from(sigWithRecovery).toString('base64');
}

function verifyMessage(message: string, signature: string, address: string): boolean {
  try {
    const sigBytes = Uint8Array.from(Buffer.from(signature, 'base64'));
    if (sigBytes.length < 2) return false;

    const storedRecoveryId = sigBytes[sigBytes.length - 1];
    const derSig = sigBytes.slice(0, -1);

    const prefix = '\x18PHICOIN Signed Message:\n';
    const payload = new TextEncoder().encode(prefix + message.length + message);
    const hash = sha256(sha256(payload));

    // Try all recovery IDs since signSync does not return the recovery ID
    for (let recId = 0; recId <= 3; recId++) {
      try {
        const sig = nobleSecp.Signature.fromDER(derSig);
        const pubKey = nobleSecp.recoverPublicKey(hash, sig, recId, true);
        const derivedAddress = publicKeyToAddress(pubKey);
        if (derivedAddress === address) return true;
      } catch { /* try next recovery ID */ }
    }
    return false;
  } catch {
    return false;
  }
}

describe('Message Signer', () => {
  describe('signMessage', () => {
    it('should produce a valid DER signature with recovery ID', () => {
      const privateKey = new Uint8Array(32);
      for (let i = 0; i < 32; i++) privateKey[i] = i + 1;

      const signature = signMessage('Hello, PHICOIN!', privateKey);
      const sigBytes = Uint8Array.from(Buffer.from(signature, 'base64'));

      expect(sigBytes.length).toBeGreaterThan(10);
      expect(sigBytes[sigBytes.length - 1]).toBe(27);
    });

    it('should produce different signatures for different messages', () => {
      const privateKey = new Uint8Array(32);
      privateKey[0] = 1;

      const sig1 = signMessage('Message 1', privateKey);
      const sig2 = signMessage('Message 2', privateKey);

      expect(sig1).not.toBe(sig2);
    });

    it('should handle empty message', () => {
      const privateKey = new Uint8Array(32);
      privateKey[0] = 1;

      const signature = signMessage('', privateKey);
      expect(signature.length).toBeGreaterThan(10);
    });

    it('should handle long messages', () => {
      const privateKey = new Uint8Array(32);
      privateKey[0] = 1;
      const longMessage = 'a'.repeat(10000);

      const signature = signMessage(longMessage, privateKey);
      expect(signature.length).toBeGreaterThan(10);
    });
  });

  describe('verifyMessage', () => {
    it('should verify a valid signature', () => {
      const privateKey = new Uint8Array(32);
      for (let i = 0; i < 32; i++) privateKey[i] = i + 1;

      const publicKey = nobleSecp.getPublicKey(privateKey, true);
      const address = publicKeyToAddress(publicKey);
      const message = 'Hello, PHICOIN!';
      const signature = signMessage(message, privateKey);

      expect(verifyMessage(message, signature, address)).toBe(true);
    });

    it('should reject a signature for wrong message', () => {
      const privateKey = new Uint8Array(32);
      privateKey[0] = 1;

      const publicKey = nobleSecp.getPublicKey(privateKey, true);
      const address = publicKeyToAddress(publicKey);
      const signature = signMessage('Original message', privateKey);

      expect(verifyMessage('Tampered message', signature, address)).toBe(false);
    });

    it('should reject a signature for wrong address', () => {
      const privateKey = new Uint8Array(32);
      privateKey[0] = 1;

      const wrongKey = new Uint8Array(32);
      wrongKey[0] = 2;
      const wrongPubKey = nobleSecp.getPublicKey(wrongKey, true);
      const wrongAddress = publicKeyToAddress(wrongPubKey);

      const signature = signMessage('Message', privateKey);
      expect(verifyMessage('Message', signature, wrongAddress)).toBe(false);
    });

    it('should return false for invalid base64', () => {
      expect(verifyMessage('Message', 'not-base64!!!', 'PAnyAddress123')).toBe(false);
    });

    it('should return false for too-short signature', () => {
      const shortSig = Buffer.from(new Uint8Array([0x00])).toString('base64');
      expect(verifyMessage('Message', shortSig, 'PAnyAddress123')).toBe(false);
    });
  });

  describe('publicKeyToAddress', () => {
    it('should produce a P-prefixed address', () => {
      const privateKey = new Uint8Array(32);
      privateKey[0] = 1;
      const pubKey = nobleSecp.getPublicKey(privateKey, true);
      const address = publicKeyToAddress(pubKey);

      expect(address.startsWith('P')).toBe(true);
      expect(address.length).toBeGreaterThan(20);
    });

    it('should produce consistent addresses for same key', () => {
      const privateKey = new Uint8Array(32);
      privateKey[0] = 42;
      const pubKey = nobleSecp.getPublicKey(privateKey, true);

      const addr1 = publicKeyToAddress(pubKey);
      const addr2 = publicKeyToAddress(pubKey);

      expect(addr1).toBe(addr2);
    });

    it('should produce different addresses for different keys', () => {
      const key1 = new Uint8Array(32);
      key1[0] = 1;
      const key2 = new Uint8Array(32);
      key2[0] = 2;

      const pub1 = nobleSecp.getPublicKey(key1, true);
      const pub2 = nobleSecp.getPublicKey(key2, true);

      expect(publicKeyToAddress(pub1)).not.toBe(publicKeyToAddress(pub2));
    });
  });

  describe('Integration: sign and verify flow', () => {
    it('should sign and verify a complete PHICOIN message', () => {
      const privateKey = new Uint8Array(32);
      for (let i = 0; i < 32; i++) privateKey[i] = (i * 37) % 256;

      const publicKey = nobleSecp.getPublicKey(privateKey, true);
      const address = publicKeyToAddress(publicKey);

      const message = 'PHICOIN wallet signature test';
      const signature = signMessage(message, privateKey);

      expect(verifyMessage(message, signature, address)).toBe(true);
      expect(verifyMessage('Wrong message', signature, address)).toBe(false);
    });

    it('should handle special characters in messages', () => {
      const privateKey = new Uint8Array(32);
      privateKey[0] = 1;

      const publicKey = nobleSecp.getPublicKey(privateKey, true);
      const address = publicKeyToAddress(publicKey);

      const messages = [
        'Hello World! 🎉',
        'Line 1\nLine 2',
        'Special chars: <>&"',
        'Numbers: 123456789',
      ];

      for (const message of messages) {
        const signature = signMessage(message, privateKey);
        expect(verifyMessage(message, signature, address)).toBe(true);
      }
    });
  });
});
