import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { walletService } from '@/services/wallet';
import { useAddressBookStore } from '@/stores/addressBookStore';
import type { Address } from '@/types';

/** Address Book page — manage saved addresses with labels (Qt parity: addressbookpage) */
export const AddressBook: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'sending' | 'receiving'>('receiving');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Address book store (localStorage backed)
  const { addEntry, updateLabel, deleteEntry, getEntries } = useAddressBookStore();
  const sendingEntries = useMemo(() => getEntries('sending'), [getEntries]);

  // Receiving addresses from wallet (RPC backed)
  const addressPool = useMemo(() => walletService.getDerivedAddressPool(), []);
  const addressList = useMemo(() => addressPool.map((a) => a.address), [addressPool]);

  const { data: receivingAddresses, isLoading: loadingReceiving } = useQuery({
    queryKey: ['addressBook', addressList.join(',')],
    queryFn: () => walletService.getAddresses(addressList),
    staleTime: 30_000,
    enabled: addressList.length > 0 && activeTab === 'receiving',
  });

  const handleAddSendingAddress = () => {
    setError(null);
    if (!newAddress.trim()) {
      setError('Address is required');
      return;
    }
    if (!newLabel.trim()) {
      setError('Label is required');
      return;
    }
    addEntry({ address: newAddress.trim(), label: newLabel.trim(), type: 'sending' });
    setNewAddress('');
    setNewLabel('');
    setShowAddForm(false);
  };

  const handleGenerateReceiveAddress = async () => {
    try {
      await walletService.createAddress();
      queryClient.invalidateQueries({ queryKey: ['addressBook'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate address');
    }
  };

  const handleStartEdit = (entry: { id: string; label: string }) => {
    setEditId(entry.id);
    setEditLabel(entry.label);
  };

  const handleSaveEdit = useCallback(() => {
    if (editId && editLabel.trim()) {
      updateLabel(editId, editLabel.trim());
    }
    setEditId(null);
    setEditLabel('');
  }, [editId, editLabel, updateLabel]);

  const handleCancelEdit = () => {
    setEditId(null);
    setEditLabel('');
  };

  const handleDelete = (id: string) => {
    deleteEntry(id);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleExportCSV = () => {
    if (activeTab === 'sending') {
      const headers = ['Label', 'Address', 'Type', 'Created'];
      const rows = sendingEntries.map((e) => [
        e.label,
        e.address,
        e.type,
        new Date(e.createdAt).toISOString(),
      ]);
      const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
      downloadCSV(csv);
    } else if (receivingAddresses) {
      const headers = ['Label', 'Address', 'Received', 'Transactions'];
      const rows = receivingAddresses.map((a: Address) => [
        a.label,
        a.address,
        a.totalReceived.toFixed(8),
        a.txids.length,
      ]);
      const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
      downloadCSV(csv);
    }
  };

  function downloadCSV(csv: string) {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `addressbook-${activeTab}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">Address Book</h1>
        <div className="flex gap-2">
          {activeTab === 'sending' && (
            <button
              onClick={() => setShowAddForm(true)}
              className="rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Add Address
            </button>
          )}
          {activeTab === 'receiving' && (
            <button
              onClick={handleGenerateReceiveAddress}
              className="rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              New Address
            </button>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-600 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Add sending address form */}
      {showAddForm && activeTab === 'sending' && (
        <div className="rounded-lg border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
            Add Sending Address
          </h2>
          <div className="mt-4 space-y-3">
            <input
              type="text"
              placeholder="Label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
            />
            <input
              type="text"
              placeholder="PHICOIN address"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAddSendingAddress}
                className="rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Save
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="rounded-md border border-gray-300 dark:border-dark-muted px-4 py-2 text-sm font-medium text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-elevated"
              >
                Cancel
              </button>
            </div>
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
          Receiving ({receivingAddresses?.length ?? 0})
        </button>
        <button
          onClick={() => setActiveTab('sending')}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'sending'
              ? 'bg-white dark:bg-dark-muted text-gray-900 dark:text-dark-text shadow-sm'
              : 'text-gray-600 dark:text-dark-mutedText hover:text-gray-900 dark:hover:text-dark-secondary'
          }`}
        >
          Sending ({sendingEntries.length})
        </button>
      </div>

      {/* Receiving addresses (RPC backed) */}
      {activeTab === 'receiving' && (
        <div className="rounded-lg border bg-white dark:bg-dark-surface shadow-sm">
          {loadingReceiving ? (
            <p className="p-6 text-sm text-gray-500 dark:text-dark-mutedText">
              Loading addresses...
            </p>
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
                {!receivingAddresses || receivingAddresses.length === 0 ? (
                  <tr className="border-b">
                    <td className="px-4 py-3 text-gray-400 dark:text-dark-mutedText" colSpan={5}>
                      No receiving addresses yet. Click "New Address" to generate one.
                    </td>
                  </tr>
                ) : (
                  receivingAddresses.map((addr: Address, i: number) => (
                    <tr
                      key={addr.address}
                      className={`border-b ${i % 2 === 0 ? 'bg-white dark:bg-dark-surface' : 'bg-gray-50 dark:bg-dark-elevated'}`}
                    >
                      <td className="px-4 py-3 text-gray-900 dark:text-dark-text">
                        {addr.label || '(no label)'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-dark-mutedText">
                        {addr.address}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-blue-100 dark:bg-blue-500 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-white">
                          Mine
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-dark-text">
                        {addr.totalReceived.toFixed(8)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleCopy(addr.address)}
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
      )}

      {/* Sending addresses (localStorage backed) */}
      {activeTab === 'sending' && (
        <div className="rounded-lg border bg-white dark:bg-dark-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 dark:bg-dark-elevated text-gray-500 dark:text-dark-mutedText">
              <tr>
                <th className="px-4 py-3 font-medium">Label</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium text-right">Created</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sendingEntries.length === 0 ? (
                <tr className="border-b">
                  <td className="px-4 py-3 text-gray-400 dark:text-dark-mutedText" colSpan={4}>
                    No sending addresses. Click "Add Address" to save one.
                  </td>
                </tr>
              ) : (
                sendingEntries.map((entry, i) => (
                  <tr
                    key={entry.id}
                    className={`border-b ${i % 2 === 0 ? 'bg-white dark:bg-dark-surface' : 'bg-gray-50 dark:bg-dark-elevated'}`}
                  >
                    <td className="px-4 py-3">
                      {editId === entry.id ? (
                        <input
                          type="text"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          onBlur={handleSaveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit();
                            if (e.key === 'Escape') handleCancelEdit();
                          }}
                          className="w-32 rounded border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-2 py-1 text-sm"
                          autoFocus
                        />
                      ) : (
                        <span
                          className="cursor-pointer text-gray-900 dark:text-dark-text hover:underline"
                          onClick={() => handleStartEdit(entry)}
                        >
                          {entry.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-dark-mutedText">
                      {entry.address}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-dark-mutedText">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        onClick={() => handleCopy(entry.address)}
                        className="text-xs text-phi-primary hover:underline"
                      >
                        Copy
                      </button>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="text-xs text-red-600 dark:text-red-400 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Export button */}
      <div className="flex justify-end">
        <button
          onClick={handleExportCSV}
          disabled={
            (activeTab === 'sending' && sendingEntries.length === 0) ||
            (activeTab === 'receiving' && (!receivingAddresses || receivingAddresses.length === 0))
          }
          className="rounded-md border border-gray-300 dark:border-dark-muted px-4 py-2 text-sm font-medium text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-elevated disabled:opacity-50"
        >
          Export to CSV
        </button>
      </div>
    </div>
  );
};

export default AddressBook;
