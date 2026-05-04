import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { walletService } from '@/services/wallet';
import { useWalletStore } from '@/stores';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { useToast } from '@/components/common/Toast';
import { isValidPhicoinAddress } from '@/utils/crypto';

// ---- Types ----

interface Recipient {
  address: string;
  amount: string;
}

interface SendFormState {
  recipients: Recipient[];
  comment: string;
  subtractFee: boolean;
  fromAddress: string;
  showCoinSelect: boolean;
  feeRate: number;
  confTarget: number;
}

interface SendFormErrors {
  recipients: (string | null)[]; // parallel to recipients
}

interface CoinUtxo {
  txid: string;
  vout: number;
  address: string;
  amount: number;
  confirmations: number;
  selected: boolean;
}

/** Confirmation dialog shown after clicking Send, with countdown */
const ConfirmDialog: React.FC<{
  recipients: Recipient[];
  feeRate: number;
  totalFeeEstimate: number;
  countDown: number;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ recipients, feeRate, totalFeeEstimate, countDown, onConfirm, onCancel }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-xl">
        <h2 className="text-lg font-bold text-gray-900 dark:text-dark-text">Confirm Transaction</h2>

        <div className="mt-4 space-y-3 text-sm">
          {recipients.map((r, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-md bg-gray-50 dark:bg-dark-elevated p-3"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 dark:text-dark-secondary truncate">
                  {r.address}
                </p>
                <p className="text-xs text-gray-500 dark:text-dark-mutedText">
                  {parseFloat(r.amount).toFixed(8)} PHI
                </p>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between border-t border-gray-200 dark:border-dark-border pt-3">
            <span className="text-gray-600 dark:text-dark-mutedText">Fee rate</span>
            <span className="font-medium text-gray-800 dark:text-dark-secondary">
              {feeRate.toFixed(2)} sat/B
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600 dark:text-dark-mutedText">Estimated fee</span>
            <span className="font-medium text-gray-800 dark:text-dark-secondary">
              {(totalFeeEstimate / 1e8).toFixed(8)} PHI
            </span>
          </div>
        </div>

        {/* Countdown */}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-dark-mutedText">
            Auto-dismiss in {countDown}s
          </span>
        </div>

        <div className="mt-4 flex gap-3">
          <Button variant="secondary" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} className="flex-1">
            Confirm & Send
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Parse a `phicoin:` URI into address, amount, and message components.
 * Format: phicoin:address?amount=X&message=Y
 */
function parsePhicoinUri(
  uri: string
): { address: string; amount?: string; message?: string } | null {
  const match = uri.match(/^phicoin:([a-zA-Z0-9]+)(\?.*)?$/i);
  if (!match) return null;

  const address = match[1];
  const query = match[2];

  const result: { address: string; amount?: string; message?: string } = { address };

  if (query) {
    try {
      const params = new URLSearchParams(query.slice(1));
      const amount = params.get('amount');
      const message = params.get('message');
      if (amount) result.amount = amount;
      if (message) result.message = decodeURIComponent(message);
    } catch {
      // Invalid query string, just use address
    }
  }

  return result;
}

/** Send coins page with multi-recipient, coin selection, fee estimation, and confirmation */
export const Send: React.FC = () => {
  const phiBalance = useWalletStore((s) => s.phiBalance);
  const network = useWalletStore((s) => s.network);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const addressPool = useMemo(() => walletService.getDerivedAddressPool(), []);
  const addressList = useMemo(() => addressPool.map((a) => a.address), [addressPool]);

  // Handle phicoin: URIs from deep links / drag-and-drop
  useEffect(() => {
    const handleUri = (uri: string) => {
      const parsed = parsePhicoinUri(uri);
      if (!parsed) {
        showToast('Invalid PHICOIN URI', 'error');
        return;
      }
      if (!isValidPhicoinAddress(parsed.address, network)) {
        showToast('Invalid address in PHICOIN URI', 'error');
        return;
      }
      setForm((f) => ({
        ...f,
        recipients: [{ address: parsed.address, amount: parsed.amount || '' }],
        comment: parsed.message || f.comment,
      }));
      setErrors({ recipients: [null] });
      showToast('PHICOIN URI loaded', 'success');
    };

    // Check URL hash on mount (deep link)
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('phicoin:')) {
      handleUri(hash);
      window.location.hash = '';
    }

    // Drag and drop handler
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      const text = e.dataTransfer?.getData('text/plain');
      if (text?.trim().startsWith('phicoin:')) {
        handleUri(text.trim());
      }
    };

    window.addEventListener('drop', handleDrop);
    return () => window.removeEventListener('drop', handleDrop);
  }, [network, showToast]);

  const { data: addresses } = useQuery({
    queryKey: ['sendAddresses', addressList.join(',')],
    queryFn: () => walletService.getAddresses(addressList),
    staleTime: 60_000,
    enabled: addressList.length > 0,
  });

  const [form, setForm] = useState<SendFormState>({
    recipients: [{ address: '', amount: '' }],
    comment: '',
    subtractFee: false,
    fromAddress: '',
    showCoinSelect: false,
    feeRate: 1,
    confTarget: 6,
  });
  const [coins, setCoins] = useState<CoinUtxo[]>([]);
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<SendFormErrors>({ recipients: [null] });
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmCountdown, setConfirmCountdown] = useState(10);

  const availableAddresses = (addresses ?? []).filter((a) => a.balance > 0);

  // ---- Fee rate estimation ----
  const fetchFeeRate = useCallback(async () => {
    try {
      const estimated = await walletService.estimateSmartFee(form.confTarget);
      if (estimated != null) {
        setForm((f) => ({ ...f, feeRate: estimated }));
        showToast('Fee rate updated', 'info');
      } else {
        showToast('Could not estimate fee, using default (1 sat/B)', 'warning');
      }
    } catch {
      showToast('Fee estimation failed, using default', 'warning');
    }
  }, [form.confTarget, showToast]);

  // ---- Address pool for "from" selection ----
  const handleAddressChange = (addr: string) => {
    setForm((f) => ({ ...f, fromAddress: addr, showCoinSelect: false }));
    setCoins([]);
  };

  // ---- Coin (UTXO) loading for selected address ----
  const loadCoins = async () => {
    if (!form.fromAddress) return;
    const utxos = await walletService.getUnspent([form.fromAddress]);
    const addrUtxos: CoinUtxo[] = utxos.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      address: form.fromAddress,
      amount: u.amount,
      confirmations: u.confirmations,
      selected: false,
    }));
    setCoins(addrUtxos);
    setForm((f) => ({ ...f, showCoinSelect: true }));
  };

  const toggleCoin = (index: number) => {
    setCoins((prev) => prev.map((c, i) => (i === index ? { ...c, selected: !c.selected } : c)));
  };

  const toggleAllCoins = () => {
    const allSelected = coins.every((c) => c.selected);
    setCoins((prev) => prev.map((c) => ({ ...c, selected: !allSelected })));
  };

  const selectedAmount = coins.filter((c) => c.selected).reduce((sum, c) => sum + c.amount, 0);

  const selectedAddressBalance =
    availableAddresses.find((a) => a.address === form.fromAddress)?.balance ?? 0;

  // ---- Recipient management (multi-recipient) ----
  const updateRecipient = (index: number, field: 'address' | 'amount', value: string) => {
    const updated = [...form.recipients];
    updated[index] = { ...updated[index], [field]: value };
    setForm((f) => ({ ...f, recipients: updated }));
    // Clear error for this recipient
    const updatedErrors = [...errors.recipients];
    updatedErrors[index] = null;
    setErrors({ recipients: updatedErrors });
  };

  const addRecipient = () => {
    setForm((f) => ({
      ...f,
      recipients: [...f.recipients, { address: '', amount: '' }],
    }));
    setErrors((e) => ({ recipients: [...e.recipients, null] }));
  };

  const removeRecipient = (index: number) => {
    if (form.recipients.length <= 1) return; // keep at least one
    const updated = form.recipients.filter((_, i) => i !== index);
    setForm((f) => ({ ...f, recipients: updated }));
    const updatedErrors = errors.recipients.filter((_, i) => i !== index);
    setErrors({ recipients: updatedErrors });
  };

  // ---- Validation ----
  const validateRecipient = (r: Recipient, index: number): string | null => {
    if (!r.address.trim()) return `Recipient ${index + 1}: address is required`;
    if (!isValidPhicoinAddress(r.address, network)) {
      return `Recipient ${index + 1}: invalid PHICOIN address for ${network}`;
    }
    if (!r.amount.trim()) return `Recipient ${index + 1}: amount is required`;
    const num = parseFloat(r.amount);
    if (isNaN(num) || num <= 0) {
      return `Recipient ${index + 1}: enter a valid amount greater than 0`;
    }
    return null;
  };

  const totalRecipientAmount = form.recipients.reduce((sum, r) => {
    const n = parseFloat(r.amount);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  const balanceToCheck = form.fromAddress ? selectedAddressBalance : phiBalance;
  const overBalance = totalRecipientAmount > balanceToCheck && !form.subtractFee;

  // Estimate total fee: ~180 per input + ~34 per output (recipients + 1 change)
  const estimatedFeeSat =
    (Math.max(coins.length || 1, 1) * 180 + (form.recipients.length + 1) * 34) * form.feeRate;

  // ---- Countdown timer for confirmation dialog ----
  useEffect(() => {
    if (!showConfirm) return;
    if (confirmCountdown <= 0) {
      setShowConfirm(false);
      return;
    }
    const timer = setTimeout(() => setConfirmCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [showConfirm, confirmCountdown]);

  // ---- Submit flow ----
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all recipients
    const newErrors = form.recipients.map((r, i) => validateRecipient(r, i));
    const hasErrors = newErrors.some((err) => err !== null);
    setErrors({ recipients: newErrors });
    if (hasErrors) return;

    if (overBalance) {
      showToast('Total amount exceeds available balance', 'error');
      return;
    }

    // Show confirmation dialog
    setConfirmCountdown(10);
    setShowConfirm(true);
  };

  const handleConfirmSend = async () => {
    setShowConfirm(false);
    setSending(true);

    try {
      const sendAddresses = form.fromAddress ? [form.fromAddress] : addressList;
      const recipients = form.recipients.map((r) => ({
        address: r.address,
        value: parseFloat(r.amount),
      }));

      const txid = await walletService.sendToMany(sendAddresses, recipients, form.feeRate);

      showToast(`Transaction sent: ${txid}`, 'success');

      // Reset form
      setForm({
        recipients: [{ address: '', amount: '' }],
        comment: '',
        subtractFee: false,
        fromAddress: '',
        showCoinSelect: false,
        feeRate: 1,
        confTarget: 6,
      });
      setCoins([]);
      setErrors({ recipients: [null] });

      // Refresh wallet data
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['sendAddresses'] });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to send transaction', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleCancelConfirm = () => {
    setShowConfirm(false);
  };

  const handleMax = () => {
    const max = form.fromAddress ? selectedAddressBalance : phiBalance;
    // Put max on first recipient, clear others
    const updated = form.recipients.map((r, i) =>
      i === 0 ? { ...r, amount: String(max) } : { ...r, amount: '' }
    );
    setForm((f) => ({ ...f, recipients: updated }));
  };

  // ---- Render helpers ----
  const overBalanceForDisplay = totalRecipientAmount > 0 && overBalance;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-xl font-bold text-gray-900 dark:text-dark-text md:text-2xl">Send</h1>

      {/* Balance display */}
      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 shadow-sm">
        <p className="text-sm text-gray-500 dark:text-dark-mutedText">Available Balance</p>
        <p className="text-xl font-bold text-phi-primary">
          {phiBalance.toFixed(8).replace(/\.?0+$/, '')} PHI
        </p>
        {form.fromAddress && (
          <p className="mt-1 text-sm text-gray-500 dark:text-dark-mutedText">
            Selected address:{' '}
            <span className="font-semibold text-phi-primary">
              {selectedAddressBalance.toFixed(8)} PHI
            </span>
          </p>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 md:p-6 shadow-sm"
      >
        {/* Address selection */}
        {availableAddresses.length > 1 && (
          <div>
            <label
              htmlFor="fromAddress"
              className="block text-sm font-medium text-gray-700 dark:text-dark-secondary"
            >
              From Address
            </label>
            <select
              id="fromAddress"
              value={form.fromAddress}
              onChange={(e) => handleAddressChange(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
            >
              <option value="">All addresses (auto-select)</option>
              {availableAddresses.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.label || `${a.address.slice(0, 10)}...${a.address.slice(-8)}`} (
                  {a.balance.toFixed(8)})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Multi-recipient section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-dark-secondary">
              Recipients
            </label>
            <button
              type="button"
              onClick={addRecipient}
              className="text-xs text-phi-primary hover:underline"
            >
              + Add Recipient
            </button>
          </div>

          {form.recipients.map((r, i) => {
            const err = errors.recipients[i];
            return (
              <div
                key={i}
                className="mb-3 flex gap-2 items-start rounded-lg border border-gray-100 dark:border-dark-muted p-3"
              >
                {/* Address */}
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Recipient address (P...)"
                    value={r.address}
                    onChange={(e) => updateRecipient(i, 'address', e.target.value)}
                    className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                      err
                        ? 'border-red-300 dark:border-red-600 focus:border-red-500 focus:ring-red-500'
                        : 'border-gray-300 dark:border-dark-muted focus:border-phi-primary focus:ring-phi-primary'
                    }`}
                  />
                  {err && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{err}</p>}
                </div>

                {/* Amount */}
                <div className="w-36">
                  <input
                    type="number"
                    min="0.00000001"
                    step="any"
                    placeholder="Amount PHI"
                    value={r.amount}
                    onChange={(e) => updateRecipient(i, 'amount', e.target.value)}
                    className="w-full rounded-md border border-gray-300 dark:border-dark-muted px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                  />
                </div>

                {/* Remove button */}
                {form.recipients.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRecipient(i)}
                    className="mt-1 rounded p-1 text-gray-400 hover:text-red-500"
                    title="Remove recipient"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}

          {form.recipients.length > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500 dark:text-dark-mutedText">
                Total: {totalRecipientAmount.toFixed(8)} PHI
              </span>
              {form.fromAddress && (
                <button
                  type="button"
                  onClick={handleMax}
                  className="text-xs text-phi-primary hover:underline"
                >
                  MAX to first
                </button>
              )}
            </div>
          )}
        </div>

        {/* Fee rate section */}
        <div className="rounded-lg border border-gray-200 dark:border-dark-border p-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-dark-secondary mb-2">
            Fee Settings
          </h3>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label
                htmlFor="confTarget"
                className="block text-xs text-gray-500 dark:text-dark-mutedText"
              >
                Confirmation target (blocks)
              </label>
              <input
                id="confTarget"
                type="number"
                min="1"
                max="100"
                value={form.confTarget}
                onChange={(e) =>
                  setForm((f) => ({ ...f, confTarget: Math.max(1, parseInt(e.target.value) || 6) }))
                }
                className="mt-1 w-full rounded-md border border-gray-300 dark:border-dark-muted px-3 py-1.5 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
              />
            </div>
            <div className="flex-1">
              <label
                htmlFor="feeRate"
                className="block text-xs text-gray-500 dark:text-dark-mutedText"
              >
                Fee rate (sat/byte)
              </label>
              <input
                id="feeRate"
                type="number"
                min="0.01"
                step="0.01"
                value={form.feeRate}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    feeRate: Math.max(0.01, parseFloat(e.target.value) || 1),
                  }))
                }
                className="mt-1 w-full rounded-md border border-gray-300 dark:border-dark-muted px-3 py-1.5 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={fetchFeeRate}
              size="sm"
              className="mb-[1px]"
            >
              Auto
            </Button>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-dark-mutedText">
            Estimated fee: {(estimatedFeeSat / 1e8).toFixed(8)} PHI
          </p>
        </div>

        {/* Coin selection */}
        {form.fromAddress && !form.showCoinSelect && (
          <Button type="button" variant="secondary" onClick={loadCoins} className="w-full">
            Select Coins
          </Button>
        )}

        {form.showCoinSelect && coins.length > 0 && (
          <div className="rounded-lg border border-gray-200 dark:border-dark-border p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700 dark:text-dark-secondary">
                UTXOs ({coins.length})
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-dark-mutedText">
                  Selected: {selectedAmount.toFixed(8)} PHI
                </span>
                <button
                  type="button"
                  onClick={toggleAllCoins}
                  className="text-xs text-phi-primary hover:underline"
                >
                  {coins.every((c) => c.selected) ? 'Deselect All' : 'Select All'}
                </button>
              </div>
            </div>
            <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
              {coins.map((coin, i) => (
                <label
                  key={i}
                  className={`flex items-center justify-between rounded-md p-2 text-sm cursor-pointer ${
                    coin.selected
                      ? 'bg-phi-primary/10 border border-phi-primary/30'
                      : 'bg-gray-50 dark:bg-dark-elevated border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={coin.selected}
                      onChange={() => toggleCoin(i)}
                      className="rounded border-gray-300 dark:border-dark-muted"
                    />
                    <span className="font-mono text-xs text-gray-600 dark:text-dark-mutedText">
                      {coin.txid.slice(0, 10)}...{coin.txid.slice(-6)}:{coin.vout}
                    </span>
                  </div>
                  <span className="font-medium text-gray-800 dark:text-dark-secondary">
                    {coin.amount.toFixed(8)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* UTXO display for all-address mode */}
        {!form.fromAddress && coins.length === 0 && addressList.length > 0 && (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={async () => {
              const utxos = await walletService.getUnspent(addressList);
              const allUtxos: CoinUtxo[] = utxos.map((u) => ({
                txid: u.txid,
                vout: u.vout,
                address: addressList[0], // not known per-UTXO without extra lookup
                amount: u.amount,
                confirmations: u.confirmations,
                selected: false,
              }));
              setCoins(allUtxos);
              setForm((f) => ({ ...f, showCoinSelect: true }));
            }}
          >
            View All UTXOs
          </Button>
        )}

        <Input
          id="comment"
          label="Comment (optional)"
          type="text"
          placeholder="Memo for this transaction"
          value={form.comment}
          onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
        />

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-secondary">
          <input
            type="checkbox"
            checked={form.subtractFee}
            onChange={(e) => setForm((f) => ({ ...f, subtractFee: e.target.checked }))}
            className="rounded border-gray-300 dark:border-dark-muted"
          />
          Subtract fee from amount
        </label>

        {/* Balance warning */}
        {overBalanceForDisplay && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Total amount exceeds available balance of {balanceToCheck.toFixed(8)} PHI.
          </p>
        )}

        {/* MAX button for single recipient */}
        {form.recipients.length === 1 && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleMax}
              className="text-sm font-medium text-phi-primary hover:underline"
            >
              Send MAX
            </button>
          </div>
        )}

        <Button
          type="submit"
          disabled={sending || overBalance || !!errors.recipients.find((e) => e)}
          loading={sending}
          className="w-full"
        >
          Send
        </Button>
      </form>

      {/* Confirmation dialog */}
      {showConfirm && (
        <ConfirmDialog
          recipients={form.recipients}
          feeRate={form.feeRate}
          totalFeeEstimate={estimatedFeeSat}
          countDown={confirmCountdown}
          onConfirm={handleConfirmSend}
          onCancel={handleCancelConfirm}
        />
      )}
    </div>
  );
};

export default Send;
