import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { walletService } from '@/services/wallet';
import { Button } from '@/components/common/Button';
import { formatConfirmations } from '@/utils/format';

/** Transaction history page with filtering and search */
export const Transactions: React.FC = () => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'sent' | 'received'>('all');
  const [count, setCount] = useState(50);

  const { data: transactions, isLoading } = useQuery({
    queryKey: ['transactions', count],
    queryFn: () => walletService.getTransactions(count),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const txs = (transactions ?? []) as Record<string, unknown>[];

  const filtered = txs.filter((tx) => {
    const txid = String(tx.txid ?? '');
    const address = String(tx.address ?? '');
    const amount = Number(tx.amount ?? 0);

    if (search) {
      const s = search.toLowerCase();
      if (!txid.toLowerCase().includes(s) && !address.toLowerCase().includes(s)) return false;
    }

    if (filter === 'sent' && amount >= 0) return false;
    if (filter === 'received' && amount <= 0) return false;

    return true;
  });

  const formatDate = (timestamp: number) => {
    if (!timestamp) return '—';
    return new Date(timestamp * 1000).toLocaleString();
  };

  const confirmations = (tx: Record<string, unknown>) => {
    const c = Number(tx.confirmations ?? 0);
    return (
      <span
        className={
          c <= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'
        }
      >
        {formatConfirmations(c)}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-900 dark:text-dark-text md:text-2xl">
        Transactions
      </h1>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          placeholder="Search by txid or address..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'all' | 'sent' | 'received')}
          className="rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-700 dark:text-dark-secondary"
        >
          <option value="all">All</option>
          <option value="sent">Sent</option>
          <option value="received">Received</option>
        </select>
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
              {search || filter !== 'all'
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
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Confirmations</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tx, i) => {
                    const amount = Number(tx.amount ?? 0);
                    const fee = Number(tx.fee ?? 0);
                    const category = String(tx.category ?? 'unknown');
                    return (
                      <tr
                        key={String(tx.txid ?? i)}
                        className={`border-b ${i % 2 === 0 ? 'bg-white dark:bg-dark-surface' : 'bg-gray-50 dark:bg-dark-elevated hover:bg-blue-50 dark:hover:bg-blue-900/20'}`}
                      >
                        <td className="px-4 py-3 text-gray-900 dark:text-dark-text">
                          <a
                            href={`transactions/${tx.txid}`}
                            className="font-mono text-xs text-phi-primary hover:underline"
                            onClick={(e) => e.preventDefault()}
                          >
                            {String(tx.txid ?? '').slice(0, 12)}...{String(tx.txid ?? '').slice(-8)}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-dark-mutedText">
                          {formatDate(Number(tx.blocktime ?? tx.date ?? tx.time ?? 0))}
                        </td>
                        <td
                          className={`px-4 py-3 font-semibold ${amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                        >
                          {amount >= 0 ? '+' : ''}
                          {amount.toFixed(8)} PHI
                          {fee !== 0 && (
                            <span className="ml-1 text-xs text-gray-400 dark:text-dark-mutedText">
                              (fee: {Math.abs(fee).toFixed(8)})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-900 dark:text-dark-text">
                          <span className="rounded-full bg-gray-100 dark:bg-dark-elevated px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-dark-secondary">
                            {category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-900 dark:text-dark-text">
                          {confirmations(tx)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card layout */}
            <div className="space-y-2 p-3 md:hidden">
              {filtered.map((tx) => {
                const amount = Number(tx.amount ?? 0);
                const fee = Number(tx.fee ?? 0);
                const category = String(tx.category ?? 'unknown');
                return (
                  <div
                    key={String(tx.txid ?? 0)}
                    className="rounded-lg border border-gray-200 dark:border-dark-border p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-sm font-semibold ${amount >= 0 ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {amount >= 0 ? '+' : ''}
                        {amount.toFixed(8).replace(/\.?0+$/, '')} PHI
                      </span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {category}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-phi-primary hover:underline">
                      {String(tx.txid ?? '').slice(0, 12)}...{String(tx.txid ?? '').slice(-8)}
                    </p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-xs text-gray-500 dark:text-dark-mutedText">
                        {formatDate(Number(tx.blocktime ?? tx.date ?? tx.time ?? 0))}
                      </span>
                      {confirmations(tx)}
                    </div>
                    {fee !== 0 && (
                      <span className="text-xs text-gray-400 dark:text-dark-mutedText">
                        fee: {Math.abs(fee).toFixed(8)}
                      </span>
                    )}
                  </div>
                );
              })}
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
    </div>
  );
};

export default Transactions;
