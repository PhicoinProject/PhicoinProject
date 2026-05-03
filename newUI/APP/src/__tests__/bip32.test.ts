import { seedToHDKey, derivePath, privateKeyToHex, publicKeyToHex } from '@/services/HDWallet';

describe('BIP32 HD Wallet', () => {
  describe('seedToHDKey', () => {
    it('should derive master key from seed', () => {
      const seed = new Uint8Array(64).fill(0);
      const hdKey = seedToHDKey(seed);
      expect(hdKey.publicKey).toBeDefined();
      expect(hdKey.privateKey).toBeDefined();
      expect(hdKey.chainCode).toBeDefined();
    });

    it('should produce known master key for all-zeros seed', () => {
      // @scure/bip32 produces deterministic keys from all-zeros seed
      const seed = new Uint8Array(64).fill(0);
      const hdKey = seedToHDKey(seed);

      // @scure/bip32 actual output for 64-byte all zeros seed
      const privHex = privateKeyToHex(hdKey);
      expect(privHex).toBe('eafd15702fca3f80beb565e66f19e20bbad0a34b46bb12075cbf1c5d94bb27d2');

      const pubHex = publicKeyToHex(hdKey);
      expect(pubHex).toBe('03669261fe20452fe6a03e625944c6a0523e6350b3ea8cbd37c9ca1ff97e3ac8bf');
    });
  });

  describe('derivePath', () => {
    it('should derive child key at standard path', () => {
      const seed = new Uint8Array(64).fill(1);
      const hdKey = seedToHDKey(seed);
      const derived = derivePath(hdKey, "m/44'/0'/0'/0/0");
      expect(derived.publicKey).toBeDefined();
      expect(derived.privateKey).toBeDefined();
    });

    it("should follow PHICOIN path format m/0'/coinType'/0'/change/index", () => {
      const seed = new Uint8Array(64).fill(1);
      const hdKey = seedToHDKey(seed);
      const receive = derivePath(hdKey, "m/0'/0'/0'/0/0");
      const change = derivePath(hdKey, "m/0'/0'/0'/1/0");
      expect(receive.publicKey).not.toEqual(change.publicKey);
    });

    it('should produce different keys for different indices', () => {
      const seed = new Uint8Array(64).fill(1);
      const hdKey = seedToHDKey(seed);
      const addr0 = derivePath(hdKey, "m/0'/0'/0'/0/0");
      const addr1 = derivePath(hdKey, "m/0'/0'/0'/0/1");
      expect(addr0.publicKey).not.toEqual(addr1.publicKey);
    });
  });

  describe('publicKeyToHex / privateKeyToHex', () => {
    it('should return 33-byte compressed public key hex', () => {
      const seed = new Uint8Array(64).fill(0);
      const hdKey = seedToHDKey(seed);
      const pubHex = publicKeyToHex(hdKey);
      expect(pubHex.length).toBe(66); // 33 bytes * 2 hex chars
    });

    it('should return 32-byte private key hex', () => {
      const seed = new Uint8Array(64).fill(0);
      const hdKey = seedToHDKey(seed);
      const privHex = privateKeyToHex(hdKey);
      expect(privHex.length).toBe(64); // 32 bytes * 2 hex chars
    });
  });
});
