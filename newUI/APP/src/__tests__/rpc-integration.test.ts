import { describe, it, expect } from '@jest/globals';
import { RpcClient } from '@/services/rpc';

const rpc = new RpcClient({
  host: '127.0.0.1',
  port: 28966,
  user: 'phi',
  password: 'phi',
});

describe('RPC Integration', () => {
  describe('getblockchaininfo', () => {
    it('should return blockchain info with chain and blocks', async () => {
      const info = await rpc.raw('getblockchaininfo');
      expect(info).toBeDefined();
      expect(info).toHaveProperty('chain');
      expect(info).toHaveProperty('blocks');
      expect(typeof info.blocks).toBe('number');
      expect(info.blocks).toBeGreaterThanOrEqual(0);
    }, 15000);
  });

  describe('getblockcount', () => {
    it('should return a number', async () => {
      const count = await rpc.raw('getblockcount');
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    }, 15000);
  });

  describe('getnetworkinfo', () => {
    it('should return network info', async () => {
      const info = await rpc.raw('getnetworkinfo');
      expect(info).toBeDefined();
      expect(info).toHaveProperty('version');
      expect(info).toHaveProperty('subversion');
      expect(info).toHaveProperty('protocolversion');
      expect(info).toHaveProperty('connections');
    });
  });

  describe('getmempoolinfo', () => {
    it('should return mempool info', async () => {
      const info = await rpc.raw('getmempoolinfo');
      expect(info).toBeDefined();
      expect(info).toHaveProperty('size');
      expect(info).toHaveProperty('bytes');
    });
  });

  describe('listassets', () => {
    it('should return asset list (may be empty)', async () => {
      const assets = await rpc.raw('listassets', ['', true, 1000, 0]);
      expect(assets).toBeDefined();
    });
  });

  describe('getassetdata with non-existent asset', () => {
    it('should return null or throw an error', async () => {
      const nonExistent = 'NONEXISTENT_ASSET_12345';
      try {
        const result = await rpc.raw('getassetdata', [nonExistent]);
        expect(result).toBeNull();
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  describe('getrawtransaction with a known block tx', () => {
    it('should return transaction data from a known block', async () => {
      // Use block 100 to avoid potential genesis block edge cases
      const blockHash = await rpc.raw('getblockhash', [100]);
      expect(typeof blockHash).toBe('string');

      const block = await rpc.raw('getblock', [blockHash, 1]);
      expect(block).toHaveProperty('tx');
      expect(Array.isArray(block.tx)).toBe(true);

      // getblock verbosity=1 returns tx hashes as strings
      const txHash = block.tx[0];
      expect(typeof txHash).toBe('string');

      const tx = await rpc.raw('getrawtransaction', [txHash, 1]);
      expect(tx).toBeDefined();
      expect(tx).toHaveProperty('txid');
    });
  });

  describe('getpeerinfo', () => {
    it('should return a peer array', async () => {
      const peers = await rpc.raw('getpeerinfo');
      expect(Array.isArray(peers)).toBe(true);
    });
  });

  describe('estimateSmartFee', () => {
    it('should return fee estimation', async () => {
      const fee = await rpc.raw('estimatesmartfee', [6]);
      expect(fee).toBeDefined();
    });
  });

  describe('help', () => {
    it('should return help text', async () => {
      const help = await rpc.raw('help');
      expect(typeof help).toBe('string');
      expect(help.length).toBeGreaterThan(0);
    });
  });
});
