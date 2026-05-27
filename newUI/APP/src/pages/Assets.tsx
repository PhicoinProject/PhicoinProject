import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMyAssets } from '@/hooks';
import { assetService } from '@/services/assets';
import { walletService } from '@/services/wallet';
import { isValidPHICoinAddress } from '@/services/addressDerivation';
import type { Asset } from '@/types';
import { AssetTable, AssetIssuer } from '@/components/assets';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/common/Badge';
import { useToast } from '@/components/common/Toast';
import { ASSET_STATUS_ISSUED, ASSET_STATUS_REVOKED } from '@/utils/constants';

function getStatusBadgeVariant(status: string): 'success' | 'error' | 'default' {
  if (status === ASSET_STATUS_ISSUED) return 'success';
  if (status === ASSET_STATUS_REVOKED) return 'error';
  return 'default';
}

interface SendAssetForm {
  toAddress: string;
  amount: string;
  message: string;
}

/** Asset browser page with send/receive for each asset */
export const Assets: React.FC = () => {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  // Send modal state
  const [sendOpen, setSendOpen] = useState(false);
  const [sendAsset, setSendAsset] = useState<Asset | null>(null);
  const [sendForm, setSendForm] = useState<SendAssetForm>({
    toAddress: '',
    amount: '',
    message: '',
  });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Receive modal state
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveAsset, setReceiveAsset] = useState<Asset | null>(null);
  const [receiveAddr, setReceiveAddr] = useState<string | null>(null);
  const [receiveLoading, setReceiveLoading] = useState(false);

  const { data: assets, isLoading } = useMyAssets();

  // Derive address pool for asset address lookups
  const addressList = (() => {
    try {
      return walletService.getDerivedAddressPool().map((a) => a.address);
    } catch {
      return [];
    }
  })();

  const filteredAssets = (assets ?? []).filter((a: Asset) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return a.assetLabel.toLowerCase().includes(s) || a.assetId.toLowerCase().includes(s);
  });

  const handleIssued = (txid: string) => {
    showToast(`Asset issued: ${txid.slice(0, 16)}…`, 'success');
    queryClient.invalidateQueries({ queryKey: ['myAssets'] });
  };

  const handleSendClick = (asset: Asset) => {
    setSendAsset(asset);
    setSendForm({ toAddress: '', amount: '', message: '' });
    setSendError(null);
    setSendOpen(true);
  };

  const handleSendSubmit = async () => {
    if (!sendAsset || !sendForm.toAddress || !sendForm.amount) {
      setSendError('Address and amount are required');
      return;
    }
    if (!isValidPHICoinAddress(sendForm.toAddress.trim())) {
      setSendError('Invalid PHICOIN address — failed the Base58Check checksum / version check.');
      return;
    }
    const qty = parseFloat(sendForm.amount);
    if (isNaN(qty) || qty <= 0) {
      setSendError('Amount must be greater than 0');
      return;
    }
    const currentRaw = sendAsset.previousAmount ?? 0;
    if (qty > currentRaw) {
      const precision = sendAsset.precision ?? 8;
      setSendError(`Insufficient balance. You have ${currentRaw.toFixed(precision)} ${sendAsset.assetLabel}`);
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const txid = await assetService.transferAsset(
        sendAsset.assetId,
        qty,
        sendForm.toAddress.trim(),
        sendForm.message || undefined
      );
      showToast(`Sent ${qty} ${sendAsset.assetLabel} (${txid.slice(0, 12)}…)`, 'success');
      setSendOpen(false);
      setSendAsset(null);
      await queryClient.invalidateQueries({ queryKey: ['myAssets'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send asset';
      setSendError(msg);
      showToast(msg, 'error');
    } finally {
      setSending(false);
    }
  };

  const handleReceiveClick = async (asset: Asset) => {
    setReceiveAsset(asset);
    setReceiveAddr(null);
    setReceiveLoading(true);
    setReceiveOpen(true);
    try {
      const addr = await assetService.getAssetAddress(asset.assetId, addressList);
      setReceiveAddr(addr);
    } catch {
      setReceiveAddr('Use any wallet address to receive this asset.');
    } finally {
      setReceiveLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">Assets</h1>
        <AssetIssuer onIssued={handleIssued} />
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by label or asset ID..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
      />

      {/* Selected asset detail */}
      {selectedAsset && (
        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
              {selectedAsset.assetLabel}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSendClick(selectedAsset)}
                disabled={selectedAsset.isOwner}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-white bg-phi-primary hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={selectedAsset.isOwner ? 'Owner tokens cannot be transferred' : ''}
              >
                Send
              </button>
              <button
                onClick={() => handleReceiveClick(selectedAsset)}
                className="rounded-md border border-gray-300 dark:border-dark-muted px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-elevated"
              >
                Receive
              </button>
              <button
                onClick={() => setSelectedAsset(null)}
                className="text-sm text-gray-500 dark:text-dark-mutedText hover:underline"
              >
                Back
              </button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
            <div>
              <span className="text-gray-500 dark:text-dark-mutedText">Asset ID:</span>{' '}
              <span className="ml-2 font-mono text-gray-800 dark:text-dark-secondary">
                {selectedAsset.assetId}
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-dark-mutedText">Status:</span>{' '}
              <span className="ml-2">
                <Badge variant={getStatusBadgeVariant(selectedAsset.status)}>
                  {selectedAsset.status}
                </Badge>
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-dark-mutedText">Precision:</span>{' '}
              <span className="ml-2 text-gray-800 dark:text-dark-secondary">
                {selectedAsset.precision}
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-dark-mutedText">Amount:</span>{' '}
              <span className="ml-2 text-gray-800 dark:text-dark-secondary">
                {selectedAsset.previousAmount}
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-dark-mutedText">Transactions:</span>{' '}
              <span className="ml-2 text-gray-800 dark:text-dark-secondary">
                {selectedAsset.previousTransactions}
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-dark-mutedText">Nonce:</span>{' '}
              <span className="ml-2 text-gray-800 dark:text-dark-secondary">
                {selectedAsset.nonce}
              </span>
            </div>
            {selectedAsset.ipfsHash && (
              <div>
                <span className="text-gray-500 dark:text-dark-mutedText">IPFS:</span>{' '}
                <span className="ml-2 font-mono text-xs text-gray-800 dark:text-dark-secondary">
                  {selectedAsset.ipfsHash}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Asset list */}
      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface shadow-sm">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        ) : filteredAssets.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 dark:text-dark-mutedText">No assets found.</p>
        ) : (
          <AssetTable assets={filteredAssets} onClick={(asset) => setSelectedAsset(asset)} />
        )}
      </div>

      {/* Send Asset Modal */}
      <Modal
        isOpen={sendOpen}
        onClose={() => {
          setSendOpen(false);
          setSendAsset(null);
        }}
        title={`Send ${sendAsset?.assetLabel || 'Asset'}`}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-dark-secondary">
              Recipient Address
            </label>
            <input
              type="text"
              required
              placeholder="P..."
              className="mt-1 w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
              value={sendForm.toAddress}
              onChange={(e) => setSendForm({ ...sendForm, toAddress: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-dark-secondary">
              Amount
            </label>
            <input
              type="number"
              required
              min="0.00000001"
              step="any"
              placeholder="0.00"
              className="mt-1 w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
              value={sendForm.amount}
              onChange={(e) => setSendForm({ ...sendForm, amount: e.target.value })}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-dark-mutedText">
              Available: {(() => {
                const precision = sendAsset?.precision ?? 8;
                const amt = sendAsset?.previousAmount ?? 0;
                return `${amt.toFixed(precision)} ${sendAsset?.assetLabel}`;
              })()}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-dark-secondary">
              Message (optional)
            </label>
            <input
              type="text"
              placeholder="Memo for this transfer"
              className="mt-1 w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
              value={sendForm.message}
              onChange={(e) => setSendForm({ ...sendForm, message: e.target.value })}
            />
          </div>
          {sendError && <p className="text-sm text-red-600 dark:text-red-400">{sendError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setSendOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSendSubmit} loading={sending}>
              Send
            </Button>
          </div>
        </div>
      </Modal>

      {/* Receive Asset Modal */}
      <Modal
        isOpen={receiveOpen}
        onClose={() => {
          setReceiveOpen(false);
          setReceiveAsset(null);
        }}
        title={`Receive ${receiveAsset?.assetLabel || 'Asset'}`}
      >
        <div className="space-y-4">
          {receiveLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          ) : receiveAddr ? (
            <>
              <p className="text-sm text-gray-600 dark:text-dark-mutedText">
                Send {receiveAsset?.assetLabel} to this address:
              </p>
              <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-elevated p-4">
                <p className="break-all font-mono text-sm font-semibold text-gray-800 dark:text-dark-secondary">
                  {receiveAddr}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(receiveAddr);
                    showToast('Address copied to clipboard', 'success');
                  }}
                >
                  Copy Address
                </Button>
                <Button variant="primary" onClick={() => setReceiveOpen(false)}>
                  Close
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-dark-mutedText">
              Could not load receive address.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
};
