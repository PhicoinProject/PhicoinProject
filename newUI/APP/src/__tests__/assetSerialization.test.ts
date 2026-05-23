import { describe, it, expect } from '@jest/globals';
import {
  serializeCNewAsset,
  serializeCAssetTransfer,
  serializeCReissueAsset,
  serializeCNullAssetTxData,
  serializeCNullAssetTxVerifierString,
  buildAssetScript,
  encodeAssetPushData,
  toSatoshis,
} from '@/services/assetSerialization';

describe('Asset Serialization', () => {
  describe('toSatoshis', () => {
    it('should convert PHI to satoshis correctly', () => {
      expect(toSatoshis(1)).toBe(100000000);
      expect(toSatoshis(0.5)).toBe(50000000);
      expect(toSatoshis(0.00000001)).toBe(1);
      expect(toSatoshis(0)).toBe(0);
    });
  });

  describe('buildAssetScript', () => {
    it('should wrap data with OP_PHI_ASSET and OP_DROP', () => {
      const data = new Uint8Array([0x01, 0x02, 0x03]);
      const hex = buildAssetScript(data);
      // OP_PHI_ASSET = 0xc0, pushdata len = 0x03, data 010203, OP_DROP = 0x61.
      // CScript << ToByteVector(data) prepends the pushdata length byte (Bitcoin
      // script semantics, matched by the C++ asset-script parser), so the length
      // byte IS part of the correct on-chain output.
      expect(hex).toBe('c00301020361');
    });

    it('should handle empty data', () => {
      const data = new Uint8Array([]);
      const hex = buildAssetScript(data);
      // OP_PHI_ASSET (0xc0), empty push (0x00), OP_DROP (0x61).
      expect(hex).toBe('c00061');
    });

    // ---- Bitcoin SCRIPT pushdata encoding (NOT varint) ----
    // The on-chain asset script after OP_PHI_ASSET uses Bitcoin SCRIPT pushdata:
    //   len < 76        -> single direct length byte (e.g. 0x4b == 75)
    //   len 76..255     -> OP_PUSHDATA1 (0x4c) then 1 length byte
    //   len 256..65535  -> OP_PUSHDATA2 (0x4d) then 2 bytes little-endian
    // This matches C++ CScript::operator<<(vector) and src/assets/assets.cpp.
    it('should use a single direct length byte for a 75-byte payload (boundary, no opcode)', () => {
      const data = new Uint8Array(75).fill(0xab);
      const hex = buildAssetScript(data);
      // c0 (OP_PHI_ASSET) + 4b (direct length 75) + payload + 61 (OP_DROP)
      expect(hex.startsWith('c04b')).toBe(true);
      expect(hex.slice(0, 2)).toBe('c0');
      expect(hex.slice(2, 4)).toBe('4b'); // 75 direct, NOT 0x4c pushdata
      expect(hex.endsWith('61')).toBe(true);
      // Total hex length: (1 + 1 + 75 + 1) bytes * 2
      expect(hex.length).toBe((1 + 1 + 75 + 1) * 2);
    });

    it('should use OP_PUSHDATA1 (0x4c) for a 76-byte payload (boundary)', () => {
      const data = new Uint8Array(76).fill(0xcd);
      const hex = buildAssetScript(data);
      // c0 (OP_PHI_ASSET) + 4c (OP_PUSHDATA1) + 4c (length 76) + payload + 61
      expect(hex.slice(0, 2)).toBe('c0');
      expect(hex.slice(2, 4)).toBe('4c'); // OP_PUSHDATA1
      expect(hex.slice(4, 6)).toBe('4c'); // length 76 == 0x4c
      expect(hex.endsWith('61')).toBe(true);
      // Total: (1 + 1 + 1 + 76 + 1) bytes * 2
      expect(hex.length).toBe((1 + 2 + 76 + 1) * 2);
    });

    it('should use OP_PUSHDATA1 (0x4c) for a 255-byte payload (upper boundary)', () => {
      const data = new Uint8Array(255).fill(0x11);
      const hex = buildAssetScript(data);
      expect(hex.slice(0, 2)).toBe('c0');
      expect(hex.slice(2, 4)).toBe('4c'); // OP_PUSHDATA1
      expect(hex.slice(4, 6)).toBe('ff'); // length 255 == 0xff
      expect(hex.endsWith('61')).toBe(true);
    });

    it('should use OP_PUSHDATA2 (0x4d) + LE length for a ~200-byte... 300-byte payload', () => {
      const data = new Uint8Array(300).fill(0x22);
      const hex = buildAssetScript(data);
      // c0 + 4d (OP_PUSHDATA2) + 2c01 (300 little-endian = 0x012c -> bytes 0x2c 0x01) + payload + 61
      expect(hex.slice(0, 2)).toBe('c0');
      expect(hex.slice(2, 4)).toBe('4d'); // OP_PUSHDATA2
      expect(hex.slice(4, 8)).toBe('2c01'); // 300 = 0x012c, little-endian -> 2c 01
      expect(hex.endsWith('61')).toBe(true);
      // Total: (1 + 1 + 2 + 300 + 1) bytes * 2
      expect(hex.length).toBe((1 + 3 + 300 + 1) * 2);
    });

    it('should keep the documented small-payload output identical (regression)', () => {
      // 3-byte payload must still produce c00301020361 (no pushdata opcode).
      expect(buildAssetScript(new Uint8Array([0x01, 0x02, 0x03]))).toBe('c00301020361');
    });
  });

  describe('encodeAssetPushData', () => {
    it('should direct-push a payload shorter than 76 bytes', () => {
      expect(encodeAssetPushData(new Uint8Array([0xaa, 0xbb]))).toBe('02aabb');
    });

    it('should prefix OP_PUSHDATA1 for 76..255 byte payloads', () => {
      const out = encodeAssetPushData(new Uint8Array(80).fill(0x01));
      expect(out.startsWith('4c50')).toBe(true); // 0x4c then length 80 (0x50)
    });

    it('should prefix OP_PUSHDATA2 + LE length for 256..65535 byte payloads', () => {
      const out = encodeAssetPushData(new Uint8Array(256).fill(0x01));
      expect(out.startsWith('4d0001')).toBe(true); // 0x4d then 256 LE = 00 01
    });

    it('should throw for payloads larger than 65535 bytes', () => {
      expect(() => encodeAssetPushData(new Uint8Array(65536))).toThrow();
    });
  });

  describe('serializeCNewAsset', () => {
    it('should serialize a basic asset', () => {
      const result = serializeCNewAsset({
        name: 'TEST',
        amount: 100000000,
        units: 8,
        reissuable: 0,
        hasIPFS: 0,
      });

      // strName: 0x04 (length) + 'TEST' = 4 bytes + 1 byte = 5 bytes
      // nAmount: 8 bytes LE
      // units: 1 byte
      // nReissuable: 1 byte
      // nHasIPFS: 1 byte
      expect(result.length).toBe(5 + 8 + 1 + 1 + 1);

      // Check the name prefix
      expect(result[0]).toBe(4); // length of "TEST"
      const nameBytes = new TextDecoder().decode(result.slice(1, 5));
      expect(nameBytes).toBe('TEST');
    });

    it('should handle longer asset names', () => {
      const result = serializeCNewAsset({
        name: 'MyLongAssetName',
        amount: 200000000,
        units: 8,
        reissuable: 1,
        hasIPFS: 0,
      });

      const nameLen = result[0];
      expect(nameLen).toBe(15);
      const nameBytes = new TextDecoder().decode(result.slice(1, 1 + nameLen));
      expect(nameBytes).toBe('MyLongAssetName');
    });

    it('should include IPFS hash when hasIPFS is 1', () => {
      const result = serializeCNewAsset({
        name: 'NFT',
        amount: 100000000,
        units: 0,
        reissuable: 0,
        hasIPFS: 1,
        ipfsHash: '1220' + 'a'.repeat(32),
      });

      // name (1 + 3) + amount (8) + units (1) + reissuable (1) + hasIPFS (1) + hash bytes
      const baseLen = 4 + 8 + 1 + 1 + 1;
      expect(result.length).toBeGreaterThan(baseLen);
    });

    it('should throw for names longer than 252 bytes', () => {
      expect(() =>
        serializeCNewAsset({
          name: 'a'.repeat(253),
          amount: 1,
          units: 0,
          reissuable: 0,
          hasIPFS: 0,
        })
      ).toThrow();
    });
  });

  describe('serializeCAssetTransfer', () => {
    it('should serialize a basic transfer', () => {
      const result = serializeCAssetTransfer({
        name: 'TEST',
        amount: 50000000,
      });

      expect(result[0]).toBe(4);
      const nameBytes = new TextDecoder().decode(result.slice(1, 5));
      expect(nameBytes).toBe('TEST');
    });

    it('should include message when provided', () => {
      const result = serializeCAssetTransfer({
        name: 'TEST',
        amount: 50000000,
        message: 'Hello',
      });

      // name (5) + amount (8) + message (1 + 5) = 19 bytes
      expect(result.length).toBe(19);
    });

    it('should include expire time when non-zero', () => {
      const result = serializeCAssetTransfer({
        name: 'TEST',
        amount: 50000000,
        message: '',
        expireTime: 1234567890,
      });

      // name (5) + amount (8) + empty message (1) + expireTime (8) = 22
      expect(result.length).toBe(22);
    });
  });

  describe('serializeCReissueAsset', () => {
    it('should serialize a reissue', () => {
      const result = serializeCReissueAsset({
        name: 'TEST',
        amount: 100000000,
        units: 8,
        reissuable: 1,
      });

      expect(result[0]).toBe(4);
      // name(1+4) + amount(8) + units(1) + reissuable(1) + empty varString(1) = 16
      expect(result.length).toBe(16);
    });

    it('should include IPFS hash when provided', () => {
      const result = serializeCReissueAsset({
        name: 'TEST',
        amount: 100000000,
        units: 8,
        reissuable: 0,
        ipfsHash: '1220' + 'b'.repeat(32),
      });

      expect(result.length).toBeGreaterThan(15);
    });
  });

  describe('serializeCNullAssetTxData', () => {
    it('should serialize freeze/unfreeze operations', () => {
      const result = serializeCNullAssetTxData({
        assetName: 'RESTRICTED',
        flag: 1,
      });

      // name (1 + 10) + flag (1) = 12
      expect(result.length).toBe(12);
      expect(result[0]).toBe(10);
      expect(result[11]).toBe(1);
    });

    it('should handle global freeze flag', () => {
      const result = serializeCNullAssetTxData({
        assetName: 'RESTRICTED',
        flag: 3,
      });

      expect(result[11]).toBe(3);
    });
  });

  describe('serializeCNullAssetTxVerifierString', () => {
    it('should serialize a verifier string', () => {
      const result = serializeCNullAssetTxVerifierString('abc123');
      expect(result[0]).toBe(6);
      const str = new TextDecoder().decode(result.slice(1));
      expect(str).toBe('abc123');
    });

    it('should handle empty string', () => {
      const result = serializeCNullAssetTxVerifierString('');
      expect(result.length).toBe(1);
      expect(result[0]).toBe(0);
    });
  });

  describe('Integration: build complete asset script', () => {
    it('should build a complete issue asset script', () => {
      const serialized = serializeCNewAsset({
        name: 'MYTOKEN',
        amount: 10000000000,
        units: 8,
        reissuable: 1,
        hasIPFS: 0,
      });
      const scriptHex = buildAssetScript(serialized);

      expect(scriptHex.startsWith('c0')).toBe(true);
      expect(scriptHex.endsWith('61')).toBe(true);
    });

    it('should build a complete transfer asset script', () => {
      const serialized = serializeCAssetTransfer({
        name: 'MYTOKEN',
        amount: 50000000,
        message: 'Payment',
      });
      const scriptHex = buildAssetScript(serialized);

      expect(scriptHex.startsWith('c0')).toBe(true);
      expect(scriptHex.endsWith('61')).toBe(true);
    });
  });
});
