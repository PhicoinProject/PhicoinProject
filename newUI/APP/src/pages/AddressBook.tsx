import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { walletService } from '@/services/wallet';
import { useAddressBookStore } from '@/stores/addressBookStore';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import type { Address } from '@/types';
// Proper Base58Check validation (decodes + verifies checksum + version byte) — prevents
// saving/sending to a typo'd address that merely "looks" valid.
import { isValidPHICoinAddress } from '@/services/addressDerivation';

/** Address Book page — manage saved addresses with labels (Qt parity: addressbookpage) */
export const AddressBook: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'sending' | 'receiving'>('receiving');

  // Modal state: null = closed, 'add' = adding new, entry id = editing existing
  const [modalMode, setModalMode] = useState<null | 'add' | string>(null);
  const [modalAddress, setModalAddress] = useState('');
  const [modalLabel, setModalLabel] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Address book store (localStorage backed)
  const { addEntry, updateLabel, deleteEntry, getEntries, findByAddress, setLabel } =
    useAddressBookStore();
  const sendingEntries = useMemo(() => getEntries('sending'), [getEntries]);

  // Receiving addresses come from the wallet's derived pool. Use the ASYNC pool, which
  // discovers actually-used addresses via RPC; the sync pool is a fixed narrow window that
  // misses used addresses (e.g. where assets sit) and clutters the list with unused ones.
  const { data: pool, isLoading: loadingPool } = useQuery({
    queryKey: ['derivedPoolAsync'],
    queryFn: () => walletService.getDerivedAddressPoolAsync(),
    staleTime: 60_000,
    enabled: activeTab === 'receiving',
  });
  const addressList = useMemo(() => (pool ?? []).map((a) => a.address), [pool]);

  const { data: receivingAddresses, isLoading: loadingAddrs } = useQuery({
    queryKey: ['addressBook', addressList.join(',')],
    queryFn: () => walletService.getAddresses(addressList),
    staleTime: 30_000,
    enabled: addressList.length > 0 && activeTab === 'receiving',
  });
  const loadingReceiving = loadingPool || loadingAddrs;

  const openAddModal = () => {
    setModalMode('add');
    setModalAddress('');
    setModalLabel('');
    setModalError(null);
  };

  const closeModal = () => {
    setModalMode(null);
    setModalAddress('');
    setModalLabel('');
    setModalError(null);
  };

  const handleModalSave = () => {
    setModalError(null);
    const trimmedAddress = modalAddress.trim();
    const trimmedLabel = modalLabel.trim();

    if (!trimmedLabel) {
      setModalError('Label is required');
      return;
    }

    // Labeling one of the wallet's own receiving addresses (address is fixed, no validation).
    if (modalMode === 'edit-receiving') {
      setLabel(trimmedAddress, trimmedLabel, 'receiving');
      closeModal();
      return;
    }

    if (!trimmedAddress) {
      setModalError('Address is required');
      return;
    }
    // Full Base58Check validation — rejects typo'd addresses that fail the checksum.
    if (!isValidPHICoinAddress(trimmedAddress)) {
      setModalError('Invalid PHICOIN address — failed the Base58Check checksum / version check.');
      return;
    }

    if (modalMode === 'add') {
      // Check for duplicate address
      const existing = findByAddress(trimmedAddress);
      if (existing) {
        setModalError('This address is already in the address book.');
        return;
      }
      addEntry({ address: trimmedAddress, label: trimmedLabel, type: 'sending' });
    } else if (typeof modalMode === 'string') {
      updateLabel(modalMode, trimmedLabel);
    }
    closeModal();
  };

  const handleGenerateReceiveAddress = async () => {
    try {
      await walletService.createAddress();
      queryClient.invalidateQueries({ queryKey: ['addressBook'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate address');
    }
  };

  const handleStartEdit = useCallback((entry: { id: string; address: string; label: string }) => {
    setModalMode(entry.id);
    setModalAddress(entry.address);
    setModalLabel(entry.label);
    setModalError(null);
  }, []);

  // Edit the label of one of the wallet's own (receiving) addresses.
  const handleStartEditReceiving = (address: string, currentLabel: string) => {
    setModalMode('edit-receiving');
    setModalAddress(address);
    setModalLabel(currentLabel);
    setModalError(null);
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
            <Button onClick={openAddModal}>
              Add Address
            </Button>
          )}
          {activeTab === 'receiving' && (
            <Button onClick={handleGenerateReceiveAddress}>
              New Address
            </Button>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-600 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
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
                    <td className="px-4 py-3 text-gray-500 dark:text-dark-mutedText" colSpan={5}>
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
                        {findByAddress(addr.address)?.label || addr.label || '(no label)'}
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
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          onClick={() => handleCopy(addr.address)}
                          className="text-xs text-phi-primary hover:underline"
                        >
                          Copy
                        </button>
                        <button
                          onClick={() =>
                            handleStartEditReceiving(
                              addr.address,
                              findByAddress(addr.address)?.label || ''
                            )
                          }
                          className="text-xs text-phi-primary hover:underline"
                        >
                          Edit
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
                  <td className="px-4 py-3 text-gray-500 dark:text-dark-mutedText" colSpan={4}>
                    No sending addresses. Click "Add Address" to save one.
                  </td>
                </tr>
              ) : (
                sendingEntries.map((entry, i) => (
                  <tr
                    key={entry.id}
                    className={`border-b ${i % 2 === 0 ? 'bg-white dark:bg-dark-surface' : 'bg-gray-50 dark:bg-dark-elevated'}`}
                  >
                    <td className="px-4 py-3 text-gray-900 dark:text-dark-text">
                      {entry.label}
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
                        onClick={() => handleStartEdit(entry)}
                        className="text-xs text-phi-primary hover:underline"
                      >
                        Edit
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

      {/* Add / Edit sending address modal */}
      <Modal
        isOpen={modalMode !== null}
        onClose={closeModal}
        title={
          modalMode === 'add'
            ? 'Add Sending Address'
            : modalMode === 'edit-receiving'
              ? 'Label Receiving Address'
              : 'Edit Sending Address'
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-dark-secondary mb-1">
              Label <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Alice's wallet"
              value={modalLabel}
              onChange={(e) => setModalLabel(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary dark:text-dark-text"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-dark-secondary mb-1">
              PHICOIN Address <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="P... or H..."
              value={modalAddress}
              onChange={(e) => setModalAddress(e.target.value)}
              disabled={modalMode !== 'add'} // address cannot change on edit
              className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 font-mono text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary dark:text-dark-text disabled:opacity-60"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-dark-mutedText">
              Must start with P (pubkey hash) or H (script hash)
            </p>
          </div>
          {modalError && (
            <p className="text-sm text-red-600 dark:text-red-400">{modalError}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button onClick={handleModalSave}>
              {modalMode === 'add' ? 'Add' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AddressBook;
