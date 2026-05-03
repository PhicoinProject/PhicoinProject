import { rpc } from './rpc';
import type { Asset } from '@/types';

/** Service for PHICOIN native asset protocol operations */
export class AssetService {
  /** List all known assets on the blockchain */
  async listAssets(): Promise<Asset[]> {
    // listassets(asset, verbose, count, start) returns an object keyed by asset name:
    // { "ASSET_NAME": { "name": "...", "amount": N, "units": N, "reissuable": N, "has_ipfs": N, "block_height": N, "blockhash": "..." } }
    const data = await rpc.raw<Record<string, Record<string, unknown>> | null>('listassets', [
      '',
      true,
      1000,
      0,
    ]);
    if (!data) return [];
    return Object.entries(data).map(([assetName, info]) => ({
      assetId: String(info.name ?? assetName),
      assetLabel: String(info.name ?? assetName),
      status: 'ISSUED',
      assetTx: String(info.blockhash ?? ''),
      nonce: Number(info.block_height ?? 0),
      precision: Number(info.units ?? 8),
      previousAmount: Number(info.amount ?? 0),
      previousTransactions: 0,
      ipfsHash: info.ipfs_hash ? String(info.ipfs_hash) : undefined,
    }));
  }

  /**
   * List assets owned by the wallet.
   * Daemon listmyassets(asset, verbose) with verbose=true returns an object
   * keyed by asset name:
   *   { "ASSET_NAME": { "balance": N, "outpoints": [{ txid, vout, amount }, ...] } }
   */
  async listMyAssets(): Promise<Asset[]> {
    const data = await rpc.raw<Record<string, Record<string, unknown>> | null>('listmyassets', [
      '',
      true,
      1000,
      0,
    ]);
    if (!data) return [];
    const assets: Asset[] = [];
    for (const [assetName, info] of Object.entries(data)) {
      const obj = info as Record<string, unknown>;
      const outpoints = (obj.outpoints as Array<Record<string, unknown>>) ?? [];
      assets.push({
        assetId: assetName,
        assetLabel: assetName,
        status: 'ISSUED',
        assetTx: outpoints.length > 0 ? String(outpoints[0].txid ?? '') : '',
        nonce: 0,
        precision: 8,
        previousAmount: Number(obj.balance ?? 0),
        previousTransactions: outpoints.length,
        ipfsHash: undefined,
      });
    }
    return assets;
  }

  /**
   * Get details for a specific asset.
   * Daemon getassetdata(asset_name) returns a flat object with fields:
   *   { name, amount, units, reissuable, has_ipfs, ipfs_hash?, verifier_string? }
   */
  async getAsset(assetId: string): Promise<Asset | null> {
    const data = await rpc.getAsset(assetId);
    // getassetdata returns null if asset doesn't exist
    if (!data || typeof data !== 'object') return null;
    const obj = data as Record<string, unknown>;
    return {
      assetId: String(obj.name ?? assetId),
      assetLabel: String(obj.name ?? assetId),
      status: 'ISSUED',
      assetTx: '',
      nonce: 0,
      precision: Number(obj.units ?? 8),
      previousAmount: Number(obj.amount ?? 0),
      previousTransactions: 0,
      ipfsHash: obj.ipfs_hash ? String(obj.ipfs_hash) : undefined,
    };
  }

  /** Get transactions for a specific asset */
  async getAssetTransactions(assetId: string, count = 10, from = 0): Promise<unknown[]> {
    return rpc.listAssetTransactions(assetId, count, from);
  }

  /** Get unspent outputs for a specific asset */
  async getAssetUnspent(assetId: string): Promise<unknown[]> {
    return rpc.listUnspentAsset(assetId);
  }

  /** Issue a new asset */
  async issueAsset(params: {
    label: string;
    quantity: number;
    decimalPlaces: number;
    isSideChain?: boolean;
    isRevokeable?: boolean;
    isNoAssetGroup?: boolean;
    isIPFS?: boolean;
    ipfsHash?: string;
  }): Promise<string> {
    // Daemon signature: issue(asset_name, qty, to_address, change_address, units, reissuable, has_ipfs, ipfs_hash)
    return rpc.issueAsset(
      params.label,
      params.quantity,
      '',
      '',
      params.decimalPlaces,
      params.isRevokeable ?? false,
      params.isIPFS ?? false,
      params.isIPFS && params.ipfsHash ? params.ipfsHash : ''
    );
  }

  /** Transfer an asset to an address */
  async transferAsset(
    assetId: string,
    qty: number,
    toAddress: string,
    message?: string
  ): Promise<string> {
    return rpc.transferAsset(assetId, qty, toAddress, message || '', 0, '', '');
  }

  /**
   * Get asset receive address.
   * The daemon doesn't have a per-asset receive address RPC, so we use the wallet's
   * getaddressesbyasset RPC (listaddressesbyasset) to find existing addresses, or
   * generate a new one.
   */
  async getAssetAddress(assetId: string): Promise<string> {
    // listaddressesbyasset(asset_name, onlytotal, count, start)
    const data = await rpc.raw<unknown[]>('listaddressesbyasset', [assetId, false, 1, 0]);
    if (data && Array.isArray(data) && data.length > 0) {
      const addr = data[0] as Record<string, unknown>;
      return String(addr.address ?? '');
    }
    // Generate a new address for this asset
    return rpc.getNewAddress(assetId);
  }
}

export const assetService = new AssetService();
