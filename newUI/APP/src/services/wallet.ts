import { rpc } from './rpc';
import { HDKey } from '@scure/bip32';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';
import { deriveReceiveAddress, deriveChangeAddress, isValidPHICoinAddress, getScriptPubKeyFromPublicKey } from './addressDerivation';
import { buildAndSignOnly, testMempoolAccept, broadcastTx } from './psbt';
import { scanChain } from './chainScanner';
import { toHex } from './crypto';
import type { Address, WalletState, UTXO, DerivedAddress, AddressBalanceResult } from '@/types';
import type { PSBTInput, PSBTOutput } from './psbt';
import type { ChainScanResult } from './chainScanner';

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
    let total = 0;
    for (const addr of addresses) {
      try {
        const result = await rpc.getAddressBalance(addr);
        const data = result as AddressBalanceResult;
        const rawBalance = 'balance' in data ? data.balance : data.result.balance;
        total += Number(rawBalance ?? 0) / 1e8;
      } catch {
        // Skip addresses with errors
      }
    }
    return total;
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
   * Get derived address pool from HDKey (synchronous).
   *
   * Returns a pool covering BOTH the receive chain and the change chain so
   * balance/UTXO queries don't miss funds sitting on change addresses.
   * This is a best-effort pool starting at index 0; it does not perform RPC.
   * For a window aligned to actually-used indices, use
   * {@link getDerivedAddressPoolAsync}.
   */
  getDerivedAddressPool(): DerivedAddress[] {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) return [];

    const network: 'mainnet' | 'testnet' = 'mainnet';
    return this.deriveCombinedPool(hdKey, network, 0, ADDRESS_POOL_SIZE);
  }

  /**
   * Async variant of {@link getDerivedAddressPool} that discovers how many
   * addresses have actually been used (via RPC) and returns a pool that spans
   * from index 0 up to usedCount + ADDRESS_POOL_SIZE on the receive chain,
   * plus the corresponding change-chain addresses.
   *
   * Use this in polling/refresh paths so balances are populated even when a
   * wallet has used addresses beyond the default pool window. Never call from
   * a synchronous render path.
   */
  async getDerivedAddressPoolAsync(): Promise<DerivedAddress[]> {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) return [];

    const network: 'mainnet' | 'testnet' = 'mainnet';
    // Scan BOTH chains for usage (gap-limit scan) so addresses holding funds/assets on
    // either the receive OR the change chain are discovered. The previous version only
    // counted the receive chain, so assets/UTXOs sitting on change addresses were missed.
    const [recvUsed, changeUsed] = await Promise.all([
      this.getUsedCountForChain(network, false),
      this.getUsedCountForChain(network, true),
    ]);
    const recvCount = Math.max(ADDRESS_POOL_SIZE, recvUsed + ADDRESS_POOL_SIZE);
    const changeCount = Math.max(ADDRESS_POOL_SIZE, changeUsed + ADDRESS_POOL_SIZE);
    const out: DerivedAddress[] = [];
    for (let i = 0; i < recvCount; i++) out.push(deriveReceiveAddress(hdKey, network, i));
    for (let i = 0; i < changeCount; i++) out.push(deriveChangeAddress(hdKey, network, i));
    return out;
  }

  /**
   * Gap-limit scan of one chain: keep scanning until SCAN_GAP consecutive addresses have
   * no transactions, then return (last-used index + 1). Covers both receive and change.
   */
  private async getUsedCountForChain(
    network: 'mainnet' | 'testnet',
    isChange: boolean
  ): Promise<number> {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) return 0;
    const BATCH = 20; // also the gap limit: a full unused batch ends the scan
    const HARD_CAP = 1000;
    let lastUsed = -1;
    for (let start = 0; start < HARD_CAP; start += BATCH) {
      const indices = Array.from({ length: BATCH }, (_, k) => start + k);
      const addrs = indices.map((i) =>
        isChange
          ? deriveChangeAddress(hdKey, network, i).address
          : deriveReceiveAddress(hdKey, network, i).address
      );
      // Query the whole batch in parallel (one round-trip per BATCH addresses).
      const results = await Promise.all(addrs.map((a) => this.getAddressTxidsFor(a)));
      let anyUsed = false;
      results.forEach((txids, k) => {
        if (txids.length > 0) {
          lastUsed = indices[k];
          anyUsed = true;
        }
      });
      if (!anyUsed) break; // a full batch with no usage → past the gap, stop scanning
    }
    return lastUsed + 1;
  }

  /**
   * Get all addresses with their balances and transaction counts.
   * Uses z_getaddressbalance and z_getaddresstxids for each address in the pool.
   */
  async getAddresses(addresses: string[]): Promise<Address[]> {
    if (!addresses.length) return [];

    const results: Address[] = [];

    for (const addr of addresses) {
      const txids = await this.getAddressTxidsFor(addr);
      const hasActivity = txids.length > 0;

      if (!hasActivity) continue;

      let totalReceived = 0;
      try {
        const result = await rpc.getAddressBalance(addr);
        const data = result as AddressBalanceResult;
        const balanceVal = 'balance' in data ? data.balance : data.result.balance;
        totalReceived = Number(balanceVal ?? 0) / 1e8;
      } catch {
        // Skip addresses with errors
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

    const allTxIds: string[] = [];
    for (const addr of addresses) {
      try {
        const txids = await rpc.getAddressTxIds(addr);
        allTxIds.push(...txids);
      } catch {
        // Skip addresses with errors
      }
    }
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
    // PHICOIN's relay-fee floor is 0.01 PHI/kB (= 1000 sat/byte). A lower fee rate is
    // rejected by the daemon ("min relay fee not met"), so never go under it.
    feeRate = Math.max(feeRate, 1000);

    if (!recipients || recipients.length === 0) {
      throw new Error('At least one recipient is required');
    }
    for (const r of recipients) {
      if (!r.address) throw new Error('Recipient address is required');
      if (r.value <= 0) throw new Error('Recipient amount must be positive');
    }

    const rawUtxos = await rpc.getAddressUTXOsBatch(addresses);
    if (!rawUtxos || rawUtxos.length === 0) {
      throw new Error('No UTXOs found for the given addresses');
    }
    // Exclude UTXOs already spent by unconfirmed mempool txs so rapid successive sends
    // don't fail with "txn-mempool-conflict".
    const spentKeys = await this.getMempoolSpentKeys(addresses);
    const utxos = rawUtxos.filter((u) => {
      const o = u as Record<string, unknown>;
      const key = `${String(o.txid ?? o.txHash ?? '')}:${Number(o.vout ?? o.outputIndex ?? 0)}`;
      return !spentKeys.has(key);
    });
    if (utxos.length === 0) {
      throw new Error('All UTXOs are pending in the mempool; wait for a confirmation.');
    }

    const totalOutputSat = recipients.reduce((s, r) => s + Math.round(r.value * 1e8), 0);
    const psbtInputs: PSBTInput[] = [];
    let totalInputSat = 0;

    for (const utxo of utxos) {
      const u = utxo as Record<string, unknown>;
      const txid = String(u.txid ?? u.txHash ?? '');
      const vout = Number(u.vout ?? u.outputIndex ?? 0);
      const valueSat = Number(u.satoshis ?? u.value ?? u.amount ?? 0);
      const scriptPubKey = String(u.scriptPubKey ?? u.script ?? u.scriptPubKeyHex ?? '');

      const path = this.derivePathForAddress(scriptPubKey);
      if (!path) {
        console.warn(`Could not derive path for scriptPubKey: ${scriptPubKey}`);
        continue;
      }

      totalInputSat += valueSat;
      psbtInputs.push({
        txid,
        vout,
        scriptPubKey,
        value: valueSat / 1e8,
        derivationPath: path,
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
      // Use change chain (m/44'/coinType'/0'/1/{n}) for change outputs.
      // Reuse current change address until fully spent (Electrum model).
      const changeIndex = this.getCurrentChangeIndex(network);
      const changeAddr = deriveChangeAddress(hdKey, network, changeIndex);
      outputs.push({ address: changeAddr.address, value: changeSat / 1e8, isChange: true });
    }

    // SECURITY (P5): the input values + scripts above come from the daemon's
    // address index (getaddressutxos) and are trusted for fee math and the
    // sighash. Before signing, independently verify each input against the
    // funding transaction on-chain so a tampered/buggy index cannot trick us
    // into signing with a wrong amount (which would silently overpay fees or
    // produce an invalid signature).
    await this.verifyInputsAgainstChain(psbtInputs);

    // Build and sign (no broadcast yet)
    const { rawTx } = await buildAndSignOnly({ inputs: psbtInputs, outputs, feeRate });

    // Pre-flight validation via testmempoolaccept
    if (!options.skipPreFlight) {
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
    }

    // Broadcast
    await broadcastTx(rawTx, true);

    // Auto-advance change index if current change address is fully spent
    await this.maybeAdvanceChangeIndex();

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
   * UTXO keys ("txid:vout") already being spent by unconfirmed mempool transactions, so
   * coin selection can exclude them and avoid "txn-mempool-conflict" on rapid sends.
   */
  async getMempoolSpentKeys(addresses: string[]): Promise<Set<string>> {
    const spent = new Set<string>();
    if (!addresses.length) return spent;
    try {
      const entries = (await rpc.getAddressMempoolBatch(addresses)) as Array<Record<string, unknown>>;
      for (const e of entries ?? []) {
        if (e?.prevtxid) spent.add(`${String(e.prevtxid)}:${Number(e.prevout)}`);
      }
    } catch {
      // best-effort: if the mempool query fails, fall back to confirmed UTXOs only
    }
    return spent;
  }

  /**
   * Get UTXOs for a pool of addresses.
   * Uses z_getaddressutxos RPC.
   */
  async getUnspent(addresses: string[]): Promise<UTXO[]> {
    if (!addresses.length) return [];

    const rawList: unknown[] = [];
    for (const addr of addresses) {
      try {
        const utxos = await rpc.getAddressUTXOs(addr);
        rawList.push(...(utxos as unknown[]));
      } catch {
        // Skip addresses with errors
      }
    }
    const spentKeys = await this.getMempoolSpentKeys(addresses);
    const raw = rawList;
    return (raw || [])
      .map((u) => {
        const obj = u as Record<string, unknown>;
        return {
          txid: String(obj.txid ?? obj.txHash ?? ''),
          vout: Number(obj.vout ?? obj.outputIndex ?? 0),
          scriptPubKey: (typeof obj.scriptPubKey === 'object' && obj.scriptPubKey && 'hex' in obj.scriptPubKey
            ? String(obj.scriptPubKey.hex)
            : String(obj.scriptPubKey ?? obj.script ?? obj.scriptPubKeyHex ?? '')),
          amount: Number(obj.satoshis ?? obj.value ?? obj.amount ?? 0) / 1e8,
          confirmations: Number(obj.confirmations ?? obj.confirmationCount ?? 0),
          coinbase: Boolean(obj.coinbase ?? false),
        };
      })
      .filter((u) => !spentKeys.has(`${u.txid}:${u.vout}`));
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

  /**
   * Full wallet recovery scan after import.
   * Scans both receive and change chains to discover all used addresses,
   * their balances, and transaction history. Persists change index state.
   */
  async recoverWallet(gapLimit = 20): Promise<ChainScanResult> {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) {
      throw new Error('Wallet not unlocked. Import a mnemonic or seed phrase first.');
    }

    const network: 'mainnet' | 'testnet' = 'mainnet';

    // Scan receive chain
    const receiveScan = await scanChain(hdKey, {
      network,
      gapLimit,
      batchSize: 10,
    });

    // Scan change chain starting from index 0 (only if any receive addresses were used)
    let changeScan: ChainScanResult = {
      totalScanned: 0,
      usedAddresses: [],
      unusedAddresses: [],
      totalBalance: 0,
      lastUsedIndex: -1,
    };

    if (receiveScan.usedAddresses.length > 0) {
      changeScan = await scanChain(hdKey, {
        network,
        gapLimit: Math.min(gapLimit, 10),
        batchSize: 10,
      }, {
        // Override derivation to scan change chain
        derive: (hdKey, network, index) => {
          const addr = deriveChangeAddress(hdKey, network, index);
          return {
            address: addr.address,
            path: addr.path,
            index: addr.index,
          };
        },
        getAddressTxIds: rpc.getAddressTxIds.bind(rpc),
        getAddressBalance: rpc.getAddressBalance.bind(rpc),
      });

      // Persist the highest used change index
      if (changeScan.lastUsedIndex >= 0) {
        localStorage.setItem('phi:changeIndex', String(changeScan.lastUsedIndex + 1));
      }
    }

    return {
      totalScanned: receiveScan.totalScanned + changeScan.totalScanned,
      usedAddresses: [
        ...receiveScan.usedAddresses,
        ...changeScan.usedAddresses,
      ],
      unusedAddresses: [
        ...receiveScan.unusedAddresses,
        ...changeScan.unusedAddresses,
      ],
      totalBalance: receiveScan.totalBalance + changeScan.totalBalance,
      lastUsedIndex: Math.max(receiveScan.lastUsedIndex, changeScan.lastUsedIndex),
    };
  }

  /**
   * Auto-advance change index when current change address is fully spent.
   * Call after each successful transaction broadcast.
   */
  private async maybeAdvanceChangeIndex(): Promise<void> {
    const currentChangeIndex = this.getCurrentChangeIndex('mainnet');
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) return;

    // Check if current change address has zero balance
    try {
      const changeAddr = deriveChangeAddress(hdKey, 'mainnet', currentChangeIndex);
      const result = await rpc.getAddressBalance(changeAddr.address);
      const data = result as AddressBalanceResult;
      const balanceVal = 'balance' in data ? data.balance : data.result.balance;
      const balance = Number(balanceVal ?? 0);

      // If balance is zero, the change address is fully spent — advance
      if (balance === 0 && currentChangeIndex < 100000) {
        const nextIndex = currentChangeIndex + 1;
        localStorage.setItem('phi:changeIndex', String(nextIndex));
      }
    } catch {
      // RPC error — ignore, change index remains unchanged
    }
  }

  /**
   * SECURITY (P5): verify that each input's value and scriptPubKey match the
   * funding transaction as reported by the node's own raw-transaction data.
   *
   * We fetch `getrawtransaction(txid, true)` for every distinct funding txid
   * (cached per-txid to avoid duplicate round trips) and compare:
   *   - vout[n].value      (converted to satoshis) === input.value
   *   - vout[n].scriptPubKey.hex (case-insensitive) === input.scriptPubKey
   *
   * Any mismatch throws and aborts the send, since signing with an incorrect
   * input amount yields either an over-fee or an unspendable/invalid tx.
   */
  private async verifyInputsAgainstChain(inputs: PSBTInput[]): Promise<void> {
    const txCache = new Map<string, Record<string, unknown>>();

    for (const input of inputs) {
      if (!input.txid) {
        throw new Error('UTXO verification failed: input is missing a txid.');
      }

      let tx = txCache.get(input.txid);
      if (!tx) {
        let raw: unknown;
        try {
          // verbose=1 returns decoded JSON with vout[].value and
          // vout[].scriptPubKey.hex (equivalent to getrawtransaction txid true).
          raw = await rpc.getRawTransaction(input.txid, 1);
        } catch (err) {
          throw new Error(
            `UTXO verification failed: could not fetch funding tx ${input.txid}` +
              (err instanceof Error ? ` (${err.message})` : '')
          );
        }
        if (!raw || typeof raw !== 'object') {
          throw new Error(`UTXO verification failed: invalid response for tx ${input.txid}.`);
        }
        tx = raw as Record<string, unknown>;
        txCache.set(input.txid, tx);
      }

      const vouts = tx.vout;
      if (!Array.isArray(vouts) || input.vout < 0 || input.vout >= vouts.length) {
        throw new Error(
          `UTXO verification failed: tx ${input.txid} has no output at index ${input.vout}.`
        );
      }

      const out = vouts[input.vout] as Record<string, unknown>;

      // Compare value. getrawtransaction reports PHI as a float; convert to
      // satoshis and use the same Math.round the builder uses for the amount.
      const chainValueSat = Math.round(Number(out.value ?? NaN) * 1e8);
      const inputValueSat = Math.round(input.value * 1e8);
      if (!Number.isFinite(chainValueSat) || chainValueSat !== inputValueSat) {
        throw new Error(
          `UTXO verification failed for ${input.txid}:${input.vout}: ` +
            `daemon UTXO value (${inputValueSat} sat) does not match the funding ` +
            `transaction (${Number.isFinite(chainValueSat) ? chainValueSat : 'unknown'} sat). ` +
            `Aborting to avoid signing with an unverified amount.`
        );
      }

      // Compare scriptPubKey hex (case-insensitive). The funding tx is the
      // authoritative source for which script actually locks the coins.
      const spk = out.scriptPubKey;
      const chainScriptHex =
        spk && typeof spk === 'object' && 'hex' in spk
          ? String((spk as Record<string, unknown>).hex ?? '')
          : '';
      const inputScriptHex = (input.scriptPubKey ?? '').replace(/[^a-fA-F0-9]/g, '');
      if (
        chainScriptHex &&
        inputScriptHex &&
        chainScriptHex.toLowerCase() !== inputScriptHex.toLowerCase()
      ) {
        throw new Error(
          `UTXO verification failed for ${input.txid}:${input.vout}: ` +
            `scriptPubKey does not match the funding transaction. ` +
            `Aborting to avoid signing for the wrong output.`
        );
      }
    }
  }

  // ---- Private helpers ----

  private async getAddressTxidsFor(address: string): Promise<string[]> {
    try {
      return await rpc.getAddressTxIds(address);
    } catch {
      return [];
    }
  }

  private async getUsedAddressCount(network: 'mainnet' | 'testnet'): Promise<number> {
    // Proper gap-limit scan of the receive chain (reuses getUsedCountForChain). The old
    // loop stopped at the FIRST unused index within the first 10 addresses, so a gap before
    // a used address made createAddress hand back an already-used address (reuse / R9).
    return this.getUsedCountForChain(network, false);
  }

  /**
   * Derive a pool spanning both the receive and change chains.
   * Returns receive addresses [start, start+count) followed by change
   * addresses [start, start+count). Including the change chain ensures balance
   * and UTXO queries capture funds held on change outputs.
   */
  private deriveCombinedPool(
    hdKey: HDKey,
    network: 'mainnet' | 'testnet',
    start: number,
    count: number
  ): DerivedAddress[] {
    const addresses: DerivedAddress[] = [];
    for (let i = start; i < start + count; i++) {
      addresses.push(deriveReceiveAddress(hdKey, network, i));
    }
    for (let i = start; i < start + count; i++) {
      addresses.push(deriveChangeAddress(hdKey, network, i));
    }
    return addresses;
  }

  /**
   * Derive a path for a given scriptPubKey by scanning both chains.
   * Paths match HDWallet.ts: m/44'/coinType'/0'/change/index (coinType=0 for mainnet).
   */
  private derivePathForAddress(scriptPubKey: string): string | null {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) return null;

    const coinType = 0; // MAINNET_COIN_TYPE from HDWallet.ts

    // Scan receive chain first: m/44'/0'/0'/0/{i}
    for (let i = 0; i < 256; i++) {
      const path = `m/44'/${coinType}'/0'/0/${i}`;
      try {
        const spk = getScriptPubKeyFromPublicKey(hdKey, path);
        if (toHex(spk) === scriptPubKey) return path;
      } catch { /* skip */ }
    }

    // Scan change chain: m/44'/0'/0'/1/{i}
    for (let i = 0; i < 256; i++) {
      const path = `m/44'/${coinType}'/0'/1/${i}`;
      try {
        const spk = getScriptPubKeyFromPublicKey(hdKey, path);
        if (toHex(spk) === scriptPubKey) return path;
      } catch { /* skip */ }
    }

    return null;
  }

  /**
   * Get the current change address index. Reuses until fully spent (Electrum model).
   * Stored in localStorage for persistence across sessions.
   */
  private getCurrentChangeIndex(_network: 'mainnet' | 'testnet'): number {
    const stored = localStorage.getItem('phi:changeIndex');
    return stored ? parseInt(stored, 10) : 0;
  }
}

export const walletService = new WalletService();
