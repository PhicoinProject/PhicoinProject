import {
  deriveWalletKey,
  generateSalt,
  generateIV,
  encryptData,
  decryptData,
  encryptBinary,
  decryptBinary,
  toHex,
  fromHex,
  sha256,
  sha256d,
  sha256Bytes,
} from '@/services/crypto';

describe('Crypto Service', () => {
  describe('generateSalt / generateIV', () => {
    it('should generate 16-byte salt', () => {
      const salt = generateSalt();
      expect(salt.length).toBe(16);
    });

    it('should generate 12-byte IV', () => {
      const iv = generateIV();
      expect(iv.length).toBe(12);
    });

    it('should generate unique salts', () => {
      const s1 = generateSalt();
      const s2 = generateSalt();
      expect(s1).not.toEqual(s2);
    });
  });

  describe('deriveWalletKey', () => {
    it('should derive a key from password and salt', async () => {
      const salt = generateSalt();
      const key = await deriveWalletKey('test-password', salt, 100000);
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
    });
  });

  describe('encryptData / decryptData (string)', () => {
    it('should roundtrip encrypt and decrypt', async () => {
      const salt = generateSalt();
      const key = await deriveWalletKey('test-password', salt, 100000);
      const iv = generateIV();
      const plaintext = 'Hello, PHICOIN wallet!';

      const encrypted = await encryptData(plaintext, key, iv);
      const decrypted = await decryptData(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce encrypted data larger than plaintext', async () => {
      const salt = generateSalt();
      const key = await deriveWalletKey('test-password', salt, 100000);
      const iv = generateIV();
      const plaintext = 'Test data for encryption';

      const encrypted = await encryptData(plaintext, key, iv);
      expect(encrypted.length).toBeGreaterThan(plaintext.length);
    });

    // P6: decryptData now only supports the 12-byte AES-GCM IV that this app
    // always writes (generateIV / encryptData). The previously-tested 16-byte
    // "legacy" fallback was dead code (nothing in the app ever produced it) and
    // has been removed, so the corresponding test was dropped.
    it('should reject data encrypted with a non-12-byte IV', async () => {
      const salt = generateSalt();
      const key = await deriveWalletKey('test-password', salt, 100000);

      // Encrypt manually with a 16-byte IV (not produced anywhere in the app).
      const legacyIv = new Uint8Array(16);
      crypto.getRandomValues(legacyIv);
      const encoded = new TextEncoder().encode('legacy test');
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: legacyIv.buffer },
        key,
        encoded
      );
      const legacyData = new Uint8Array(legacyIv.length + ciphertext.byteLength);
      legacyData.set(legacyIv, 0);
      legacyData.set(new Uint8Array(ciphertext), legacyIv.length);

      // With only a 12-byte-IV code path, the AES-GCM auth tag check fails.
      await expect(decryptData(legacyData, key)).rejects.toBeDefined();
    });
  });

  describe('encryptBinary / decryptBinary', () => {
    it('should roundtrip binary data', async () => {
      const salt = generateSalt();
      const key = await deriveWalletKey('test-password', salt, 100000);
      const iv = generateIV();
      const original = new Uint8Array([0, 1, 2, 3, 255, 254, 253, 128]);

      const encrypted = await encryptBinary(original, key, iv);
      const decrypted = await decryptBinary(encrypted, key);

      expect(decrypted).toEqual(original);
    });

    it('should handle large binary data (512 bytes)', async () => {
      const salt = generateSalt();
      const key = await deriveWalletKey('test-password', salt, 100000);
      const iv = generateIV();
      const original = new Uint8Array(512);
      crypto.getRandomValues(original);

      const encrypted = await encryptBinary(original, key, iv);
      const decrypted = await decryptBinary(encrypted, key);

      expect(decrypted).toEqual(original);
    });
  });

  describe('toHex / fromHex', () => {
    it('should convert bytes to hex and back', () => {
      const original = new Uint8Array([0, 255, 128, 170, 10]);
      const hex = toHex(original);
      const recovered = fromHex(hex);
      expect(recovered).toEqual(original);
    });

    it('should handle empty array', () => {
      expect(toHex(new Uint8Array(0))).toBe('');
      expect(fromHex('')).toEqual(new Uint8Array(0));
    });
  });

  describe('sha256', () => {
    it('should produce 32-byte hash', async () => {
      const hash = await sha256('test');
      expect(hash.length).toBe(32);
    });

    it('should produce known SHA-256 hash for empty string', async () => {
      const hash = await sha256('');
      const hex = Array.from(hash).map((b) => b.toString(16).padStart(2, '0')).join('');
      expect(hex).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should be deterministic', async () => {
      const h1 = await sha256('same input');
      const h2 = await sha256('same input');
      expect(h1).toEqual(h2);
    });
  });

  describe('sha256d', () => {
    it('should produce 32-byte double hash', async () => {
      const hash = await sha256d('test');
      expect(hash.length).toBe(32);
    });

    it('should differ from single SHA-256', async () => {
      const single = await sha256('test');
      const double = await sha256d('test');
      expect(single).not.toEqual(double);
    });
  });

  describe('sha256Bytes', () => {
    it('should hash binary data', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash = await sha256Bytes(data);
      expect(hash.length).toBe(32);
    });
  });
});
