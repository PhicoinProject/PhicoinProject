import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { walletService } from '@/services/wallet';
import {
  getTransactionHistory,
  getTransactionDetail,
  downloadCSV,
  getExplorerUrl,
  type TxEntry,
  type TxDirection,
} from '@/services/txHistory';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { truncate, formatConfirmations, formatDate } from '@/utils/format';
import { TRANSACTION_POLL_INTERVAL, DATA_STALE_TIME } from '@/utils/constants';

// Re-export Button and Modal from common for callers that imported from this path
export { Button } from '@/components/common/Button';
export { Modal } from '@/components/common/Modal';

const DEFAULT_COUNT = 50;

/** Transaction history page with filtering, CSV export, and detail modal */
export const Transactions: React.FC = () => {
  const [search, setSearch] = useState('');
  const [filterDirection, setFilterDirection] = useState<TxDirection | 'all'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [detailTxid, setDetailTxid] = useState<string | null>(null);

  const addressPool = useMemo(() => walletService.getDerivedAddressPool(), []);
  const addressList = useMemo(() => addressPool.map((a) => a.address), [addressPool]);

  const { data: transactions, isLoading } = useQuery({
    queryKey: ['transactions', addressList.join(','), count, filterDirection, startDate, endDate],
    queryFn: async () => {
      const filters = {
        count,
        direction: filterDirection,
        startDate: startDate ? new Date(startDate + 'T00:00:00') : undefined,
        endDate: endDate ? new Date(endDate + 'T23:59:59') : undefined,
      };
      return getTransactionHistory(addressList, filters);
    },
    refetchInterval: TRANSACTION_POLL_INTERVAL,
    staleTime: DATA_STALE_TIME,
    enabled: addressList.length > 0,
  });

  const txs = useMemo(() => (transactions ?? []) as TxEntry[], [transactions]);

  // Client-side search filter on top of RPC-level filters
  const filtered = useMemo(() => {
    if (!search) return txs;
    const s = search.toLowerCase();
    return txs.filter(
      (tx) =>
        tx.txid.toLowerCase().includes(s) || tx.addresses.some((a) => a.toLowerCase().includes(s))
    );
  }, [txs, search]);

  // Transaction detail modal state
  const { data: detailTx, isLoading: detailLoading } = useQuery({
    queryKey: ['txDetail', detailTxid],
    queryFn: async () => {
      if (!detailTxid) return null;
      return getTransactionDetail(detailTxid, addressList);
    },
    enabled: !!detailTxid,
  });

  const directionLabel = (d: TxDirection) => {
    switch (d) {
      case 'sent':
        return 'Sent';
      case 'received':
        return 'Received';
      case 'self':
        return 'Self';
      case 'other':
        return 'Other';
      default:
        return d;
    }
  };

  const directionColor = (d: TxDirection) => {
    switch (d) {
      case 'sent':
        return 'text-red-600 dark:text-red-400';
      case 'received':
        return 'text-green-600 dark:text-green-400';
      case 'self':
        return 'text-amber-600 dark:text-amber-400';
      case 'other':
        return 'text-gray-600 dark:text-gray-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  const directionBadgeColor = (d: TxDirection) => {
    switch (d) {
      case 'sent':
        return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400';
      case 'received':
        return 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400';
      case 'self':
        return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400';
      case 'other':
        return 'bg-gray-100 text-gray-700 dark:bg-dark-elevated dark:text-dark-secondary';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-dark-elevated dark:text-dark-secondary';
    }
  };

  const handleExportCSV = () => {
    if (filtered.length === 0) return;
    downloadCSV(filtered);
  };

  const openDetail = (txid: string) => {
    setDetailTxid(txid);
  };

  const closeDetail = () => {
    setDetailTxid(null);
  };

  const explorerUrl = (txid: string) => getExplorerUrl(txid);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-dark-text md:text-2xl">
          Transactions
        </h1>
        {filtered.length > 0 && (
          <Button variant="secondary" size="sm" onClick={handleExportCSV}>
            Export CSV
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <input
          type="text"
          placeholder="Search by txid or address..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-48 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
        />
        <select
          value={filterDirection}
          onChange={(e) => setFilterDirection(e.target.value as TxDirection | 'all')}
          className="rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-700 dark:text-dark-secondary"
        >
          <option value="all">All Types</option>
          <option value="sent">Sent</option>
          <option value="received">Received</option>
          <option value="self">Self</option>
          <option value="other">Other</option>
        </select>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-700 dark:text-dark-secondary"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-700 dark:text-dark-secondary"
        />
      </div>

      {/* Transactions */}
      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface shadow-sm">
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse flex items-center gap-4">
                <div className="h-4 w-28 rounded bg-gray-200 dark:bg-dark-muted" />
                <div className="h-4 w-24 rounded bg-gray-200 dark:bg-dark-muted" />
                <div className="h-4 w-20 rounded bg-gray-200 dark:bg-dark-muted" />
                <div className="h-4 w-16 rounded bg-gray-200 dark:bg-dark-muted" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <svg
              className="h-12 w-12 text-gray-300 dark:text-dark-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 002-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            <p className="mt-3 text-sm text-gray-500 dark:text-dark-mutedText">
              No transactions found
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-dark-mutedText">
              {search || filterDirection !== 'all' || startDate || endDate
                ? 'Try adjusting your search or filters'
                : 'Your transaction history will appear here'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-dark-elevated text-gray-600 dark:text-dark-mutedText">
                  <tr>
                    <th className="px-4 py-3 font-medium">TxID</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Direction</th>
                    <th className="px-4 py-3 font-medium">Confirmations</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tx, i) => (
                    <tr
                      key={tx.txid}
                      onClick={() => openDetail(tx.txid)}
                      className={`border-b border-gray-100 dark:border-dark-border ${i % 2 === 0 ? 'bg-white dark:bg-dark-surface' : 'bg-gray-50 dark:bg-dark-elevated'} hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer`}
                    >
                      <td className="px-4 py-3 text-gray-900 dark:text-dark-text">
                        {explorerUrl(tx.txid) ? (
                          <a
                            href={explorerUrl(tx.txid)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-xs text-phi-primary hover:underline"
                          >
                            {truncate(tx.txid)}
                          </a>
                        ) : (
                          <span className="font-mono text-xs text-phi-primary">
                            {truncate(tx.txid)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-dark-mutedText">
                        {formatDate(tx.timestamp)}
                      </td>
                      <td className={`px-4 py-3 font-semibold ${directionColor(tx.direction)}`}>
                        {tx.amount >= 0 ? '+' : ''}
                        {tx.amount.toFixed(8)} PHI
                        {tx.fee !== 0 && (
                          <span className="ml-1 text-xs font-normal text-gray-400 dark:text-dark-mutedText">
                            (fee: {Math.abs(tx.fee).toFixed(8)})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-dark-text">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${directionBadgeColor(tx.direction)}`}
                        >
                          {directionLabel(tx.direction)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-dark-text">
                        <span
                          className={
                            tx.confirmations <= 0
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-green-600 dark:text-green-400'
                          }
                        >
                          {formatConfirmations(tx.confirmations)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openDetail(tx.txid)}
                          className="text-xs text-phi-primary hover:underline cursor-pointer"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card layout */}
            <div className="space-y-2 p-3 md:hidden">
              {filtered.map((tx) => (
                <div
                  key={tx.txid}
                  onClick={() => openDetail(tx.txid)}
                  className="rounded-lg border border-gray-200 dark:border-dark-border p-3 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold ${directionColor(tx.direction)}`}>
                      {tx.amount >= 0 ? '+' : ''}
                      {tx.amount.toFixed(8).replace(/\.?0+$/, '')} PHI
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${directionBadgeColor(tx.direction)}`}
                    >
                      {directionLabel(tx.direction)}
                    </span>
                  </div>
                  <span className="mt-1 block font-mono text-xs text-phi-primary">
                    {truncate(tx.txid)}
                  </span>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-xs text-gray-500 dark:text-dark-mutedText">
                      {formatDate(tx.timestamp)}
                    </span>
                    <span
                      className={
                        tx.confirmations <= 0
                          ? 'text-xs text-amber-600 dark:text-amber-400'
                          : 'text-xs text-green-600 dark:text-green-400'
                      }
                    >
                      {formatConfirmations(tx.confirmations)}
                    </span>
                  </div>
                  {tx.fee !== 0 && (
                    <span className="text-xs text-gray-400 dark:text-dark-mutedText">
                      fee: {Math.abs(tx.fee).toFixed(8)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Load more */}
      {filtered.length >= count && (
        <div className="text-center">
          <Button variant="secondary" onClick={() => setCount((c) => c + 50)}>
            Load More ({count} shown)
          </Button>
        </div>
      )}

      {/* Transaction detail modal */}
      <TransactionDetailModal
        tx={detailTx ?? null}
        loading={detailLoading}
        isOpen={!!detailTxid}
        onClose={closeDetail}
        explorerUrl={detailTxid ? explorerUrl(detailTxid) : undefined}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Transaction Detail Modal Component
// ---------------------------------------------------------------------------

interface TransactionDetailModalProps {
  tx: TxEntry | null;
  loading: boolean;
  isOpen: boolean;
  onClose: () => void;
  explorerUrl?: string;
}

const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  tx,
  loading,
  isOpen,
  onClose,
  explorerUrl,
}) => {
  if (!isOpen) return null;

  const directionLabel = (d: TxDirection) => {
    switch (d) {
      case 'sent':
        return 'Sent';
      case 'received':
        return 'Received';
      case 'self':
        return 'Self';
      case 'other':
        return 'Other';
      default:
        return d;
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Transaction Details">
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <svg className="h-8 w-8 animate-spin text-phi-primary" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </div>
      ) : !tx ? (
        <p className="text-sm text-gray-500 dark:text-dark-mutedText">
          Transaction not found or could not be loaded.
        </p>
      ) : (
        <div className="space-y-4 text-sm">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-2">
            <InfoRow label="TxID" value={tx.txid} monospace />
            <InfoRow
              label="Block"
              value={tx.blockHeight > 0 ? String(tx.blockHeight) : 'Pending'}
            />
            <InfoRow
              label="Confirmations"
              value={tx.confirmations <= 0 ? 'Unconfirmed' : formatConfirmations(tx.confirmations)}
            />
            <InfoRow label="Date" value={formatDate(tx.timestamp)} />
            <InfoRow
              label="Amount"
              value={`${tx.amount >= 0 ? '+' : ''}${tx.amount.toFixed(8)} PHI`}
              color={
                tx.direction === 'sent'
                  ? 'text-red-600 dark:text-red-400'
                  : tx.direction === 'received'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-gray-900 dark:text-dark-text'
              }
            />
            <InfoRow label="Fee" value={`${tx.fee.toFixed(8)} PHI`} />
            <InfoRow label="Direction" value={directionLabel(tx.direction)} />
            <InfoRow
              label="Size"
              value={tx.vsize ? `${tx.vsize} vB` : tx.size ? `${tx.size} B` : '—'}
            />
          </div>

          {/* Block explorer link */}
          {explorerUrl && (
            <div>
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-phi-primary hover:underline text-sm"
              >
                View on Block Explorer &rarr;
              </a>
            </div>
          )}

          {/* Addresses */}
          {tx.addresses.length > 0 && (
            <div>
              <p className="font-medium text-gray-700 dark:text-dark-secondary mb-1">Addresses</p>
              <div className="space-y-0.5">
                {tx.addresses.map((addr) => (
                  <code
                    key={addr}
                    className="block text-xs font-mono text-gray-600 dark:text-dark-mutedText bg-gray-50 dark:bg-dark-elevated rounded px-2 py-1 break-all"
                  >
                    {addr}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* Inputs */}
          {tx.vin.length > 0 && (
            <div>
              <p className="font-medium text-gray-700 dark:text-dark-secondary mb-1">
                Inputs ({tx.vin.length})
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1 rounded border border-gray-200 dark:border-dark-border p-2">
                {tx.vin.map((vin, i) => (
                  <div key={i} className="text-xs">
                    <span className="font-mono text-gray-600 dark:text-dark-mutedText">
                      {truncate(vin.txid)}:{vin.vout}
                    </span>
                    {vin.value !== undefined && (
                      <span className="ml-2 text-gray-900 dark:text-dark-text">
                        {vin.value.toFixed(8)} PHI
                      </span>
                    )}
                    {vin.addresses.length > 0 && (
                      <div className="text-gray-500 dark:text-dark-mutedText">
                        from: {vin.addresses.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Outputs */}
          {tx.vout.length > 0 && (
            <div>
              <p className="font-medium text-gray-700 dark:text-dark-secondary mb-1">
                Outputs ({tx.vout.length})
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1 rounded border border-gray-200 dark:border-dark-border p-2">
                {tx.vout.map((vout, i) => (
                  <div key={i} className="text-xs">
                    <span className="text-gray-600 dark:text-dark-mutedText">#{vout.n}</span>{' '}
                    <span className="font-semibold text-gray-900 dark:text-dark-text">
                      {vout.value.toFixed(8)} PHI
                    </span>
                    {vout.address && (
                      <div className="font-mono text-phi-primary">{vout.address}</div>
                    )}
                    <span className="text-gray-500 dark:text-dark-mutedText">
                      {vout.scriptType}
                    </span>
                    {vout.assetAmounts && vout.assetAmounts.length > 0 && (
                      <div className="ml-2 text-amber-600 dark:text-amber-400">
                        {vout.assetAmounts.map((aa) => (
                          <span key={aa.assetId}>
                            {aa.amount} {aa.assetLabel || aa.assetId}{' '}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Raw hex (collapsible) */}
          {tx.hex && (
            <details className="text-xs">
              <summary className="cursor-pointer text-phi-primary hover:underline">
                Raw Transaction Hex
              </summary>
              <pre className="mt-2 max-h-32 overflow-auto rounded border border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-elevated p-2 font-mono text-xs text-gray-600 dark:text-dark-mutedText break-all">
                {tx.hex}
              </pre>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Small helper component for info rows
// ---------------------------------------------------------------------------

interface InfoRowProps {
  label: string;
  value: string;
  monospace?: boolean;
  color?: string;
}

const InfoRow: React.FC<InfoRowProps> = ({ label, value, monospace, color }) => (
  <div>
    <span className="text-gray-500 dark:text-dark-mutedText">{label}:</span>{' '}
    <span
      className={`${
        monospace ? 'font-mono text-xs' : ''
      } ${color ?? 'text-gray-900 dark:text-dark-text'}`}
    >
      {value}
    </span>
  </div>
);

export default Transactions;
