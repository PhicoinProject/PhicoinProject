import { describe, it, expect, beforeEach } from '@jest/globals';
import { HDKey } from '@scure/bip32';
import { scanChain, ScanDeps } from '@/services/chainScanner';

function createTestHDKey(): HDKey {
  const seed = new Uint8Array(64);
  for (let i = 0; i < 64; i++) seed[i] = i;
  return HDKey.fromMasterSeed(seed);
}

describe('Chain Scanner', () => {
  let hdKey: HDKey;
  let mockDeps: ScanDeps;

  beforeEach(() => {
    hdKey = createTestHDKey();

    mockDeps = {
      derive: (_hdKey, _network, index) => ({
        address: `PtestAddress${index}`,
        path: `m/44'/0'/0'/0/${index}`,
        index,
      }),
      getAddressTxIds: async () => [],
      getAddressBalance: async () => ({ balance: 0 }),
    };
  });

  describe('scanChain - address derivation', () => {
    it('should derive addresses starting from index 0', async () => {
      const result = await scanChain(hdKey, {
        network: 'mainnet',
        gapLimit: 5,
        batchSize: 5,
      }, mockDeps);

      expect(result.totalScanned).toBe(5);
      expect(result.lastUsedIndex).toBe(-1);
    });

    it('should derive the correct number of addresses for a given gap', async () => {
      const gapLimit = 10;
      const result = await scanChain(hdKey, {
        network: 'mainnet',
        gapLimit,
        batchSize: 5,
      }, mockDeps);

      expect(result.totalScanned).toBe(gapLimit);
      expect(result.unusedAddresses.length).toBe(gapLimit);
    });

    it('should derive addresses for the correct network', async () => {
      let lastNetwork = '';
      mockDeps.derive = (_hdKey, network, index) => {
        lastNetwork = network;
        return {
          address: `PtestAddress${index}`,
          path: `m/44'/0'/0'/0/${index}`,
          index,
        };
      };

      await scanChain(hdKey, {
        network: 'testnet',
        gapLimit: 3,
        batchSize: 3,
      }, mockDeps);

      expect(lastNetwork).toBe('testnet');
    });
  });

  describe('scanChain - used address detection', () => {
    it('should mark addresses as used when tx history exists', async () => {
      mockDeps.getAddressTxIds = async () => ['txid1', 'txid2'];
      mockDeps.getAddressBalance = async () => ({ balance: 10000000000 });

      const result = await scanChain(hdKey, {
        network: 'mainnet',
        gapLimit: 20,
        batchSize: 5,
      }, mockDeps);

      expect(result.usedAddresses.length).toBeGreaterThan(0);
      expect(result.lastUsedIndex).toBeGreaterThanOrEqual(0);
    });

    it('should mark addresses as unused when no tx history', async () => {
      const result = await scanChain(hdKey, {
        network: 'mainnet',
        gapLimit: 5,
        batchSize: 5,
      }, mockDeps);

      expect(result.usedAddresses.length).toBe(0);
      expect(result.unusedAddresses.length).toBe(5);
      expect(result.lastUsedIndex).toBe(-1);
    });

    it('should continue scanning past used addresses until gap limit', async () => {
      let batchCount = 0;
      mockDeps.getAddressTxIds = async () => {
        batchCount++;
        if (batchCount === 1) {
          return ['txid1', 'txid2'];
        }
        return [];
      };

      const result = await scanChain(hdKey, {
        network: 'mainnet',
        gapLimit: 10,
        batchSize: 5,
      }, mockDeps);

      // Used at index 0, then unused. gapLimit=10 → stop after exactly 10 consecutive
      // unused (indices 1..10), i.e. 11 addresses scanned. (Previously the scan over-ran
      // to the batch boundary at 15; the gap break is now address-granular.)
      expect(result.totalScanned).toBe(11);
      expect(result.lastUsedIndex).toBe(0);
    });
  });

  describe('scanChain - balance aggregation', () => {
    it('should aggregate total balance from used addresses', async () => {
      mockDeps.getAddressTxIds = async () => ['txid1'];
      mockDeps.getAddressBalance = async () => ({ balance: 5050000000 });

      const result = await scanChain(hdKey, {
        network: 'mainnet',
        gapLimit: 20,
        batchSize: 5,
      }, mockDeps);

      expect(result.totalBalance).toBeGreaterThan(0);
    });

    it('should report zero balance when RPC fails', async () => {
      mockDeps.getAddressTxIds = async () => ['txid1'];
      mockDeps.getAddressBalance = async () => { throw new Error('RPC error'); };

      const result = await scanChain(hdKey, {
        network: 'mainnet',
        gapLimit: 5,
        batchSize: 5,
      }, mockDeps);

      expect(result.totalBalance).toBe(0);
    });

    it('should report zero balance when no addresses are used', async () => {
      const result = await scanChain(hdKey, {
        network: 'mainnet',
        gapLimit: 3,
        batchSize: 3,
      }, mockDeps);

      expect(result.totalBalance).toBe(0);
      expect(result.usedAddresses.length).toBe(0);
    });
  });

  describe('scanChain - result structure', () => {
    it('should return a result with all required fields', async () => {
      const result = await scanChain(hdKey, {
        network: 'mainnet',
        gapLimit: 5,
        batchSize: 5,
      }, mockDeps);

      expect(result).toHaveProperty('totalScanned');
      expect(result).toHaveProperty('usedAddresses');
      expect(result).toHaveProperty('unusedAddresses');
      expect(result).toHaveProperty('totalBalance');
      expect(result).toHaveProperty('lastUsedIndex');

      expect(Array.isArray(result.usedAddresses)).toBe(true);
      expect(Array.isArray(result.unusedAddresses)).toBe(true);
      expect(typeof result.totalScanned).toBe('number');
      expect(typeof result.totalBalance).toBe('number');
      expect(typeof result.lastUsedIndex).toBe('number');
    });

    it('should include path and index in used address entries', async () => {
      mockDeps.getAddressTxIds = async () => ['txid1'];
      mockDeps.getAddressBalance = async () => ({ balance: 1000000000 });

      const result = await scanChain(hdKey, {
        network: 'mainnet',
        gapLimit: 20,
        batchSize: 5,
      }, mockDeps);

      if (result.usedAddresses.length > 0) {
        const entry = result.usedAddresses[0];
        expect(entry).toHaveProperty('address');
        expect(entry).toHaveProperty('balance');
        expect(entry).toHaveProperty('txCount');
        expect(entry).toHaveProperty('path');
        expect(entry).toHaveProperty('index');
        expect(typeof entry.index).toBe('number');
        expect(typeof entry.path).toBe('string');
        expect(entry.path).toMatch(/^m\//);
      }
    });
  });

  describe('scanChain - defaults', () => {
    it('should use default gap limit of 20 when not specified', async () => {
      const result = await scanChain(hdKey, {
        network: 'mainnet',
      }, mockDeps);

      expect(result.totalScanned).toBe(20);
    });
  });
});
