import { rpc } from './rpc';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';
import { deriveReceiveAddress, isValidPHICoinAddress } from './addressDerivation';
import { buildAndSignOnly, testMempoolAccept, broadcastTx } from './psbt';
import type { Address, WalletState, UTXO, DerivedAddress } from '@/types';
import type { PSBTInput, PSBTOutput } from './psbt';

// Number of addresses to pre-generate for the pool
const ADDRESS_POOL_SIZE = 10;

/**
 * High-level wallet service for the pure frontend wallet.
 * All queries are address-based via the address index; no wallet.dat is required.
 * Callers pass an address pool (array of derived addresses) for scanning.
 */
export class WalletService {
  /**
   * Get total received balance for a pool of addresses.
   * Uses z_getaddressbalance RPC.
   */
  async getBalance(addresses: string[]): Promise<number> {
    if (!addresses.length) return 0;
    const result = await rpc.getAddressBalance(addresses);
    const data = result as Record<string, unknown>;
    return Number((data as any).balance ?? 0) / 1e8;
  }

  /**
   * Generate a new receiving address from the in-memory HDKey.
   * Derives the next unused address from the HD wallet.
   * Throws if HDKey is not available (wallet not unlocked).
   */
  async createAddress(_label?: string): Promise<string> {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) {
      throw new Error('Wallet not unlocked. Import a mnemonic or seed phrase first.');
    }

    const network: 'mainnet' | 'testnet' = 'mainnet';
    const usedCount = await this.getUsedAddressCount(network);
    const addr = deriveReceiveAddress(hdKey, network, usedCount);
    return addr.address;
  }

  /**
   * Get derived address pool from HDKey.
   * Returns pre-generated addresses for scanning.
   */
  getDerivedAddressPool(): DerivedAddress[] {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) return [];

    const network: 'mainnet' | 'testnet' = 'mainnet';
    const usedCount = this.getUsedAddressCountSync(network);
    return this.deriveAddressPool(hdKey, network, usedCount, ADDRESS_POOL_SIZE);
  }

  /**
   * Get all addresses with their balances and transaction counts.
   * Uses z_getaddressbalance and z_getaddresstxids for each address in the pool.
   */
  async getAddresses(addresses: string[]): Promise<Address[]> {
    if (!addresses.length) return [];

    const balanceResult = await rpc.getAddressBalance(addresses, true);
    const balances = balanceResult as Record<string, unknown> | { result: number };

    const results: Address[] = [];

    for (const addr of addresses) {
      const txids = await this.getAddressTxidsFor(addr);
      const hasActivity = txids.length > 0;

      if (!hasActivity) continue;

      // Extract per-address data if the RPC returns a map
      let totalReceived = 0;
      if (typeof balances === 'object' && 'result' in balances) {
        const val = (balances as any).result;
        if (typeof val === 'object' && val[addr]) {
          const entry = val[addr] as { balance?: number; total_received?: number };
          totalReceived = Number(entry.total_received ?? entry.balance ?? 0) / 1e8;
        } else if (typeof val === 'number') {
          totalReceived = val / 1e8;
        }
      }

      results.push({
        address: addr,
        label: '',
        isMine: true,
        isWatchOnly: false,
        balance: totalReceived,
        totalReceived,
        txids: txids.slice(0, 20),
      });
    }

    return results;
  }

  /**
   * Get recent transactions for a pool of addresses.
   * Uses z_getaddresstxids to get txids, then getrawtransaction for details.
   */
  async getTransactions(addresses: string[], count = 20): Promise<unknown[]> {
    if (!addresses.length) return [];

    const allTxIds = await rpc.getAddressTxIds(addresses, true);
    const recentTxIds = allTxIds.slice(0, count);

    const txs: unknown[] = [];
    for (const txid of recentTxIds) {
      try {
        const tx = await rpc.getRawTransaction(txid, 2);
        txs.push(tx);
      } catch {
        // Skip unparseable transactions
        txs.push({ txid, error: 'Failed to decode transaction' });
      }
    }
    return txs;
  }

  /**
   * Get a specific transaction by txid.
   * Uses getrawtransaction with verbose=2 (JSON with hex).
   */
  async getTransaction(txid: string): Promise<unknown> {
    return rpc.getRawTransaction(txid, 2);
  }

  /**
   * Send PHI to a single destination address.
   * Fetches UTXOs, builds and signs a transaction, runs testmempoolaccept
   * pre-flight validation, then broadcasts.
   */
  async sendTo(
    addresses: string[],
    destination: string,
    amount: number,
    feeRate = 1,
    options: { skipPreFlight?: boolean } = {}
  ): Promise<string> {
    if (!destination) throw new Error('Destination address is required');
    if (amount <= 0) throw new Error('Amount must be positive');

    const recipients = [{ address: destination, value: amount }];
    return this.sendToMany(addresses, recipients, feeRate, options);
  }

  /**
   * Send PHI to multiple recipients in a single transaction.
   * Fetches UTXOs, builds and signs, runs testmempoolaccept pre-flight,
   * then broadcasts.
   */
  async sendToMany(
    addresses: string[],
    recipients: { address: string; value: number }[],
    feeRate = 1,
    options: { skipPreFlight?: boolean } = {}
  ): Promise<string> {
    if (!recipients || recipients.length === 0) {
      throw new Error('At least one recipient is required');
    }
    for (const r of recipients) {
      if (!r.address) throw new Error('Recipient address is required');
      if (r.value <= 0) throw new Error('Recipient amount must be positive');
    }

    const utxos = await rpc.getAddressUTXOs(addresses);
    if (!utxos || utxos.length === 0) {
      throw new Error('No UTXOs found for the given addresses');
    }

    const totalOutputSat = recipients.reduce((s, r) => s + Math.floor(r.value * 1e8), 0);
    const psbtInputs: PSBTInput[] = [];
    let totalInputSat = 0;

    for (const utxo of utxos) {
      const u = utxo as Record<string, unknown>;
      const txid = String(u.txid ?? u.txHash ?? '');
      const vout = Number(u.vout ?? u.outputIndex ?? 0);
      const valueSat = Number(u.value ?? u.amount ?? 0);
      const scriptPubKey = String(u.scriptPubKey ?? u.scriptPubKeyHex ?? '');

      totalInputSat += valueSat;

      psbtInputs.push({
        txid,
        vout,
        scriptPubKey,
        value: valueSat / 1e8,
        derivationPath: this.derivePathForAddress(scriptPubKey),
      });

      // Estimate: inputs * 180 + (recipients + 1 change) * 34
      const estimatedSize = psbtInputs.length * 180 + (recipients.length + 1) * 34;
      const estimatedFee = estimatedSize * feeRate;
      if (totalInputSat >= totalOutputSat + estimatedFee + 546) break;
    }

    const estimatedSize = psbtInputs.length * 180 + (recipients.length + 1) * 34;
    const fee = estimatedSize * feeRate;
    const changeSat = totalInputSat - totalOutputSat - fee;

    if (changeSat < 0) {
      throw new Error(
        'Insufficient funds. Need ' +
          ((totalOutputSat + fee - totalInputSat) / 1e8).toFixed(8) +
          ' PHI more.'
      );
    }

    const outputs: PSBTOutput[] = recipients.map((r) => ({
      address: r.address,
      value: r.value,
    }));

    if (changeSat > 546) {
      const hdKey = useWalletHDKeyStore.getState().hdKey;
      if (!hdKey) throw new Error('Wallet not unlocked');

      const network: 'mainnet' | 'testnet' = 'mainnet';
      const usedCount = await this.getUsedAddressCount(network);
      const changeAddr = deriveReceiveAddress(hdKey, network, usedCount + 1);
      outputs.push({ address: changeAddr.address, value: changeSat / 1e8, isChange: true });
    }

    // Build and sign (no broadcast yet)
    const { rawTx } = await buildAndSignOnly({ inputs: psbtInputs, outputs, feeRate });

    // Pre-flight validation via testmempoolaccept
    if (!options.skipPreFlight) {
      try {
        const mempoolResult = await testMempoolAccept(rawTx);
        if (mempoolResult && mempoolResult.length > 0) {
          const first = mempoolResult[0] as Record<string, unknown>;
          if (first.allowed !== true && (first.allowed as unknown) !== 1) {
            const rejectReason = (String(first['reject-reason']) ??
              String(first.reason) ??
              'unknown') as string;
            throw new Error('Transaction rejected by mempool: ' + rejectReason);
          }
        }
      } catch (err) {
        // If testmempoolaccept itself throws (RPC error), propagate
        throw err;
      }
    }

    // Broadcast
    await broadcastTx(rawTx, true);

    // Compute and return txid
    const { sha256 } = await import('@noble/hashes/sha256');
    const { fromHex, toHex } = await import('./crypto');
    const txidHash = sha256(sha256(fromHex(rawTx)));
    const txid = toHex(new Uint8Array([...txidHash].reverse()));
    return txid;
  }

  /**
   * Get a smart fee rate estimate for a confirmation target (in blocks).
   * Returns feeRate as sat/byte, or undefined if the node cannot estimate.
   */
  async estimateSmartFee(confTarget = 6): Promise<number | undefined> {
    try {
      const result = await rpc.estimateSmartFee(confTarget);
      const r = result as Record<string, unknown>;
      // estimatesmartfee returns errors if it can't estimate
      if (r.errors && Array.isArray(r.errors) && r.errors.length > 0) {
        console.warn('estimatesmartfee could not estimate:', r.errors.join(', '));
        return undefined;
      }
      const feerate = r.feerate;
      if (feerate != null) {
        // feerate is in BTC/kvB; convert to sat/byte
        return (Number(feerate) * 1e8) / 1000;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Get UTXOs for a pool of addresses.
   * Uses z_getaddressutxos RPC.
   */
  async getUnspent(addresses: string[]): Promise<UTXO[]> {
    if (!addresses.length) return [];

    const raw = await rpc.getAddressUTXOs(addresses);
    return (raw || []).map((u) => {
      const obj = u as Record<string, unknown>;
      return {
        txid: String(obj.txid ?? obj.txHash ?? ''),
        vout: Number(obj.vout ?? obj.outputIndex ?? 0),
        scriptPubKey: String(obj.scriptPubKey ?? obj.scriptPubKeyHex ?? ''),
        amount: Number(obj.value ?? obj.amount ?? 0) / 1e8,
        confirmations: Number(obj.confirmations ?? obj.confirmationCount ?? 0),
        coinbase: Boolean(obj.coinbase ?? false),
      };
    });
  }

  /**
   * Build a wallet state snapshot from the given address pool.
   */
  async getWalletState(addresses: string[]): Promise<WalletState> {
    const [balance, blockCount, blockchainInfo] = await Promise.all([
      this.getBalance(addresses),
      rpc.getBlockCount(),
      rpc.getBlockchainInfo(),
    ]);

    const info = blockchainInfo as Record<string, unknown>;
    const blocks = Number(info.blocks ?? 0);
    const headers = Number(info.headers ?? 0);
    const blocksBehind = Math.max(0, headers - blocks);

    return {
      unlocked: !!useWalletHDKeyStore.getState().hdKey,
      walletName: 'HD Wallet',
      balances: {},
      phiBalance: balance,
      addresses: [],
      currentAddress: addresses[0] ?? '',
      network: 'mainnet',
      syncStatus: {
        blocks,
        headers,
        synced: blocksBehind < 12,
      },
      lastBlockHeight: blockCount,
      error: null,
    };
  }

  /**
   * Verify if an address is a valid PHICOIN address.
   */
  isValidAddress(address: string): boolean {
    return isValidPHICoinAddress(address);
  }

  /**
   * Get current block count.
   */
  async getBlockCount(): Promise<number> {
    return rpc.getBlockCount();
  }

  // ---- Private helpers ----

  private async getAddressTxidsFor(address: string): Promise<string[]> {
    try {
      return await rpc.getAddressTxIds([address], true);
    } catch {
      return [];
    }
  }

  private async getUsedAddressCount(network: 'mainnet' | 'testnet'): Promise<number> {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) return 0;

    let usedCount = 0;
    for (let i = 0; i < ADDRESS_POOL_SIZE; i++) {
      const addr = deriveReceiveAddress(hdKey, network, i);
      const txids = await this.getAddressTxidsFor(addr.address);
      if (txids.length > 0) {
        usedCount = i + 1;
      } else {
        break;
      }
    }
    return usedCount;
  }

  private getUsedAddressCountSync(_network: 'mainnet' | 'testnet'): number {
    // Synchronous placeholder - returns 0 since we can't do async RPC here.
    // Callers of getDerivedAddressPool should use async methods when possible.
    return 0;
  }

  private deriveAddressPool(
    hdKey: any,
    network: 'mainnet' | 'testnet',
    start: number,
    count: number
  ): DerivedAddress[] {
    const addresses: DerivedAddress[] = [];
    for (let i = start; i < start + count; i++) {
      addresses.push(deriveReceiveAddress(hdKey, network, i));
    }
    return addresses;
  }

  /**
   * Derive a BIP44 path for a given scriptPubKey.
   * Tries common receive/change paths and returns the first match.
   */
  private derivePathForAddress(_scriptPubKey: string): string {
    // Default to first receive path; psbt.ts will derive the correct key.
    // In a full implementation this would scan paths to find the matching address.
    return "m/0'/0'/0'/0/0";
  }
}

export const walletService = new WalletService();
