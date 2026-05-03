import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { walletService } from '@/services/wallet';
import { Button } from '@/components/common/Button';
import { useToast } from '@/components/common/Toast';
import type { Address } from '@/types';

/** Wallet management page — addresses, import/export, backup */
export const Wallet: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const { data: walletInfo, isLoading: walletLoading } = useQuery({
    queryKey: ['walletInfo'],
    queryFn: () => walletService.getWalletInfo(),
    staleTime: 30_000,
  });

  const {
    data: addresses,
    isLoading: addrLoading,
    refetch,
  } = useQuery({
    queryKey: ['walletAddresses'],
    queryFn: () => walletService.getAddresses(),
    staleTime: 30_000,
  });

  const info = walletInfo as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-900 dark:text-dark-text md:text-2xl">Wallet</h1>

      {/* Wallet info card */}
      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 md:p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
          Wallet Info
        </h2>
        {walletLoading ? (
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse flex justify-between">
                <div className="h-4 w-24 rounded bg-gray-200 dark:bg-dark-muted" />
                <div className="h-4 w-32 rounded bg-gray-200 dark:bg-dark-muted" />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-dark-mutedText">Name</span>
              <span className="font-medium text-gray-900 dark:text-dark-text">
                {String(info?.walletname ?? '—')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-dark-mutedText">Status</span>
              <span
                className={`font-medium ${(info?.islocked as boolean) ? 'text-red-600' : 'text-green-600'}`}
              >
                {(info?.islocked as boolean) ? 'Locked' : 'Unlocked'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-dark-mutedText">Network</span>
              <span className="font-medium text-gray-900 dark:text-dark-text">
                {String(info?.network ?? '—')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-dark-mutedText">Balance</span>
              <span className="font-medium text-gray-900 dark:text-dark-text">
                {Number(info?.balance ?? 0).toFixed(8)} PHI
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-dark-mutedText">Unconfirmed Balance</span>
              <span className="font-medium text-gray-900 dark:text-dark-text">
                {Number(info?.unconfirmed_balance ?? 0).toFixed(8)} PHI
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-dark-mutedText">TX Count</span>
              <span className="font-medium text-gray-900 dark:text-dark-text">
                {Number(info?.txcount ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-dark-mutedText">Keypool Oldest</span>
              <span className="font-medium text-gray-900 dark:text-dark-text">
                {info?.keypoololdest
                  ? new Date(Number(info.keypoololdest) * 1000).toLocaleString()
                  : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-dark-mutedText">Keypool Size</span>
              <span className="font-medium text-gray-900 dark:text-dark-text">
                {Number(info?.keypoolsize ?? 0)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 md:p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">Actions</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => refetch()}>
            Refresh
          </Button>
          <Button variant="secondary" onClick={() => navigate('/backup')}>
            Backup Wallet
          </Button>
          <Button
            disabled
            title="Signing is blocked in the web UI. Use phicoin-cli for sensitive operations."
            variant="secondary"
          >
            Sign Message
          </Button>
          <Button
            disabled
            title="Verification is blocked in the web UI. Use phicoin-cli for sensitive operations."
            variant="secondary"
          >
            Verify Message
          </Button>
        </div>
      </div>

      {/* Addresses */}
      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 md:p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
            Addresses
          </h2>
          <button onClick={() => refetch()} className="text-sm text-phi-primary hover:underline">
            Refresh
          </button>
        </div>

        {addrLoading ? (
          <div className="mt-4 space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="animate-pulse flex gap-4">
                <div className="h-4 w-20 rounded bg-gray-200 dark:bg-dark-muted" />
                <div className="h-4 flex-1 rounded bg-gray-200 dark:bg-dark-muted" />
              </div>
            ))}
          </div>
        ) : !addresses || addresses.length === 0 ? (
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
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
              />
            </svg>
            <p className="mt-3 text-sm text-gray-500 dark:text-dark-mutedText">
              No addresses generated yet
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-dark-mutedText">
              Go to "Receive" to generate your first address
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-gray-50 dark:bg-dark-elevated text-gray-500 dark:text-dark-mutedText">
                  <tr>
                    <th className="px-4 py-3 font-medium">Label</th>
                    <th className="px-4 py-3 font-medium">Address</th>
                    <th className="px-4 py-3 font-medium text-right">Received</th>
                    <th className="px-4 py-3 font-medium text-right">TXs</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {addresses.map((addr: Address, i: number) => (
                    <tr
                      key={addr.address}
                      className={`border-b ${i % 2 === 0 ? 'bg-white dark:bg-dark-surface' : 'bg-gray-50 dark:bg-dark-elevated'}`}
                    >
                      <td className="px-4 py-3 text-gray-900 dark:text-dark-text">
                        {addr.label || '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-dark-mutedText">
                        {addr.address}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-dark-text">
                        {addr.totalReceived.toFixed(8)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-dark-text">
                        {addr.txids.length}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(addr.address);
                            showToast('Address copied', 'success');
                          }}
                          className="text-xs text-phi-primary hover:underline"
                        >
                          Copy
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card layout */}
            <div className="mt-4 space-y-2 md:hidden">
              {addresses.map((addr: Address) => (
                <div
                  key={addr.address}
                  className="rounded-lg border border-gray-200 dark:border-dark-border p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900 dark:text-dark-text">
                      {addr.label || 'No Label'}
                    </span>
                    <span className="text-sm text-phi-primary">
                      {addr.totalReceived.toFixed(8)} PHI
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-gray-500 dark:text-dark-mutedText">
                    {addr.address}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-gray-400 dark:text-dark-mutedText">
                      {addr.txids.length} transactions
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(addr.address);
                        showToast('Address copied', 'success');
                      }}
                      className="text-xs text-phi-primary hover:underline"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Wallet;
