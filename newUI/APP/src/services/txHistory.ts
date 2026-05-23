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
    const txs: TxEntry[] = [];

    for (const txid of recentTxIds) {
      try {
        const txData = await rpc.getRawTransaction(txid, 2);
        const tx = txData as Record<string, unknown>;

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
      } catch {
        // Skip unparseable transactions
      }
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

  // Sum of all inputs from wallet addresses (in PHI)
  // We need the referenced output values to know how much was spent.
  // For simplicity, use the vin's previous output address if available,
  // otherwise check if any wallet address appears in the input's redeem script or signatures.
  let totalSentPhi = 0;
  for (const input of vin) {
    const txinData = input as Record<string, unknown>;
    const prevOut = txinData.prevOut as Record<string, unknown> | undefined;
    if (!prevOut) continue;

    const scriptPubKey = prevOut.scriptPubKey as Record<string, unknown> | undefined;
    const inputAddrs = extractAddresses(scriptPubKey);

    for (const inputAddr of inputAddrs) {
      if (walletSet.has(inputAddr)) {
        const prevValue = Number(prevOut?.value ?? 0);
        totalSentPhi += prevValue;
        foundAddresses.add(inputAddr);
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
    const prevOut = txinData.prevOut as Record<string, unknown> | undefined;
    const addrs: string[] = [];

    if (prevOut) {
      const scriptPubKey = prevOut.scriptPubKey as Record<string, unknown> | undefined;
      const prevAddrs = extractAddresses(scriptPubKey);
      for (const addr of prevAddrs) {
        if (walletSet.has(addr)) addrs.push(addr);
      }
    }

    result.push({
      txid: String(txinData.txid ?? ''),
      vout: Number(txinData.vout ?? 0),
      addresses: addrs,
      value: prevOut ? Number(prevOut.value ?? 0) : undefined,
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
