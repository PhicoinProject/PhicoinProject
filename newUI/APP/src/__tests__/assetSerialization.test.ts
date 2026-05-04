import { describe, it, expect } from '@jest/globals';
import {
  serializeCNewAsset,
  serializeCAssetTransfer,
  serializeCReissueAsset,
  serializeCNullAssetTxData,
  serializeCNullAssetTxVerifierString,
  buildAssetScript,
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
      // OP_PHI_ASSET = 0xc0, OP_DROP = 0x61
      expect(hex).toBe('c001020361');
    });

    it('should handle empty data', () => {
      const data = new Uint8Array([]);
      const hex = buildAssetScript(data);
      expect(hex).toBe('c061');
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
