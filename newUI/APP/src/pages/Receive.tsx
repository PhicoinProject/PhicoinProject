import React, { useState, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { walletService } from '@/services/wallet';
import { Button } from '@/components/common/Button';
import { useToast } from '@/components/common/Toast';

/** Build a BIP21 URI from address and optional payment parameters */
function buildBip21Uri(
  addr: string,
  opts: { amount?: string; label?: string; message?: string }
): string {
  const params: string[] = [];
  if (opts.amount && opts.amount.trim()) {
    const n = parseFloat(opts.amount.trim());
    if (!isNaN(n) && n > 0) params.push(`amount=${n}`);
  }
  if (opts.label && opts.label.trim())
    params.push(`label=${encodeURIComponent(opts.label.trim())}`);
  if (opts.message && opts.message.trim())
    params.push(`message=${encodeURIComponent(opts.message.trim())}`);
  return `phicoin:${addr}${params.length ? '?' + params.join('&') : ''}`;
}

/** Receive coins page with QR code and address generation */
export const Receive: React.FC = () => {
  const [address, setAddress] = useState('');
  const [addressLabel, setAddressLabel] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // BIP21 optional payment request fields
  const [reqAmount, setReqAmount] = useState('');
  const [reqLabel, setReqLabel] = useState('');
  const [reqMessage, setReqMessage] = useState('');

  const { showToast } = useToast();

  const bip21Uri = useMemo(
    () => (address ? buildBip21Uri(address, { amount: reqAmount, label: reqLabel, message: reqMessage }) : ''),
    [address, reqAmount, reqLabel, reqMessage]
  );

  const handleGenerateAddress = async () => {
    setGenerating(true);
    setError(null);
    try {
      const addr = await walletService.createAddress(addressLabel || undefined);
      setAddress(addr);
      showToast('Address generated successfully', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate address';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      showToast('Address copied to clipboard', 'success');
    }
  };

  const handleCopyUri = () => {
    if (bip21Uri) {
      navigator.clipboard.writeText(bip21Uri);
      showToast('Payment URI copied to clipboard', 'success');
    }
  };

  const handleReset = () => {
    setAddress('');
    setAddressLabel('');
    setReqAmount('');
    setReqLabel('');
    setReqMessage('');
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-xl font-bold text-gray-900 dark:text-dark-text md:text-2xl">Receive</h1>

      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
        {!address ? (
          <div className="space-y-4 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-300 dark:text-dark-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            <p className="text-gray-600 dark:text-dark-mutedText">
              Generate a new address to receive PHI or assets.
            </p>
            <input
              type="text"
              placeholder="Label (optional)"
              className="mx-auto block w-64 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary dark:text-dark-text"
              value={addressLabel}
              onChange={(e) => setAddressLabel(e.target.value)}
            />
            <Button onClick={handleGenerateAddress} disabled={generating} loading={generating}>
              Generate Address
            </Button>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
        ) : (
          <div className="space-y-5">
            {/* QR code */}
            <div className="flex flex-col items-center space-y-3">
              <div className="rounded-lg border-2 border-gray-200 dark:border-dark-muted bg-white p-3">
                <QRCodeSVG value={bip21Uri} size={192} />
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 dark:text-dark-mutedText">Your Address</p>
                <p className="mt-0.5 break-all font-mono text-sm font-semibold text-gray-800 dark:text-dark-secondary">
                  {address}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleCopyAddress}>
                  Copy Address
                </Button>
                <Button variant="secondary" size="sm" onClick={handleCopyUri}>
                  Copy URI
                </Button>
                <Button variant="secondary" size="sm" onClick={handleReset}>
                  New Address
                </Button>
              </div>
            </div>

            {/* Payment request fields */}
            <div className="rounded-md border border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-elevated p-4 space-y-3">
              <p className="text-xs font-medium text-gray-500 dark:text-dark-mutedText uppercase tracking-wide">
                Payment Request (optional)
              </p>
              <div>
                <label className="block text-xs text-gray-600 dark:text-dark-mutedText mb-1">
                  Amount (PHI)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.00000001"
                  placeholder="0.00000000"
                  className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-surface px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary dark:text-dark-text"
                  value={reqAmount}
                  onChange={(e) => setReqAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-dark-mutedText mb-1">
                  Label
                </label>
                <input
                  type="text"
                  placeholder="e.g. Coffee payment"
                  className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-surface px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary dark:text-dark-text"
                  value={reqLabel}
                  onChange={(e) => setReqLabel(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-dark-mutedText mb-1">
                  Message
                </label>
                <input
                  type="text"
                  placeholder="e.g. Order #1234"
                  className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-surface px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary dark:text-dark-text"
                  value={reqMessage}
                  onChange={(e) => setReqMessage(e.target.value)}
                />
              </div>
              {bip21Uri !== `phicoin:${address}` && (
                <div className="mt-1 break-all rounded bg-white dark:bg-dark-surface border border-gray-200 dark:border-dark-border px-2 py-1.5 font-mono text-xs text-gray-500 dark:text-dark-mutedText">
                  {bip21Uri}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Receive;
