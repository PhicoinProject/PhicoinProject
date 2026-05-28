import { rpc } from './rpc';

/** Transaction direction */
export type TxDirection = 'sent' | 'received' | 'self' | 'other';

/**
 * Detailed transaction entry for display in the transaction history.
 * amount is in PHI (positive = net received, negative = net sent).
 */
export interface TxEntry {
  txid: string;
  blockHeight: number;
  confirmations: number;
  timestamp: number; // Unix epoch seconds
  amount: number; // in PHI (positive = received, negative = sent)
  fee: number; // in PHI
  direction: TxDirection;
  addresses: string[]; // relevant wallet addresses
  asset?: string; // asset name if asset transaction
  hex?: string; // raw transaction hex
  vin: VinSummary[]; // input summaries
  vout: VoutSummary[]; // output summaries
  size?: number;
  vsize?: number;
}

/** Summary of a transaction input */
export interface VinSummary {
  txid: string;
  vout: number;
  addresses: string[];
  value?: number; // in PHI, if known
}

/** Summary of a transaction output */
export interface VoutSummary {
  n: number;
  value: number; // in PHI
  address?: string;
  scriptType: string;
  assetLabel?: string;
  assetAmounts?: AssetAmountSummary[];
}

/** Summary of an asset amount in an output */
export interface AssetAmountSummary {
  assetId: string;
  amount: number;
  slot: number;
  assetLabel?: string;
}

/** Filter options for the transaction history query */
export interface TxHistoryFilters {
  count?: number;
  /** Pagination offset into the (deduped, ordered) txid list. Defaults to 0. */
  from?: number;
  direction?: TxDirection | 'all';
  startDate?: Date;
  endDate?: Date;
}

// ---------------------------------------------------------------------------
// Internal: confirmed-transaction cache + concurrency helper
// ---------------------------------------------------------------------------

/**
 * Number of confirmations after which a transaction is considered immutable
 * (deep enough that a chain reorg is treated as impossible for caching).
 */
const CACHE_CONFIRMATION_DEPTH = 6;

/** Hard cap on cached entries; oldest are evicted first (insertion order). */
const MAX_CACHE_ENTRIES = 2000;

/**
 * Module-level cache of parsed raw transactions, keyed by txid.
 *
 * Cached data is public, immutable chain data (wallet-agnostic), so no
 * wallet-change invalidation is needed. IMPORTANT: only the raw decoded tx is
 * cached. Volatile fields (confirmations, blockHeight) are intentionally NOT
 * trusted from here — they are always recomputed live from currentHeight on
 * every call, so a cached tx never reports stale confirmation/height values.
 *
 * Only transactions at/above CACHE_CONFIRMATION_DEPTH confirmations are stored,
 * so unconfirmed/shallow txs are always re-fetched.
 */
const confirmedTxCache = new Map<string, Record<string, unknown>>();

/**
 * Store a parsed raw tx in the cache, evicting the oldest entries if the cap is
 * exceeded. Map preserves insertion order, so the first keys are the oldest.
 */
function cacheConfirmedTx(txid: string, tx: Record<string, unknown>): void {
  // Refresh insertion order so re-seen txs are treated as most-recent.
  if (confirmedTxCache.has(txid)) confirmedTxCache.delete(txid);
  confirmedTxCache.set(txid, tx);

  while (confirmedTxCache.size > MAX_CACHE_ENTRIES) {
    const oldest = confirmedTxCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    confirmedTxCache.delete(oldest);
  }
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch transaction history for a pool of addresses.
 * Returns typed TxEntry objects sorted by block height (descending),
 * with amounts computed by summing vout values for wallet addresses
 * and subtracting input values that spent from wallet addresses.
 */
export async function getTransactionHistory(
  addresses: string[],
  filters: TxHistoryFilters = {}
): Promise<TxEntry[]> {
  if (!addresses.length) return [];

  const count = filters.count ?? 50;
  const from = Math.max(0, filters.from ?? 0);
  const walletSet = new Set(addresses);

  try {
    // Dedupe the combined txid list (one txid can touch several wallet
    // addresses) and slice the requested page window BEFORE fetching any raw
    // transactions, so large wallets don't pull every transaction's full data
    // just to render a single page. Final ordering is applied by the sort below
    // once block heights are known.
    const allTxIds = await rpc.getAddressTxIdsBatch(addresses);
    const uniqueTxIds = Array.from(new Set(allTxIds));
    const recentTxIds = uniqueTxIds.slice(from, from + count);

    const currentHeight = await rpc.getBlockCount();

    // --- Fetch phase (C2 + C4) -------------------------------------------
    // Resolve each page txid from the confirmed cache (free), else fetch. ALL
    // uncached txs are pulled in ONE JSON-RPC batch request (not N requests that
    // serialize behind the browser's ~6-connection limit and can be starved by the
    // dashboard's concurrent poll burst — that starvation left Recent Transactions
    // stuck loading). A per-call failure yields null for that slot and is skipped.
    const uncachedTxIds = recentTxIds.filter((txid) => !confirmedTxCache.has(txid));
    const fetchedRaw = await rpc.rawBatch<Record<string, unknown>>(
      uncachedTxIds.map((txid) => ({ method: 'getrawtransaction', params: [txid, 2] }))
    );
    const freshByTxid = new Map<string, Record<string, unknown>>();
    uncachedTxIds.forEach((txid, i) => {
      const tx = fetchedRaw[i];
      if (!tx) return;
      // Cache only deeply-confirmed (immutable) txs; the per-entry confirmations/
      // blockHeight are recomputed live below so depth never goes stale.
      if (Number(tx.confirmations ?? 0) >= CACHE_CONFIRMATION_DEPTH) cacheConfirmedTx(txid, tx);
      freshByTxid.set(txid, tx);
    });
    const fetched: ({ txid: string; tx: Record<string, unknown> } | null)[] = recentTxIds.map(
      (txid) => {
        const tx = confirmedTxCache.get(txid) ?? freshByTxid.get(txid);
        return tx ? { txid, tx } : null;
      }
    );

    // --- Processing phase (unchanged per-tx logic, run locally) ----------
    const txs: TxEntry[] = [];
    for (const item of fetched) {
      if (!item) continue;
      const { txid, tx } = item;

      // Recompute volatile fields live from currentHeight every call so cached
      // txs never report stale confirmations/blockHeight.
      const confirmations = Number(tx.confirmations ?? 0);
      const timestamp = Number(tx.time ?? tx.blocktime ?? 0);

      let blockHeight = 0;
      if (confirmations > 0) {
        blockHeight = currentHeight - confirmations + 1;
      }

      // Apply date filters
      if (filters.startDate && filters.endDate) {
        const txDate = new Date(timestamp * 1000);
        if (txDate < filters.startDate || txDate > filters.endDate) continue;
      } else if (filters.startDate && txDateBefore(filters.startDate, timestamp)) {
        continue;
      } else if (filters.endDate && txDateAfter(filters.endDate, timestamp)) {
        continue;
      }

      const computed = computeTransactionAmount(tx, walletSet);
      const entry: TxEntry = {
        txid,
        blockHeight,
        confirmations,
        timestamp,
        amount: computed.amount,
        fee: extractFee(tx),
        direction: computed.direction,
        addresses: computed.addresses,
        hex: String(tx.hex ?? ''),
        vin: extractVinSummary(tx, walletSet),
        vout: extractVoutSummary(tx),
        size: Number(tx.size ?? 0),
        vsize: Number(tx.vsize ?? 0),
      };

      // Apply direction filter
      if (
        filters.direction &&
        filters.direction !== 'all' &&
        entry.direction !== filters.direction
      ) {
        continue;
      }

      txs.push(entry);
    }

    txs.sort((a, b) => {
      if (a.blockHeight !== b.blockHeight) return b.blockHeight - a.blockHeight;
      return b.timestamp - a.timestamp;
    });

    return txs;
  } catch {
    return [];
  }
}

/**
 * Check if a timestamp (epoch seconds) is before a given date.
 */
function txDateBefore(date: Date, timestamp: number): boolean {
  return timestamp * 1000 < date.getTime();
}

/**
 * Check if a timestamp (epoch seconds) is after a given date.
 */
function txDateAfter(date: Date, timestamp: number): boolean {
  return timestamp * 1000 > date.getTime();
}

/**
 * Fetch a single transaction detail.
 */
export async function getTransactionDetail(
  txid: string,
  walletAddresses: string[]
): Promise<TxEntry | null> {
  try {
    const txData = await rpc.getRawTransaction(txid, 2);
    const tx = txData as Record<string, unknown>;

    const currentHeight = await rpc.getBlockCount();
    const confirmations = Number(tx.confirmations ?? 0);
    const blockHeight = confirmations > 0 ? currentHeight - confirmations + 1 : 0;
    const walletSet = new Set(walletAddresses);

    const computed = computeTransactionAmount(tx, walletSet);

    return {
      txid,
      blockHeight,
      confirmations,
      timestamp: Number(tx.time ?? tx.blocktime ?? 0),
      amount: computed.amount,
      fee: extractFee(tx),
      direction: computed.direction,
      addresses: computed.addresses,
      hex: String(tx.hex ?? ''),
      vin: extractVinSummary(tx, walletSet),
      vout: extractVoutSummary(tx),
      size: Number(tx.size ?? 0),
      vsize: Number(tx.vsize ?? 0),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Address extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract addresses from a scriptPubKey object.
 * PHICOIN/Ravencoin returns `addresses` (array), Bitcoin Core uses `address` (string).
 * This helper normalizes both formats.
 */
function extractAddresses(scriptPubKey: Record<string, unknown> | undefined): string[] {
  if (!scriptPubKey) return [];

  // PHICOIN/Ravencoin: addresses is an array
  const addrsArray = scriptPubKey.addresses as string[] | undefined;
  if (Array.isArray(addrsArray)) return addrsArray.filter(Boolean);

  // Bitcoin Core: address is a string
  const singleAddr = scriptPubKey.address as string | undefined;
  if (singleAddr) return [singleAddr];

  return [];
}

// ---------------------------------------------------------------------------
// Input (vin) field extraction
// ---------------------------------------------------------------------------

/**
 * Extract the spent value (in PHI) of a transaction input.
 *
 * The PHICOIN daemon attaches the spent value directly on the vin object as
 * `value` (PHI) and `valueSat` (satoshis). We prefer `value`, fall back to
 * `valueSat / 1e8`, then finally to the legacy `prevOut.value` shape. Returns 0
 * (e.g. coinbase inputs which carry no spent value).
 */
function extractInputValuePhi(input: Record<string, unknown>): number {
  if (typeof input.value === 'number') return input.value;
  if (typeof input.valueSat === 'number') return input.valueSat / 1e8;

  // Legacy fallback: { prevOut: { value } }
  const prevOut = input.prevOut as Record<string, unknown> | undefined;
  if (prevOut && typeof prevOut.value === 'number') return prevOut.value;

  return 0;
}

/**
 * Extract the address(es) of a transaction input.
 *
 * The PHICOIN daemon attaches a single `address` string directly on the vin
 * object. We also accept an `addresses` array if present, and fall back to the
 * legacy `prevOut.scriptPubKey` shape.
 */
function extractInputAddresses(input: Record<string, unknown>): string[] {
  const single = input.address as string | undefined;
  if (single) return [single];

  const arr = input.addresses as string[] | undefined;
  if (Array.isArray(arr)) return arr.filter(Boolean);

  // Legacy fallback: { prevOut: { scriptPubKey: { addresses | address } } }
  const prevOut = input.prevOut as Record<string, unknown> | undefined;
  if (prevOut) {
    return extractAddresses(prevOut.scriptPubKey as Record<string, unknown> | undefined);
  }

  return [];
}

// ---------------------------------------------------------------------------
// Amount computation
// ---------------------------------------------------------------------------

interface ComputedAmount {
  amount: number; // net in PHI
  direction: TxDirection;
  addresses: string[];
}

/**
 * Compute the net amount for wallet addresses by examining inputs and outputs.
 *
 * For each wallet output: +value
 * For each wallet input: -value (of the referenced output)
 * Net = received - sent
 * Positive net => received, negative net => sent, zero net => self/other
 */
function computeTransactionAmount(
  tx: Record<string, unknown>,
  walletSet: Set<string>
): ComputedAmount {
  const vout = (tx.vout ?? []) as Record<string, unknown>[];
  const vin = (tx.vin ?? []) as Record<string, unknown>[];
  const foundAddresses = new Set<string>();

  // Sum of all outputs to wallet addresses (in PHI)
  let totalReceivedPhi = 0;
  for (const output of vout) {
    const scriptPubKey = output.scriptPubKey as Record<string, unknown> | undefined;
    const addrs = extractAddresses(scriptPubKey);
    const valuePhi = Number(output.value ?? 0);
    for (const addr of addrs) {
      if (walletSet.has(addr)) {
        totalReceivedPhi += valuePhi;
        foundAddresses.add(addr);
        break;
      }
    }
  }

  // Sum of all inputs from wallet addresses (in PHI).
  // The PHICOIN daemon's getrawtransaction(verbose) attaches each input's spent
  // value/address DIRECTLY on the vin object (via the spent index):
  //   { txid, vout, scriptSig, sequence, value, valueSat, address }
  // There is no `prevOut` sub-object. Reading `input.prevOut.value` here was the
  // bug: it was always undefined, so totalSentPhi stayed 0 and sent transactions
  // were misclassified as received. We read the real fields, with a fallback to
  // the legacy `prevOut` shape so nothing breaks if a response ever includes it.
  let totalSentPhi = 0;
  for (const input of vin) {
    const txinData = input as Record<string, unknown>;
    const value = extractInputValuePhi(txinData);
    const inputAddrs = extractInputAddresses(txinData);

    for (const inputAddr of inputAddrs) {
      if (walletSet.has(inputAddr)) {
        totalSentPhi += value;
        foundAddresses.add(inputAddr);
        break; // count each input's value once
      }
    }
  }

  const netPhi = totalReceivedPhi - totalSentPhi;

  let direction: TxDirection = 'other';
  if (totalReceivedPhi > 0 && totalSentPhi > 0) {
    direction = 'self';
  } else if (totalReceivedPhi > 0) {
    direction = 'received';
  } else if (totalSentPhi > 0) {
    direction = 'sent';
  }

  return {
    amount: netPhi,
    direction,
    addresses: Array.from(foundAddresses),
  };
}

// ---------------------------------------------------------------------------
// Fee extraction
// ---------------------------------------------------------------------------

function extractFee(tx: Record<string, unknown>): number {
  const fees = tx.fees as Record<string, unknown> | undefined;
  if (fees && typeof fees === 'object') {
    // fees.base is already in PHI units
    return Number((fees as Record<string, unknown>).base ?? 0);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Vin / Vout summary extraction
// ---------------------------------------------------------------------------

/**
 * Extract input summaries from the decoded transaction.
 */
function extractVinSummary(tx: Record<string, unknown>, walletSet: Set<string>): VinSummary[] {
  const vin = (tx.vin ?? []) as Record<string, unknown>[];
  const result: VinSummary[] = [];

  for (const input of vin) {
    const txinData = input as Record<string, unknown>;

    // Read the daemon's real vin fields (value/address on the vin itself),
    // with a fallback to the legacy `prevOut` shape — same as C1 above.
    const inputAddrs = extractInputAddresses(txinData);
    const addrs = inputAddrs.filter((addr) => walletSet.has(addr));

    // Preserve undefined when the input carries no spendable value (e.g. coinbase
    // or a response missing both value/valueSat/prevOut), matching prior behaviour.
    const hasValue =
      typeof txinData.value === 'number' ||
      typeof txinData.valueSat === 'number' ||
      (txinData.prevOut as Record<string, unknown> | undefined)?.value !== undefined;

    result.push({
      txid: String(txinData.txid ?? ''),
      vout: Number(txinData.vout ?? 0),
      addresses: addrs,
      value: hasValue ? extractInputValuePhi(txinData) : undefined,
    });
  }

  return result;
}

/**
 * Extract output summaries from the decoded transaction.
 */
function extractVoutSummary(tx: Record<string, unknown>): VoutSummary[] {
  const vout = (tx.vout ?? []) as Record<string, unknown>[];
  const result: VoutSummary[] = [];

  for (const output of vout) {
    const scriptPubKey = output.scriptPubKey as Record<string, unknown> | undefined;
    const assetAmountsRaw = output.assetAmounts as Record<string, unknown>[] | undefined;
    const assetAmounts: AssetAmountSummary[] = [];

    if (assetAmountsRaw && Array.isArray(assetAmountsRaw)) {
      for (const aa of assetAmountsRaw) {
        assetAmounts.push({
          assetId: String(aa.assetId ?? aa.asset ?? ''),
          amount: Number(aa.amount ?? 0),
          slot: Number(aa.slot ?? 0),
          assetLabel: String(aa.assetLabel ?? ''),
        });
      }
    }

    const voutAddress = scriptPubKey ? (extractAddresses(scriptPubKey)[0] ?? undefined) : undefined;

    result.push({
      n: Number(output.n ?? 0),
      // value is already in PHI units from getrawtransaction verbose=2
      value: Number(output.value ?? 0),
      address: voutAddress,
      scriptType: scriptPubKey ? String(scriptPubKey.type ?? '') : '',
      assetLabel: output.assetLabel ? String(output.assetLabel) : undefined,
      assetAmounts: assetAmounts.length > 0 ? assetAmounts : undefined,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/**
 * Convert TxEntry array to a CSV string for download.
 */
export function exportTransactionsToCSV(transactions: TxEntry[]): string {
  const headers = [
    'TxID',
    'Date',
    'Amount (PHI)',
    'Fee (PHI)',
    'Direction',
    'Confirmations',
    'Block Height',
    'Addresses',
  ];

  const rows = transactions.map((tx) => [
    tx.txid,
    new Date(tx.timestamp * 1000).toISOString(),
    tx.amount.toFixed(8),
    tx.fee.toFixed(8),
    tx.direction,
    String(tx.confirmations),
    String(tx.blockHeight),
    tx.addresses.join(';'),
  ]);

  const escape = (val: string): string => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const lines = [headers.join(','), ...rows.map((r) => r.map(escape).join(','))];
  return lines.join('\n');
}

/**
 * Trigger a CSV file download in the browser.
 */
export function downloadCSV(transactions: TxEntry[], filename = 'phicoin_transactions.csv'): void {
  const csv = exportTransactionsToCSV(transactions);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Block explorer
// ---------------------------------------------------------------------------

/**
 * Configuration for the block explorer URL.
 * Set to empty string to disable.
 */
let blockExplorerBaseUrl = '';

/**
 * Set the base URL for the block explorer (e.g. "https://phicoinblockexplorer.com").
 * Pass empty string to disable.
 */
export function setBlockExplorerUrl(url: string): void {
  blockExplorerBaseUrl = url;
}

/**
 * Get the block explorer URL for a given txid, or undefined if disabled.
 */
export function getExplorerUrl(txid: string): string | undefined {
  if (!blockExplorerBaseUrl) return undefined;
  return `${blockExplorerBaseUrl.endsWith('/') ? blockExplorerBaseUrl.slice(0, -1) : blockExplorerBaseUrl}/tx/${txid}`;
}
