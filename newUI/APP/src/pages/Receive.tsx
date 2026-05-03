import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { walletService } from '@/services/wallet';
import { Button } from '@/components/common/Button';
import { useToast } from '@/components/common/Toast';

/** Receive coins page with QR code and address generation */
export const Receive: React.FC = () => {
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const handleGenerateAddress = async () => {
    setGenerating(true);
    setError(null);
    try {
      const addr = await walletService.createAddress(label || undefined);
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

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      showToast('Address copied to clipboard', 'success');
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-xl font-bold text-gray-900 dark:text-dark-text md:text-2xl">Receive</h1>

      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 text-center shadow-sm">
        {!address ? (
          <div className="space-y-4">
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
              className="mx-auto w-64 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Button onClick={handleGenerateAddress} disabled={generating} loading={generating}>
              Generate Address
            </Button>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-dark-muted">
              <QRCodeSVG value={address} size={160} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-dark-mutedText">Your Address</p>
              <p className="mt-1 break-all font-mono text-sm font-semibold text-gray-800 dark:text-dark-secondary">
                {address}
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="secondary" onClick={handleCopy}>
                Copy
              </Button>
              <Button variant="secondary" onClick={() => setAddress('')}>
                New Address
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Receive;
