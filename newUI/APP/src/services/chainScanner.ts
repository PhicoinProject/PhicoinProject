import { HDKey } from '@scure/bip32';
import { deriveReceiveAddress } from './addressDerivation';
import type { AddressBalance, AddressBalanceResult, AddressMempoolEntry } from '@/types';
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
  getAddressTxIds: (address: string) => Promise<string[]>;
  getAddressBalance: (address: string) => Promise<unknown>;
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
    for (let i = 0; i < batchSize && index + i < MAX_SCAN_LIMIT; i++) {
      let derivedAddr: { address: string; path: string; index: number };
      try {
        derivedAddr = deriveFn(hdKey, network, index + i);
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
        continue;
      }

      // Single-address RPC call
      let txCount = 0;
      try {
        const txids = await getTxIdsFn(derivedAddr.address);
        txCount = Array.isArray(txids) ? txids.length : 0;
      } catch {
        // RPC error -- treat as unused
      }

      const used = txCount > 0;
      entries.push({
        address: derivedAddr.address,
        path: derivedAddr.path,
        index: derivedAddr.index,
        used,
        txCount,
        balance: 0,
      });

      if (used) {
        consecutiveUnused = 0;
        lastUsedIndex = derivedAddr.index;
      } else {
        consecutiveUnused++;
      }
    }

    index += batchSize;
  }

  // Fetch balances for used addresses (single-address RPC calls)
  const usedEntries = entries.filter((e) => e.used);
  for (const entry of usedEntries) {
    try {
      const result = await getBalanceFn(entry.address);
      const data = result as AddressBalanceResult;
      const balanceVal = 'balance' in data ? data.balance : data.result.balance;
      entry.balance = Number(balanceVal ?? 0) / 1e8;
    } catch {
      // RPC error -- balance remains 0
    }
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
      () => rpc.getAddressMempoolBatch(addresses),
      () => rpc.getMempoolInfo(),
    ]);

    const entries = Array.isArray(mempoolEntries) ? (mempoolEntries as AddressMempoolEntry[]) : [];
    const txIds = entries.map((e) => String(e.txid ?? ''));

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
      () => rpc.getAddressBalanceBatch(addresses),
      () => rpc.getAddressMempoolBatch(addresses),
    ]);

    const height = (blockHeight as number) ?? 0;

    const balMap = balanceResult as Record<string, unknown> | undefined;
    let totalBalance = 0;
    if (balMap) {
      for (const addr of addresses) {
        const entry = balMap[addr] as AddressBalanceResult | undefined;
        if (entry) {
          const balObj = 'balance' in entry ? entry : (entry as { result: AddressBalance }).result;
          totalBalance += Number(balObj.balance ?? 0) / 1e8;
        }
      }
    }

    const entries = Array.isArray(mempoolEntries) ? (mempoolEntries as AddressMempoolEntry[]) : [];
    const mempoolTxIds = entries.map((e) => String(e.txid ?? ''));

    return { blockHeight: height, balance: totalBalance, mempoolTxIds };
  } catch {
    return { blockHeight: 0, balance: 0, mempoolTxIds: [] };
  }
}
