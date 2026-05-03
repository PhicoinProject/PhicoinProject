import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { walletService } from '@/services/wallet';
import { rpc } from '@/services/rpc';
import { useWalletStore } from '@/stores';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { useToast } from '@/components/common/Toast';
import { isValidPhicoinAddress } from '@/utils/crypto';

interface SendFormState {
  destination: string;
  amount: string;
  comment: string;
  subtractFee: boolean;
  fromAddress: string;
  showCoinSelect: boolean;
}

interface SendFormErrors {
  destination?: string;
  amount?: string;
}

interface CoinUtxo {
  txid: string;
  vout: number;
  address: string;
  amount: number;
  confirmations: number;
  selected: boolean;
}

/** Send coins page with address validation, coin selection, and fee estimation */
export const Send: React.FC = () => {
  const phiBalance = useWalletStore((s) => s.phiBalance);
  const network = useWalletStore((s) => s.network);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: addresses } = useQuery({
    queryKey: ['sendAddresses'],
    queryFn: () => walletService.getAddresses(),
    staleTime: 60_000,
  });

  const [form, setForm] = useState<SendFormState>({
    destination: '',
    amount: '',
    comment: '',
    subtractFee: false,
    fromAddress: '',
    showCoinSelect: false,
  });
  const [coins, setCoins] = useState<CoinUtxo[]>([]);
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<SendFormErrors>({});

  const availableAddresses = (addresses ?? []).filter((a) => a.balance > 0);

  const handleAddressChange = (addr: string) => {
    setForm({ ...form, fromAddress: addr, showCoinSelect: false });
    setCoins([]);
  };

  const loadCoins = async () => {
    if (!form.fromAddress) return;
    const data = await rpc.listUnspent(0);
    const allUtxos = data as Array<Record<string, unknown>>;
    const addrUtxos: CoinUtxo[] = allUtxos
      .filter((u) => String(u.address) === form.fromAddress)
      .map((u) => ({
        txid: String(u.txid ?? ''),
        vout: Number(u.vout ?? 0),
        address: String(u.address ?? ''),
        amount: Number(u.amount ?? 0),
        confirmations: Number(u.confirmations ?? 0),
        selected: false,
      }));
    setCoins(addrUtxos);
    setForm({ ...form, showCoinSelect: true });
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

  const validateAddress = (addr: string) => {
    if (!addr) return '';
    if (!isValidPhicoinAddress(addr, network)) {
      return `Invalid PHICOIN address for ${network}. Must start with P or H.`;
    }
    return '';
  };

  const validateAmount = (amt: string) => {
    if (!amt) return '';
    const num = parseFloat(amt);
    if (isNaN(num) || num <= 0) return 'Please enter a valid amount greater than 0';
    if (num > Number.MAX_SAFE_INTEGER / 1e8) return 'Amount is too large.';
    if (form.fromAddress && num > selectedAddressBalance && !form.subtractFee)
      return 'Insufficient balance at selected address';
    if (!form.fromAddress && num > phiBalance && !form.subtractFee) return 'Insufficient balance';
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const addressError = validateAddress(form.destination);
    const amountError = validateAmount(form.amount);
    if (addressError || amountError) {
      setErrors({ destination: addressError, amount: amountError });
      return;
    }

    setSending(true);

    try {
      const txid = await walletService.sendTo(
        form.destination,
        parseFloat(form.amount),
        form.comment || undefined
      );
      showToast(`Transaction sent: ${txid}`, 'success');
      setForm({
        destination: '',
        amount: '',
        comment: '',
        subtractFee: false,
        fromAddress: '',
        showCoinSelect: false,
      });
      setCoins([]);
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to send transaction', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleMax = () => {
    const max = form.fromAddress ? selectedAddressBalance : phiBalance;
    setForm({ ...form, amount: String(max) });
  };

  const addressErr = errors.destination || '';
  const amountErr = errors.amount || '';
  const overBalance =
    form.amount !== '' &&
    ((form.fromAddress && parseFloat(form.amount) > selectedAddressBalance) ||
      (!form.fromAddress && parseFloat(form.amount) > phiBalance)) &&
    !form.subtractFee;

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

        <Input
          id="destination"
          label="Recipient Address"
          type="text"
          required
          placeholder="P..."
          value={form.destination}
          onChange={(e) => {
            setForm({ ...form, destination: e.target.value });
            setErrors((prev) => ({ ...prev, destination: '' }));
          }}
          error={addressErr}
        />

        <div>
          <label
            htmlFor="amount"
            className="block text-sm font-medium text-gray-700 dark:text-dark-secondary"
          >
            Amount (PHI)
          </label>
          <div className="relative">
            <input
              id="amount"
              type="number"
              required
              min="0.00000001"
              step="any"
              placeholder="0.00"
              className={`mt-1 w-full rounded-md border px-3 py-2 text-sm pr-14 focus:outline-none focus:ring-1 ${
                amountErr || overBalance
                  ? 'border-red-300 dark:border-red-600 focus:border-red-500 focus:ring-red-500'
                  : 'border-gray-300 dark:border-dark-muted focus:border-phi-primary focus:ring-phi-primary'
              }`}
              value={form.amount}
              onChange={(e) => {
                setForm({ ...form, amount: e.target.value });
                setErrors((prev) => ({ ...prev, amount: '' }));
              }}
            />
            <button
              type="button"
              onClick={handleMax}
              className="absolute right-2 top-7 rounded px-2 py-0.5 text-xs font-medium text-phi-primary hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
            >
              MAX
            </button>
          </div>
          {amountErr && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{amountErr}</p>}
          {!amountErr && overBalance && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              Amount exceeds available balance.
            </p>
          )}
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

        <Input
          id="comment"
          label="Comment (optional)"
          type="text"
          placeholder="Memo for this transaction"
          value={form.comment}
          onChange={(e) => setForm({ ...form, comment: e.target.value })}
        />

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-secondary">
          <input
            type="checkbox"
            checked={form.subtractFee}
            onChange={(e) => setForm({ ...form, subtractFee: e.target.checked })}
            className="rounded border-gray-300 dark:border-dark-muted"
          />
          Subtract fee from amount
        </label>

        <Button
          type="submit"
          disabled={sending || overBalance || !!addressErr}
          loading={sending}
          className="w-full"
        >
          Send
        </Button>
      </form>
    </div>
  );
};

export default Send;
