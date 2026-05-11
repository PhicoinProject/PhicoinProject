import React from 'react';
import { useTransactions, useNetworkStatus, useMyAssets } from '@/hooks';
import { useWalletStore } from '@/stores';
import { Spinner } from '@/components/common/Spinner';
import { truncate, formatRelativeTime, formatConfirmations } from '@/utils/format';

/** Dashboard overview page showing balance, recent transactions, and network status */
export const Overview: React.FC = () => {
  // Balance is maintained by useRealtimeUpdates in MainApp (prevents duplicate polling race)
  const phiBalance = useWalletStore((s) => s.phiBalance);
  const error = useWalletStore((s) => s.error);

  // Recent transactions
  const {
    data: transactions,
    isLoading: txLoading,
    isError: txError,
  } = useTransactions({ count: 5 });

  // Network status (block count, peers)
  const { data: networkStatus, isLoading: netLoading, isError: netError } = useNetworkStatus();

  // Asset count
  const { data: assets, isLoading: assetsLoading } = useMyAssets();

  const blockCount = (networkStatus as { blockCount: number } | undefined)?.blockCount ?? 0;
  const networkInfo = (networkStatus as { networkInfo: Record<string, unknown> } | undefined)
    ?.networkInfo as Record<string, unknown> | undefined;
  const version = networkInfo?.version ?? '';
  const subVer = (networkInfo?.subversion as string) ?? '';
  const protocolVersion = networkInfo?.protocolversion ?? 0;
  const connections = networkInfo?.connections ?? 0;
  const networks = (networkInfo?.networks as Array<Record<string, unknown>>) ?? [];
  const networkName = String(networks.find((n) => n.name !== 'signet')?.name ?? 'mainnet');

  // Parse transaction items from RPC response
  type TxItem = Record<string, unknown>;
  const txItems = (transactions as TxItem[] | undefined) ?? [];

  const formatPhi = (val: number) => `${val.toFixed(8).replace(/\.?0+$/, '')} PHI`;

  // Skeleton loader for stat cards
  const StatSkeleton: React.FC = () => (
    <div className="animate-pulse">
      <div className="h-4 w-20 rounded bg-gray-200 dark:bg-dark-muted" />
      <div className="mt-2 h-8 w-32 rounded bg-gray-200 dark:bg-dark-muted" />
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-900 dark:text-dark-text md:text-2xl">Dashboard</h1>

      {/* Top-level error banner */}
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-600 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Balance / Assets / Network cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 md:p-6 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-dark-mutedText">Total Balance</p>
          <p className="mt-2 text-2xl font-bold text-phi-primary md:text-3xl">
            {formatPhi(phiBalance)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 md:p-6 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-dark-mutedText">Assets</p>
          <p className="mt-2 text-2xl font-bold text-gray-700 dark:text-dark-secondary md:text-3xl">
            {assetsLoading ? '...' : ((assets as unknown[] | undefined)?.length ?? 0)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 md:p-6 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-dark-mutedText">Network</p>
          {netLoading ? (
            <Spinner size="sm" className="mt-2" />
          ) : (
            <>
              <p className="mt-2 text-lg font-semibold text-green-600">{networkName}</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-dark-mutedText">
                Block #{blockCount.toLocaleString()}
              </p>
              {subVer && (
                <p className="mt-0.5 text-xs text-gray-400 dark:text-dark-mutedText">{subVer}</p>
              )}
            </>
          )}
          {netError && <p className="mt-2 text-sm text-red-500">Connection failed</p>}
        </div>
      </div>

      {/* Additional network info */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {netLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 shadow-sm"
            >
              <StatSkeleton />
            </div>
          ))
        ) : (
          <>
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-dark-mutedText">Block Height</p>
              <p className="mt-1 text-lg font-bold text-gray-900 dark:text-dark-text">
                {blockCount.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-dark-mutedText">Connections</p>
              <p className="mt-1 text-lg font-bold text-gray-900 dark:text-dark-text">
                {String(connections)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-dark-mutedText">Version</p>
              <p className="mt-1 text-sm font-bold text-gray-900 dark:text-dark-text">
                {String(version)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-dark-mutedText">Protocol</p>
              <p className="mt-1 text-sm font-bold text-gray-900 dark:text-dark-text">
                {String(protocolVersion)}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Recent transactions */}
      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 md:p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
          Recent Transactions
        </h2>

        {txLoading && (
          <div className="mt-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse flex items-center gap-4">
                <div className="h-4 flex-1 rounded bg-gray-200 dark:bg-dark-muted" />
                <div className="h-4 w-24 rounded bg-gray-200 dark:bg-dark-muted" />
                <div className="h-4 w-20 rounded bg-gray-200 dark:bg-dark-muted" />
              </div>
            ))}
          </div>
        )}

        {txError && (
          <div className="mt-4 rounded-md bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
            Failed to load transactions
          </div>
        )}

        {!txLoading && !txError && txItems.length === 0 && (
          <div className="mt-4 flex flex-col items-center py-8 text-center">
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
              No transactions yet
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-dark-mutedText">
              Your transaction history will appear here
            </p>
          </div>
        )}

        {!txLoading && txItems.length > 0 && (
          <>
            {/* Desktop table */}
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-dark-elevated text-gray-600 dark:text-dark-mutedText">
                  <tr>
                    <th className="px-4 py-3 font-medium">TxID</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Confirmations</th>
                  </tr>
                </thead>
                <tbody>
                  {txItems.map((tx: TxItem, i) => {
                    const txid = String(tx.txid ?? '');
                    const amount = Number(tx.amount ?? 0);
                    const time = Number(tx.time ?? tx.blocktime ?? Date.now() / 1000);
                    const confs = Number(tx.confirmations ?? 0);
                    const category = String(tx.category ?? '');
                    const isPositive = category !== 'send';
                    const displayAmount = category === 'generate' ? Math.abs(amount) : amount;

                    return (
                      <tr
                        key={txid || i}
                        className="border-t hover:bg-gray-50 dark:hover:bg-dark-elevated"
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600 dark:text-dark-mutedText">
                          {truncate(txid)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 dark:text-dark-mutedText">
                          {formatRelativeTime(time)}
                        </td>
                        <td
                          className={`whitespace-nowrap px-4 py-3 text-sm font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}
                        >
                          {isPositive ? '+' : '-'}
                          {Math.abs(displayAmount)
                            .toFixed(8)
                            .replace(/\.?0+$/, '')}{' '}
                          PHI
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 dark:text-dark-mutedText">
                          {formatConfirmations(confs)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card layout */}
            <div className="mt-4 space-y-2 md:hidden">
              {txItems.map((tx: TxItem, i) => {
                const txid = String(tx.txid ?? '');
                const amount = Number(tx.amount ?? 0);
                const time = Number(tx.time ?? tx.blocktime ?? Date.now() / 1000);
                const confs = Number(tx.confirmations ?? 0);
                const category = String(tx.category ?? '');
                const isPositive = category !== 'send';
                const displayAmount = category === 'generate' ? Math.abs(amount) : amount;

                return (
                  <div
                    key={txid || i}
                    className="rounded-lg border border-gray-200 dark:border-dark-border p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-sm font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {isPositive ? '+' : '-'}
                        {Math.abs(displayAmount)
                          .toFixed(8)
                          .replace(/\.?0+$/, '')}{' '}
                        PHI
                      </span>
                      <span className="text-xs text-gray-500 dark:text-dark-mutedText">
                        {formatConfirmations(confs)}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-gray-500 dark:text-dark-mutedText">
                      {truncate(txid)}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-dark-mutedText">
                      {formatRelativeTime(time)}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Overview;
