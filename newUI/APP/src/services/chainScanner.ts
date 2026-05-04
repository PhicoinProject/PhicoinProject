import { HDKey } from '@scure/bip32';
import { deriveReceiveAddress } from './addressDerivation';
import { rpc } from './rpc';

/** Default gap limit -- stop scanning after this many consecutive unused addresses. */
const DEFAULT_GAP_LIMIT = 20;

/** Maximum batch size for a single RPC call to avoid payload limits. */
const BATCH_SIZE = 10;

/** Maximum addresses to scan in one run to prevent runaway derivation. */
const MAX_SCAN_LIMIT = 100;

/** Result of a single address check during scanning. */
interface AddressScanEntry {
  address: string;
  path: string;
  index: number;
  used: boolean;
  txCount: number;
  balance: number;
}

/**
 * Result of a chain scan operation.
 */
export interface ChainScanResult {
  /** Total number of addresses derived and checked. */
  totalScanned: number;
  /** Addresses with transaction history. */
  usedAddresses: Array<{
    address: string;
    balance: number;
    txCount: number;
    path: string;
    index: number;
  }>;
  /** Addresses with no transaction history. */
  unusedAddresses: string[];
  /** Sum of balances across all used addresses. */
  totalBalance: number;
  /** Index of the last address that had transaction history. */
  lastUsedIndex: number;
}

/**
 * Configuration for the chain scanner.
 */
export interface ScanOptions {
  /** Gap limit -- stop after this many consecutive unused addresses. Default 20. */
  gapLimit?: number;
  /** Network to derive addresses for. */
  network: 'mainnet' | 'testnet';
  /** How many addresses to include in each batch RPC call. Default 10. */
  batchSize?: number;
}

/**
 * Internal test-only interface for injecting mock dependencies.
 * Not part of the public API — used solely for unit testing.
 */
export interface ScanDeps {
  derive: (
    hdKey: HDKey,
    network: 'mainnet' | 'testnet',
    index: number
  ) => {
    address: string;
    path: string;
    index: number;
  };
  getAddressTxIds: (addresses: string[]) => Promise<unknown[]>;
  getAddressBalance: (addresses: string[]) => Promise<unknown>;
}

/**
 * Scan the blockchain for funds on sequentially derived receive addresses.
 *
 * Derives addresses starting from index 0 (m/0'/coinType'/0'/0/0), batches
 * RPC calls to check for transaction history, and continues until the gap
 * limit of consecutive unused addresses is reached.
 *
 * @param hdKey - The HDKey to derive addresses from.
 * @param options - Scan configuration.
 * @param deps - Optional dependency overrides for testing.
 * @returns ChainScanResult with used/unused addresses and balance totals.
 */
export async function scanChain(
  hdKey: HDKey,
  options: ScanOptions,
  deps?: ScanDeps
): Promise<ChainScanResult> {
  const gapLimit = options.gapLimit ?? DEFAULT_GAP_LIMIT;
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const network = options.network;

  const deriveFn = deps?.derive ?? deriveReceiveAddress;
  const getTxIdsFn = deps?.getAddressTxIds ?? rpc.getAddressTxIds.bind(rpc);
  const getBalanceFn = deps?.getAddressBalance ?? rpc.getAddressBalance.bind(rpc);

  const entries: AddressScanEntry[] = [];
  let consecutiveUnused = 0;
  let lastUsedIndex = -1;
  let index = 0;

  while (consecutiveUnused < gapLimit && index < MAX_SCAN_LIMIT) {
    // Collect a batch of addresses to query
    const batchAddresses: string[] = [];
    const batchPaths: string[] = [];
    const batchIndices: number[] = [];

    for (let i = 0; i < batchSize && index + i < MAX_SCAN_LIMIT; i++) {
      try {
        const derived = deriveFn(hdKey, network, index + i);
        batchAddresses.push(derived.address);
        batchPaths.push(derived.path);
        batchIndices.push(derived.index);
      } catch {
        // Skip derivation failures -- treat as unused
        consecutiveUnused++;
        entries.push({
          address: '',
          path: '',
          index: index + i,
          used: false,
          txCount: 0,
          balance: 0,
        });
      }
    }

    index += batchSize;

    // Batch-check transaction history for this group
    const txIds = await fetchTxIdsForAddresses(batchAddresses, getTxIdsFn);

    for (let i = 0; i < batchAddresses.length; i++) {
      const txCount = txIds[batchAddresses[i]] ?? 0;
      const used = txCount > 0;

      entries.push({
        address: batchAddresses[i],
        path: batchPaths[i],
        index: batchIndices[i],
        used,
        txCount,
        balance: 0,
      });

      if (used) {
        consecutiveUnused = 0;
        lastUsedIndex = batchIndices[i];
      } else {
        consecutiveUnused++;
      }
    }
  }

  // Fetch balances for used addresses
  const usedEntries = entries.filter((e) => e.used);
  if (usedEntries.length > 0) {
    await fetchBalances(usedEntries, getBalanceFn);
  }

  const usedAddresses = usedEntries.map((e) => ({
    address: e.address,
    balance: e.balance,
    txCount: e.txCount,
    path: e.path,
    index: e.index,
  }));

  const unusedAddresses = entries.filter((e) => !e.used).map((e) => e.address);
  const totalBalance = usedEntries.reduce((sum, e) => sum + e.balance, 0);

  return {
    totalScanned: entries.length,
    usedAddresses,
    unusedAddresses,
    totalBalance,
    lastUsedIndex,
  };
}

/**
 * Fetch transaction IDs for a batch of addresses.
 * Returns a map of address -> number of transactions.
 */
async function fetchTxIdsForAddresses(
  addresses: string[],
  getTxIdsFn: (addresses: string[]) => Promise<unknown[]>
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};

  for (const addr of addresses) {
    result[addr] = 0;
  }

  if (addresses.length === 0) return result;

  try {
    // getaddresstxids returns objects like { txid, blockhash, confirmations }
    const raw = await getTxIdsFn(addresses);
    const txList = Array.isArray(raw) ? raw : [];

    // Count total txs per-batch (RPC aggregates across all addresses)
    // We can't distinguish per-address without individual calls,
    // so mark all batch addresses as used if any txs exist.
    if (txList.length > 0) {
      for (const addr of addresses) {
        result[addr] = txList.length;
      }
    }
  } catch {
    // RPC error -- treat all addresses as unused
  }

  return result;
}

/**
 * Fetch balances for used addresses and populate the balance field.
 */
async function fetchBalances(
  entries: AddressScanEntry[],
  getBalanceFn: (addresses: string[]) => Promise<unknown>
): Promise<void> {
  if (entries.length === 0) return;

  const addresses = entries.map((e) => e.address);

  try {
    const balanceResult = await getBalanceFn(addresses);

    // getaddressbalance returns { balance: number, ... }
    if (balanceResult && typeof balanceResult === 'object' && 'balance' in balanceResult) {
      const totalBalance = Number((balanceResult as any).balance) || 0;

      // Distribute proportionally by tx count, or equally
      const totalTxs = entries.reduce((sum, e) => sum + e.txCount, 0);
      if (totalTxs > 0) {
        for (const entry of entries) {
          entry.balance = totalBalance * (entry.txCount / totalTxs);
        }
      } else {
        const perAddress = totalBalance / entries.length;
        for (const entry of entries) {
          entry.balance = perAddress;
        }
      }
    }
  } catch {
    // RPC error -- balances remain 0
  }
}

// ---- Mempool polling ----

/** Result of a mempool poll for a set of wallet addresses. */
export interface MempoolPollResult {
  /** Transaction IDs found in the mempool for wallet addresses. */
  txIds: string[];
  /** Total mempool size from the node. */
  mempoolSize: number;
  /** Total mempool byte count from the node. */
  mempoolBytes: number;
}

/**
 * Poll the mempool for transactions involving wallet addresses.
 *
 * Fetches address-level mempool entries via getaddressmempool and the
 * global mempool summary via getmempoolinfo in a single batch call,
 * then returns the filtered set of relevant transaction IDs.
 *
 * @param addresses - Wallet addresses to check in the mempool.
 * @returns MempoolPollResult with relevant tx IDs and global stats.
 */
export async function pollMempool(addresses: string[]): Promise<MempoolPollResult> {
  if (addresses.length === 0) {
    return { txIds: [], mempoolSize: 0, mempoolBytes: 0 };
  }

  try {
    const [mempoolEntries, mempoolInfo] = await batchRpcCalls([
      () => rpc.getAddressMempool(addresses, true),
      () => rpc.getMempoolInfo(),
    ]);

    const entries = Array.isArray(mempoolEntries) ? (mempoolEntries as any[]) : [];
    const txIds = entries.map((e: any) => String(e.txid ?? e.txHash ?? ''));

    const info = mempoolInfo as Record<string, unknown> | undefined;
    const mempoolSize = Number(info?.size ?? 0);
    const mempoolBytes = Number(info?.bytes ?? 0);

    return { txIds, mempoolSize, mempoolBytes };
  } catch {
    return { txIds: [], mempoolSize: 0, mempoolBytes: 0 };
  }
}

// ---- Batch RPC helpers ----

/**
 * Execute multiple RPC calls concurrently and return all results.
 *
 * Runs all promises in parallel via Promise.all and returns them in the
 * same order. If any call fails, the error for that call is returned in
 * place of the result so other calls are not lost.
 *
 * @param calls - Array of async RPC call factories.
 * @returns Array of results or errors, in the same order as input.
 */
export async function batchRpcCalls(calls: Array<() => Promise<unknown>>): Promise<unknown[]> {
  const promises = calls.map((fn) => fn().catch((e) => e));
  return Promise.all(promises);
}

// ---- Chain snapshot (block + balance + mempool) ----

/**
 * Result of a full chain snapshot: block height, balance, and mempool.
 */
export interface ChainSnapshotResult {
  blockHeight: number;
  balance: number;
  mempoolTxIds: string[];
}

/**
 * Fetch a full snapshot of chain state for wallet addresses in a single
 * batch of parallel RPC calls.
 *
 * This is the preferred method for polling because it reduces round-trips:
 * getblockcount, getaddressbalance, and getaddressmempool all fire at
 * the same time instead of sequentially.
 *
 * @param addresses - Wallet addresses to include in the snapshot.
 * @returns ChainSnapshotResult with block height, balance, and mempool tx IDs.
 */
export async function pollChainSnapshot(addresses: string[]): Promise<ChainSnapshotResult> {
  if (addresses.length === 0) {
    return { blockHeight: 0, balance: 0, mempoolTxIds: [] };
  }

  try {
    const [blockHeight, balanceResult, mempoolEntries] = await batchRpcCalls([
      () => rpc.getBlockCount(),
      () => rpc.getAddressBalance(addresses),
      () => rpc.getAddressMempool(addresses, true),
    ]);

    const height = (blockHeight as number) ?? 0;

    const balData = balanceResult as Record<string, unknown> | undefined;
    const balance = balData ? Number((balData as any).balance ?? 0) / 1e8 : 0;

    const entries = Array.isArray(mempoolEntries) ? (mempoolEntries as any[]) : [];
    const mempoolTxIds = entries.map((e: any) => String(e.txid ?? e.txHash ?? ''));

    return { blockHeight: height, balance, mempoolTxIds };
  } catch {
    return { blockHeight: 0, balance: 0, mempoolTxIds: [] };
  }
}
