import { rpc } from './rpc';
import { HDKey } from '@scure/bip32';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';
import { deriveReceiveAddress, deriveChangeAddress, deriveAddressRange, deriveScriptPubKeyRange, isValidPHICoinAddress } from './addressDerivation';
import { buildAndSignOnly, testMempoolAccept, broadcastTx } from './psbt';
import { scanChain } from './chainScanner';
import type { Address, WalletState, UTXO, DerivedAddress, AddressBalanceResult } from '@/types';
import type { PSBTInput, PSBTOutput } from './psbt';
import type { ChainScanResult } from './chainScanner';

// Number of addresses to pre-generate for the pool
const ADDRESS_POOL_SIZE = 10;

// Max address index scanned per chain for BOTH gap-limit discovery and the
// signing-path scriptPubKey->path lookup. These MUST share one cap: if discovery
// builds a pool deeper than the signing scan, UTXOs on those addresses can't be
// signed (path lookup returns null -> input silently dropped -> insufficient funds).
const DISCOVERY_HARD_CAP = 1000;

/**
 * High-level wallet service for the pure frontend wallet.
 * All queries are address-based via the address index; no wallet.dat is required.
 * Callers pass an address pool (array of derived addresses) for scanning.
 */
export class WalletService {
  /**
   * PERF: memo cache for derivePathForAddress (scriptPubKey hex -> derivation
   * path). Without it, every signed input triggers an O(2*DISCOVERY_HARD_CAP)
   * scan recomputing hash160 on both chains; with many inputs this dominates
   * send-time CPU. Lookups become O(1) once a path has been found.
   *
   * SECURITY: a stale entry would map a scriptPubKey to a path under the WRONG
   * key, i.e. sign with the wrong key -> funds risk. The cache is therefore
   * bound to a specific hdKey instance via {@link derivePathCacheKeyRef}. The
   * hdKey store replaces the HDKey reference on every unlock (and nulls it on
   * lock/zeroize), so an identity check on that reference detects any wallet
   * change and forces a full cache clear before serving any lookup.
   */
  private derivePathCache = new Map<string, string>();
  private derivePathCacheKeyRef: HDKey | null = null;

  /**
   * Drop the derivation-path cache whenever the active HDKey reference changes
   * (lock, unlock, or wallet switch). Returns the current hdKey (or null).
   * MUST be called before any cache read so a stale path is never returned for
   * a different key.
   */
  private syncDerivePathCache(): HDKey | null {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (hdKey !== this.derivePathCacheKeyRef) {
      this.derivePathCache.clear();
      this.derivePathCacheKeyRef = hdKey;
    }
    return hdKey;
  }

  /**
   * Get total received balance for a pool of addresses.
   * Uses z_getaddressbalance RPC.
   */
  async getBalance(addresses: string[]): Promise<number> {
    if (!addresses.length) return 0;
    // PERF: the daemon's getaddressbalance accepts {addresses:[...]} and returns
    // the COMBINED balance summed over every address in ONE call, so we no longer
    // loop one RPC per address (N -> 1 round-trips). The non-asset branch tolerates
    // unused/empty addresses (they contribute 0), matching the old loop's result.
    // Falls back to 0 on RPC failure, preserving the prior catch-and-skip behavior
    // (e.g. address index disabled), so the observable return value is unchanged.
    try {
      const { balance } = await rpc.getAddressBalanceCombined(addresses);
      return Number(balance ?? 0) / 1e8;
    } catch {
      return 0;
    }
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
    // Derive each chain from its chain node once (~1 EC op/address instead of 5).
    return [
      ...deriveAddressRange(hdKey, network, false, 0, recvCount),
      ...deriveAddressRange(hdKey, network, true, 0, changeCount),
    ];
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
    const HARD_CAP = DISCOVERY_HARD_CAP;
    let lastUsed = -1;
    for (let start = 0; start < HARD_CAP; start += BATCH) {
      // Derive the whole batch from the chain node once (~1 EC op/address, not 5).
      const batch = deriveAddressRange(hdKey, network, isChange, start, BATCH);
      // ONE JSON-RPC batch request for the whole batch, not BATCH separate HTTP
      // requests that would serialize behind the browser's ~6-connection limit.
      const results = await rpc.rawBatch<string[]>(
        batch.map((a) => ({ method: 'getaddresstxids', params: [a.address] }))
      );
      let anyUsed = false;
      results.forEach((txids, k) => {
        if (txids && txids.length > 0) {
          lastUsed = batch[k].index;
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
      // getaddressutxos returns `satoshis` (integer sats). `value`/`amount` (if a fallback
      // ever applies) are PHI floats, so convert them to sats — otherwise coin selection
      // would undercount inputs by 1e8 and abort an otherwise-valid send.
      const valueSat = u.satoshis != null
        ? Number(u.satoshis)
        : Math.round(Number(u.value ?? u.amount ?? 0) * 1e8);
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

    try {
      const changeAddr = deriveChangeAddress(hdKey, 'mainnet', currentChangeIndex);
      // Only advance once the current change address has actually been USED and then
      // fully spent. A brand-new (never-used) change address, or one holding an
      // as-yet-unconfirmed change output (not in the tx index), both report balance 0 —
      // advancing on balance alone burned through a fresh change address on every send.
      // Require txids>0 so we reuse the address (Electrum model) until it is spent.
      const txids = await this.getAddressTxidsFor(changeAddr.address);
      if (txids.length === 0) return; // unused → keep reusing this change address

      const result = await rpc.getAddressBalance(changeAddr.address);
      const data = result as AddressBalanceResult;
      const balanceVal = 'balance' in data ? data.balance : data.result.balance;
      const balance = Number(balanceVal ?? 0);

      // Used and now empty → fully spent → advance to the next change address.
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
    // Derive each chain from its chain node once (~1 EC op/address instead of 5).
    return [
      ...deriveAddressRange(hdKey, network, false, start, count),
      ...deriveAddressRange(hdKey, network, true, start, count),
    ];
  }

  /**
   * Derive a path for a given scriptPubKey by scanning both chains.
   * Paths match HDWallet.ts: m/44'/coinType'/0'/change/index (coinType=0 for mainnet).
   */
  private derivePathForAddress(scriptPubKey: string): string | null {
    // PERF + SECURITY: clear the memo cache if the active HDKey reference changed
    // (lock/unlock/wallet switch) BEFORE reading it, so we can never serve a path
    // derived under a different key. syncDerivePathCache returns the live hdKey.
    const hdKey = this.syncDerivePathCache();
    if (!hdKey) return null;

    // PERF: O(1) hit once this scriptPubKey has been resolved for the current key.
    // Keyed by the exact input string so a hit returns precisely what a fresh
    // scan would (the scan match below is also case-sensitive).
    const cached = this.derivePathCache.get(scriptPubKey);
    if (cached !== undefined) return cached;

    // PERF: derive each chain's node ONCE and take only the non-hardened leaf per
    // index (~1 EC op/index) instead of re-deriving the full hardened path per index
    // (~5 ops). deriveScriptPubKeyRange runs the identical hash160 + scriptPubKey +
    // toHex pipeline as the old getScriptPubKeyFromPublicKey path, and BIP32
    // guarantees chainNode.deriveChild(i) === deriving the full path, so the
    // scriptPubKeyHex (and returned path string) are byte-for-byte unchanged. Network
    // 'mainnet' -> coinType 0 keeps the path prefix m/44'/0'/0'/{chain}/{i} identical.
    const network: 'mainnet' | 'testnet' = 'mainnet';

    // Scan receive chain first (m/44'/0'/0'/0/{i}), then change (m/44'/0'/0'/1/{i}),
    // each up to DISCOVERY_HARD_CAP — same order and bound as before. The match is
    // case-sensitive (===) against the exact input string, matching the prior scan.
    // The try/catch mirrors the old per-index `catch { skip }`: a derivation failure
    // yields no match (null) rather than propagating.
    try {
      for (const isChange of [false, true]) {
        const range = deriveScriptPubKeyRange(hdKey, network, isChange, 0, DISCOVERY_HARD_CAP);
        for (const entry of range) {
          if (entry.scriptPubKeyHex === scriptPubKey) {
            this.derivePathCache.set(scriptPubKey, entry.path); // memoize for subsequent inputs
            return entry.path;
          }
        }
      }
    } catch { /* derivation failure → treat as no match */ }

    // Not found: deliberately NOT cached. A negative result is cheap relative to
    // the funds risk of caching "no path" if the pool/key state later changes,
    // and avoids unbounded growth from hostile/unrelated scripts.
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
