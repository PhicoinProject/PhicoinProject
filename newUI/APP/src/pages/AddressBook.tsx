import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { walletService } from '@/services/wallet';
import type { Address } from '@/types';

/** Address Book page — manage saved addresses with labels (Qt parity: addressbookpage) */
export const AddressBook: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'sending' | 'receiving'>('receiving');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: addresses, isLoading } = useQuery({
    queryKey: ['addressBook', activeTab],
    queryFn: () => walletService.getAddresses(),
    staleTime: 30_000,
  });

  const handleGenerateAddress = async () => {
    try {
      await walletService.createAddress(newLabel || undefined);
      queryClient.invalidateQueries({ queryKey: ['addressBook'] });
      setShowAddForm(false);
      setNewLabel('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate address');
    }
  };

  const handleExportCSV = () => {
    if (!addresses) return;
    const headers = ['Label', 'Address', 'Received', 'Transactions'];
    const rows = addresses.map((a: Address) => [
      a.label,
      a.address,
      a.totalReceived.toFixed(8),
      a.txids.length,
    ]);
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'addressbook.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">Address Book</h1>
        <button
          onClick={() => setShowAddForm(true)}
          className="rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New Address
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-600 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Add address form */}
      {showAddForm && (
        <div className="rounded-lg border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
            Generate New Address
          </h2>
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              placeholder="Label (optional)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
            />
            <button
              onClick={handleGenerateAddress}
              className="rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Generate
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="rounded-md border border-gray-300 dark:border-dark-muted px-4 py-2 text-sm font-medium text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-elevated"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-200 dark:bg-dark-elevated p-1">
        <button
          onClick={() => setActiveTab('receiving')}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'receiving'
              ? 'bg-white dark:bg-dark-muted text-gray-900 dark:text-dark-text shadow-sm'
              : 'text-gray-600 dark:text-dark-mutedText hover:text-gray-900 dark:hover:text-dark-secondary'
          }`}
        >
          Receiving
        </button>
        <button
          onClick={() => setActiveTab('sending')}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'sending'
              ? 'bg-white dark:bg-dark-muted text-gray-900 dark:text-dark-text shadow-sm'
              : 'text-gray-600 dark:text-dark-mutedText hover:text-gray-900 dark:hover:text-dark-secondary'
          }`}
        >
          Sending
        </button>
      </div>

      {/* Address List */}
      <div className="rounded-lg border bg-white dark:bg-dark-surface shadow-sm">
        {isLoading ? (
          <p className="p-6 text-sm text-gray-500 dark:text-dark-mutedText">Loading addresses...</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 dark:bg-dark-elevated text-gray-500 dark:text-dark-mutedText">
              <tr>
                <th className="px-4 py-3 font-medium">Label</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium text-right">Received</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!addresses || addresses.length === 0 ? (
                <tr className="border-b">
                  <td className="px-4 py-3 text-gray-400 dark:text-dark-mutedText" colSpan={5}>
                    No addresses saved yet. Click "New Address" to add one.
                  </td>
                </tr>
              ) : (
                addresses.map((addr: Address, i: number) => (
                  <tr
                    key={addr.address}
                    className={`border-b ${i % 2 === 0 ? 'bg-white dark:bg-dark-surface' : 'bg-gray-50 dark:bg-dark-elevated'}`}
                  >
                    <td className="px-4 py-3">{addr.label || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{addr.address.slice(0, 35)}...</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {addr.isMine ? 'Mine' : 'Watch-only'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{addr.totalReceived.toFixed(8)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => navigator.clipboard.writeText(addr.address)}
                        className="text-xs text-phi-primary hover:underline"
                      >
                        Copy
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Export button */}
      <div className="flex justify-end">
        <button
          onClick={handleExportCSV}
          disabled={!addresses || addresses.length === 0}
          className="rounded-md border border-gray-300 dark:border-dark-muted px-4 py-2 text-sm font-medium text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-elevated disabled:opacity-50"
        >
          Export to CSV
        </button>
      </div>
    </div>
  );
};

export default AddressBook;
