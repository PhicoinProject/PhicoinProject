import { generateMnemonicWords, isValidMnemonic, deriveMasterSeed } from '@/services/HDWallet';

describe('BIP39 Mnemonic', () => {
  describe('generateMnemonicWords', () => {
    it('should generate 24 words', () => {
      const mnemonic = generateMnemonicWords();
      const words = mnemonic.split(' ');
      expect(words.length).toBe(24);
    });

    it('should generate different mnemonics each time', () => {
      const m1 = generateMnemonicWords();
      const m2 = generateMnemonicWords();
      expect(m1).not.toBe(m2);
    });

    it('should generate valid mnemonics', () => {
      for (let i = 0; i < 5; i++) {
        const mnemonic = generateMnemonicWords();
        expect(isValidMnemonic(mnemonic)).toBe(true);
      }
    });

    it('should only contain lowercase words separated by spaces', () => {
      const mnemonic = generateMnemonicWords();
      const words = mnemonic.split(' ');
      for (const word of words) {
        expect(word).toMatch(/^[a-z]+$/);
      }
    });
  });

  describe('isValidMnemonic', () => {
    it('should reject empty string', () => {
      expect(isValidMnemonic('')).toBe(false);
    });

    it('should reject random words', () => {
      expect(
        isValidMnemonic(
          'notarealword1 notarealword2 notarealword3 notarealword4 notarealword5 notarealword6 notarealword7 notarealword8 notarealword9 notarealword10 notarealword11 notarealword12 notarealword13 notarealword14 notarealword15 notarealword16 notarealword17 notarealword18 notarealword19 notarealword20 notarealword21 notarealword22 notarealword23 notarealword24'
        )
      ).toBe(false);
    });

    it('should reject too few words', () => {
      expect(
        isValidMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon')
      ).toBe(false);
    });

    it('should accept known BIP39 test vector', () => {
      const testMnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      expect(isValidMnemonic(testMnemonic)).toBe(true);
    });

    it('should reject test vector with wrong checksum word', () => {
      expect(
        isValidMnemonic(
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon acquire'
        )
      ).toBe(false);
    });
  });

  describe('deriveMasterSeed', () => {
    it('should produce 512-byte seed', async () => {
      const mnemonic = generateMnemonicWords();
      const seed = await deriveMasterSeed(mnemonic, '');
      expect(seed.length).toBe(64); // 512 bits = 64 bytes
    });

    it('should produce different seeds with different passphrases', async () => {
      const mnemonic = generateMnemonicWords();
      const seed1 = await deriveMasterSeed(mnemonic, 'password1');
      const seed2 = await deriveMasterSeed(mnemonic, 'password2');
      expect(seed1).not.toEqual(seed2);
    });

    it('should produce deterministic seed for same inputs', async () => {
      const mnemonic = generateMnemonicWords();
      const seed1 = await deriveMasterSeed(mnemonic, 'test');
      const seed2 = await deriveMasterSeed(mnemonic, 'test');
      expect(seed1).toEqual(seed2);
    });

    it('should produce known seed for all-zeros test vector', async () => {
      // BIP39 test vector: all entropy zeros, no passphrase
      const testMnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const seed = await deriveMasterSeed(testMnemonic, '');
      // @scure/bip39 produces deterministic seed from this mnemonic
      const seedHex = Array.from(seed)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      expect(seedHex).toBe(
        '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4'
      );
    });
  });
});
