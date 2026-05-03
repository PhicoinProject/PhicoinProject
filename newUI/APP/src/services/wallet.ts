import { rpc } from './rpc';
import type { Address, WalletState } from '@/types';

/** High-level wallet service wrapping RPC calls with business logic */
export class WalletService {
  /** Get total wallet balance */
  async getBalance(): Promise<number> {
    return rpc.getBalance();
  }

  /** Get detailed wallet information */
  async getWalletInfo(): Promise<unknown> {
    return rpc.getWalletInfo();
  }

  /** Generate a new receiving address */
  async createAddress(label = ''): Promise<string> {
    return rpc.getNewAddress(label || undefined);
  }

  /** Get list of addresses with balances */
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
}

export const walletService = new WalletService();
