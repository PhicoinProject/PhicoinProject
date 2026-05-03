import {
  storeEncryptedSeed,
  retrieveEncryptedSeed,
  hasV2Wallet,
  importEncryptedWallet,
  clearV2Wallet,
} from '@/services/encryptedWallet';

describe('Encrypted Wallet Storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    clearV2Wallet();
  });

  describe('storeEncryptedSeed / retrieveEncryptedSeed', () => {
    it('should encrypt and decrypt master seed', async () => {
      const masterSeed = new Uint8Array(64);
      crypto.getRandomValues(masterSeed);
      const password = 'test-wallet-password-123';

      const exportData = await storeEncryptedSeed(masterSeed, password);
      expect(exportData.version).toBe(2);
      expect(exportData.format).toBe('phicoin-encrypted-wallet');

      const recovered = await retrieveEncryptedSeed(password);
      expect(recovered).toEqual(masterSeed);
    });

    it('should throw on wrong password', async () => {
      const masterSeed = new Uint8Array(64).fill(42);
      await storeEncryptedSeed(masterSeed, 'correct-password');

      await expect(retrieveEncryptedSeed('wrong-password')).rejects.toThrow();
    });

    it('should detect v2 wallet after storage', async () => {
      const masterSeed = new Uint8Array(64).fill(42);
      await storeEncryptedSeed(masterSeed, 'password');

      expect(hasV2Wallet()).toBe(true);
    });

    it('should handle 512-bit seeds (wallet master seed size)', async () => {
      // BIP39 master seed is 512 bits = 64 bytes
      const masterSeed = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        masterSeed[i] = i;
      }
      const password = 'wallet-secret-key-12345';

      await storeEncryptedSeed(masterSeed, password);
      const recovered = await retrieveEncryptedSeed(password);

      expect(recovered).toEqual(masterSeed);
    });
  });

  describe('importEncryptedWallet', () => {
    it('should import exported wallet data', async () => {
      const masterSeed = new Uint8Array(64);
      crypto.getRandomValues(masterSeed);
      const password = 'import-test-password';

      // Store and get export data
      const exportData = await storeEncryptedSeed(masterSeed, password);

      // Clear and re-import
      clearV2Wallet();
      expect(hasV2Wallet()).toBe(false);

      importEncryptedWallet(JSON.stringify(exportData));
      expect(hasV2Wallet()).toBe(true);

      const recovered = await retrieveEncryptedSeed(password);
      expect(recovered).toEqual(masterSeed);
    });

    it('should reject invalid JSON', () => {
      expect(() => importEncryptedWallet('not json')).toThrow();
    });

    it('should reject wrong format', () => {
      expect(() => importEncryptedWallet(JSON.stringify({ format: 'wrong-format' }))).toThrow();
    });

    it('should reject wrong version', () => {
      expect(() =>
        importEncryptedWallet(JSON.stringify({
          version: 99,
          format: 'phicoin-encrypted-wallet',
          encrypted: { iv: '', cipher: '' },
          kdf: { type: 'PBKDF2', iterations: 1, salt: '' },
          meta: { created: '' },
        }))
      ).toThrow();
    });
  });

  describe('clearV2Wallet', () => {
    it('should remove all v2 wallet data', async () => {
      const masterSeed = new Uint8Array(64).fill(42);
      await storeEncryptedSeed(masterSeed, 'password');
      expect(hasV2Wallet()).toBe(true);

      clearV2Wallet();
      expect(hasV2Wallet()).toBe(false);
    });
  });

  describe('hasV2Wallet', () => {
    it('should return false when no wallet exists', () => {
      expect(hasV2Wallet()).toBe(false);
    });
  });
});
