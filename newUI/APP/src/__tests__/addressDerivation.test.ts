import { deriveAddress, deriveReceiveAddress, deriveChangeAddress, deriveAddressRange, deriveScriptPubKeyRange, getScriptPubKeyFromPublicKey, isValidPHICoinAddress } from '@/services/addressDerivation';
import { seedToHDKey } from '@/services/HDWallet';
import { toHex } from '@/services/crypto';

describe('Address Derivation', () => {
  let hdKey: ReturnType<typeof seedToHDKey>;

  beforeEach(() => {
    const seed = new Uint8Array(64);
    for (let i = 0; i < 64; i++) seed[i] = i;
    hdKey = seedToHDKey(seed);
  });

  describe('deriveAddress', () => {
    it('should derive a PHICOIN address', () => {
      const addr = deriveAddress(hdKey, "m/44'/0'/0'/0/0");
      expect(addr.length).toBeGreaterThan(20);
      // PHICOIN P2PKH addresses start with 'P'
      expect(addr[0]).toBe('P');
    });

    it('should produce different addresses for different paths', () => {
      const addr0 = deriveAddress(hdKey, "m/44'/0'/0'/0/0");
      const addr1 = deriveAddress(hdKey, "m/44'/0'/0'/0/1");
      expect(addr0).not.toBe(addr1);
    });

    it('should produce deterministic addresses', () => {
      const addr1 = deriveAddress(hdKey, "m/44'/0'/0'/0/0");
      const addr2 = deriveAddress(hdKey, "m/44'/0'/0'/0/0");
      expect(addr1).toBe(addr2);
    });

    it('should produce Base58Check encoded addresses', () => {
      const addr = deriveAddress(hdKey, "m/44'/0'/0'/0/0");
      expect(addr).toMatch(/^[A-HJ-NP-Za-km-z1-9]+$/);
    });
  });

  describe('deriveReceiveAddress', () => {
    it('should return address with correct metadata', () => {
      const result = deriveReceiveAddress(hdKey, 'mainnet', 0);
      expect(result.address[0]).toBe('P');
      expect(result.isChange).toBe(false);
      expect(result.index).toBe(0);
      expect(result.path).toBe("m/44'/0'/0'/0/0");
    });
  });

  describe('deriveChangeAddress', () => {
    it('should return change address with correct metadata', () => {
      const result = deriveChangeAddress(hdKey, 'mainnet', 0);
      expect(result.address[0]).toBe('P');
      expect(result.isChange).toBe(true);
      expect(result.index).toBe(0);
      expect(result.path).toBe("m/44'/0'/0'/1/0");
    });

    it('should differ from receive address', () => {
      const receive = deriveReceiveAddress(hdKey, 'mainnet', 0);
      const change = deriveChangeAddress(hdKey, 'mainnet', 0);
      expect(receive.address).not.toBe(change.address);
    });
  });

  describe('deriveAddressRange', () => {
    // SAFETY: the batched deriver (chain node derived once) MUST produce byte-for-byte
    // the same addresses/paths as per-index derivation, or the pool would miss funds.
    it('matches deriveReceiveAddress for every index in the range', () => {
      const range = deriveAddressRange(hdKey, 'mainnet', false, 0, 25);
      for (let i = 0; i < 25; i++) {
        const single = deriveReceiveAddress(hdKey, 'mainnet', i);
        expect(range[i].address).toBe(single.address);
        expect(range[i].path).toBe(single.path);
        expect(range[i].index).toBe(i);
        expect(range[i].isChange).toBe(false);
      }
    });

    it('matches deriveChangeAddress for every index in the range', () => {
      const range = deriveAddressRange(hdKey, 'mainnet', true, 0, 25);
      for (let i = 0; i < 25; i++) {
        const single = deriveChangeAddress(hdKey, 'mainnet', i);
        expect(range[i].address).toBe(single.address);
        expect(range[i].path).toBe(single.path);
        expect(range[i].isChange).toBe(true);
      }
    });

    it('honors a non-zero start index', () => {
      const range = deriveAddressRange(hdKey, 'mainnet', false, 17, 5);
      expect(range).toHaveLength(5);
      expect(range[0].index).toBe(17);
      expect(range[0].address).toBe(deriveReceiveAddress(hdKey, 'mainnet', 17).address);
      expect(range[4].address).toBe(deriveReceiveAddress(hdKey, 'mainnet', 21).address);
    });
  });

  describe('deriveScriptPubKeyRange', () => {
    // CORRECTNESS-CRITICAL: this batched deriver feeds the signing-time
    // scriptPubKey -> path lookup. If its scriptPubKeyHex or path drifts by even one
    // byte from the old per-index getScriptPubKeyFromPublicKey path, the signer would
    // pick the wrong key for an input and produce an invalid signature / unspendable
    // funds. Assert byte-for-byte equality with the legacy derivation on both chains.
    it('matches toHex(getScriptPubKeyFromPublicKey(...)) for receive indices 0..24', () => {
      const range = deriveScriptPubKeyRange(hdKey, 'mainnet', false, 0, 25);
      expect(range).toHaveLength(25);
      for (let i = 0; i < 25; i++) {
        const path = `m/44'/0'/0'/0/${i}`;
        const legacyHex = toHex(getScriptPubKeyFromPublicKey(hdKey, path));
        expect(range[i].scriptPubKeyHex).toBe(legacyHex);
        expect(range[i].path).toBe(path);
        expect(range[i].index).toBe(i);
      }
    });

    it('matches toHex(getScriptPubKeyFromPublicKey(...)) for change indices 0..24', () => {
      const range = deriveScriptPubKeyRange(hdKey, 'mainnet', true, 0, 25);
      expect(range).toHaveLength(25);
      for (let i = 0; i < 25; i++) {
        const path = `m/44'/0'/0'/1/${i}`;
        const legacyHex = toHex(getScriptPubKeyFromPublicKey(hdKey, path));
        expect(range[i].scriptPubKeyHex).toBe(legacyHex);
        expect(range[i].path).toBe(path);
        expect(range[i].index).toBe(i);
      }
    });

    it('produces a 25-byte P2PKH scriptPubKey (50 hex chars) per entry', () => {
      const range = deriveScriptPubKeyRange(hdKey, 'mainnet', false, 0, 3);
      for (const entry of range) {
        // OP_DUP OP_HASH160 <20-byte push> OP_EQUALVERIFY OP_CHECKSIG = 25 bytes.
        expect(entry.scriptPubKeyHex).toHaveLength(50);
        expect(entry.scriptPubKeyHex.startsWith('76a914')).toBe(true);
        expect(entry.scriptPubKeyHex.endsWith('88ac')).toBe(true);
      }
    });

    it('honors a non-zero start index on the change chain', () => {
      const range = deriveScriptPubKeyRange(hdKey, 'mainnet', true, 17, 5);
      expect(range).toHaveLength(5);
      expect(range[0].index).toBe(17);
      expect(range[0].path).toBe("m/44'/0'/0'/1/17");
      expect(range[0].scriptPubKeyHex).toBe(
        toHex(getScriptPubKeyFromPublicKey(hdKey, "m/44'/0'/0'/1/17"))
      );
      expect(range[4].path).toBe("m/44'/0'/0'/1/21");
      expect(range[4].scriptPubKeyHex).toBe(
        toHex(getScriptPubKeyFromPublicKey(hdKey, "m/44'/0'/0'/1/21"))
      );
    });
  });

  describe('isValidPHICoinAddress', () => {
    it('should reject empty string', () => {
      expect(isValidPHICoinAddress('')).toBe(false);
    });

    it('should reject invalid characters', () => {
      expect(isValidPHICoinAddress('hello world!')).toBe(false);
    });

    it('should reject too short strings', () => {
      expect(isValidPHICoinAddress('P123')).toBe(false);
    });

    it('should accept derived addresses', () => {
      const addr = deriveAddress(hdKey, "m/44'/0'/0'/0/0");
      expect(isValidPHICoinAddress(addr)).toBe(true);
    });

    it('should reject invalid checksum', () => {
      const addr = deriveAddress(hdKey, "m/44'/0'/0'/0/0");
      // Corrupt last character
      const corrupted = addr.slice(0, -1) + (addr[addr.length - 1] === 'a' ? 'b' : 'a');
      expect(isValidPHICoinAddress(corrupted)).toBe(false);
    });
  });
});
