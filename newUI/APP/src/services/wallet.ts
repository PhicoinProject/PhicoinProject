import { rpc } from './rpc';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';
import { deriveReceiveAddress, deriveAddressPool, isValidPHICoinAddress } from './addressDerivation';
import type { Address, WalletState, DerivedAddress } from '@/types';

// Number of addresses to pre-generate for the pool
const ADDRESS_POOL_SIZE = 10;

/** High-level wallet service wrapping RPC calls with local HD derivation */
export class WalletService {
  /** Get total wallet balance */
  async getBalance(): Promise<number> {
    return rpc.getBalance();
  }

  /** Get detailed wallet information */
  async getWalletInfo(): Promise<unknown> {
    return rpc.getWalletInfo();
  }

  /**
   * Generate a new receiving address from the in-memory HDKey.
   * Falls back to RPC if HDKey is not available (v1 wallet).
   */
  async createAddress(label?: string): Promise<string> {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (hdKey) {
      // Find next unused address from local derivation
      const network = (this.getLastNetwork() as 'mainnet' | 'testnet') ?? 'mainnet';
      const usedCount = this.getUsedAddressCount();
      const addr = deriveReceiveAddress(hdKey, network, usedCount);
      return addr.address;
    }
    // Fallback to RPC (v1 wallet or no HDKey)
    return rpc.getNewAddress(label || undefined);
  }

  /**
   * Get derived address pool from HDKey.
   * Returns pre-generated addresses for scanning.
   */
  getDerivedAddressPool(): DerivedAddress[] {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) return [];

    const network = (this.getLastNetwork() as 'mainnet' | 'testnet') ?? 'mainnet';
    const usedCount = this.getUsedAddressCount();
    return deriveAddressPool(hdKey, network, usedCount, ADDRESS_POOL_SIZE);
  }

  /** Get list of addresses with balances (RPC-based) */
  async getAddresses(): Promise<Address[]> {
    const data = await rpc.listAddresses();
    const results = data as Record<string, unknown>[];
    return results.map((item) => ({
      address: String(item.address ?? ''),
      label: String(item.label ?? ''),
      isMine: true,
      isWatchOnly: false,
      balance: Number(item.amount ?? 0),
      totalReceived: Number(item.amount ?? 0),
      txids: (item.txids as string[]) ?? [],
    }));
  }

  /** Get recent transactions */
  async getTransactions(count = 10, from = 0): Promise<unknown[]> {
    return rpc.listTransactions('*', count, from);
  }

  /** Get a specific transaction by txid */
  async getTransaction(txid: string): Promise<unknown> {
    return rpc.getTransaction(txid);
  }

  /** Send PHI to an address */
  async sendTo(destination: string, amount: number, comment?: string): Promise<string> {
    return rpc.sendToAddress(destination, amount, comment);
  }

  /** Get current block count */
  async getBlockCount(): Promise<number> {
    return rpc.getBlockCount();
  }

  /** Get UTXO list */
  async getUnspent(minConf = 0): Promise<unknown[]> {
    return rpc.listUnspent(minConf);
  }

  /** Verify if an address is a valid PHICOIN address */
  isValidAddress(address: string): boolean {
    return isValidPHICoinAddress(address);
  }

  /** Build wallet state snapshot */
  async getWalletState(): Promise<WalletState> {
    const [balance, walletInfo, blockCount] = await Promise.all([
      this.getBalance(),
      this.getWalletInfo(),
      this.getBlockCount(),
    ]);

    const info = walletInfo as Record<string, unknown>;

    const blocks = Number(info.blocks ?? 0);
    const headers = Number(info.headers ?? 0);
    const blocksBehind = Math.max(0, headers - blocks);

    return {
      unlocked: !(info.islocked as boolean),
      walletName: String(info.walletname ?? 'unknown'),
      balances: {},
      phiBalance: balance,
      addresses: [],
      currentAddress: '',
      network: (info.network as 'mainnet' | 'testnet') ?? 'mainnet',
      syncStatus: {
        blocks,
        headers,
        synced: blocksBehind < 12,
      },
      lastBlockHeight: blockCount,
      error: null,
    };
  }

  private getLastNetwork(): string {
    // Placeholder: derive from wallet info or stored state
    return 'mainnet';
  }

  private getUsedAddressCount(): number {
    // Placeholder: track used addresses count from transaction history
    return 0;
  }
}

export const walletService = new WalletService();
