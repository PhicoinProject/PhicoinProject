import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMyAssets } from '@/hooks';
import { assetService } from '@/services/assets';
import { isValidPHICoinAddress } from '@/services/addressDerivation';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/common/Badge';
import type { Asset } from '@/types';

/**
 * Normalize a qualifier name to its canonical `#NAME` form. PHICOIN qualifier
 * assets are always prefixed with `#`; we tolerate the user typing the bare
 * name and add the prefix so valid input is never rejected.
 */
function normalizeQualifierName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

/**
 * Normalize a restricted-asset name to its canonical `$NAME` form. Restricted
 * assets are always prefixed with `$`; we tolerate the bare name and add the
 * prefix so valid input is never rejected.
 */
function normalizeRestrictedName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('$') ? trimmed : `$${trimmed}`;
}

type ModalMode =
  | 'none'
  | 'reissue'
  | 'assign-qualifier'
  | 'remove-qualifier'
  | 'freeze'
  | 'unfreeze'
  | 'global-freeze'
  | 'global-unfreeze'
  | 'set-verifier';

interface ReissueForm {
  assetName: string;
  quantity: string;
  decimalPlaces: string;
  reissuable: boolean;
  ipfsHash: string;
  isIPFS: boolean;
}

interface AdminForm {
  targetAddress: string;
  qualifierAsset: string;
  verifierString: string;
  assetName: string;
}

const initialReissueForm: ReissueForm = {
  assetName: '',
  quantity: '0',
  decimalPlaces: '8',
  reissuable: false,
  ipfsHash: '',
  isIPFS: false,
};

const initialAdminForm: AdminForm = {
  targetAddress: '',
  qualifierAsset: '',
  verifierString: '',
  assetName: '',
};

/** Manage Assets page — reissue supply, admin operations (qualifiers, freezes, verifier strings) */
export const ManageAssets: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<'my-assets' | 'admin'>('my-assets');
  const [modalMode, setModalMode] = useState<ModalMode>('none');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successTxid, setSuccessTxid] = useState<string | null>(null);

  // Reissue form
  const [reissueForm, setReissueForm] = useState<ReissueForm>(initialReissueForm);

  // Admin form
  const [adminForm, setAdminForm] = useState<AdminForm>(initialAdminForm);

  // Confirmation gate for destructive global operations (global freeze/unfreeze)
  const [globalConfirmed, setGlobalConfirmed] = useState(false);

  const { data: assets, isLoading } = useMyAssets();

  const refreshAssets = async () => {
    await queryClient.invalidateQueries({ queryKey: ['myAssets'] });
  };

  // ---- Reissue ----
  const openReissue = (asset: Asset) => {
    setReissueForm({
      assetName: asset.assetLabel,
      quantity: '0',
      decimalPlaces: String(asset.precision ?? 8),
      reissuable: false,
      ipfsHash: '',
      isIPFS: false,
    });
    setModalMode('reissue');
    setError(null);
    setSuccessTxid(null);
  };

  const handleReissue = async () => {
    if (!reissueForm.assetName.trim()) {
      setError('Asset name is required');
      return;
    }
    const qty = parseFloat(reissueForm.quantity);
    if (isNaN(qty) || qty <= 0) {
      setError('Quantity must be greater than 0');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const txid = await assetService.reissueAsset({
        name: reissueForm.assetName.trim(),
        quantity: qty,
        decimalPlaces: parseInt(reissueForm.decimalPlaces, 10),
        reissuable: reissueForm.reissuable,
        ipfsHash: reissueForm.isIPFS ? reissueForm.ipfsHash : undefined,
      });
      setSuccessTxid(txid);
      await refreshAssets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reissue asset');
    } finally {
      setProcessing(false);
    }
  };

  // ---- Admin Operations ----
  const openAdminModal = (mode: ModalMode, asset?: Asset) => {
    setModalMode(mode);
    setAdminForm({
      ...initialAdminForm,
      assetName: asset?.assetLabel ?? initialAdminForm.assetName,
    });
    setGlobalConfirmed(false);
    setError(null);
    setSuccessTxid(null);
  };

  const handleAdminAction = async () => {
    setProcessing(true);
    setError(null);

    try {
      let txid: string;

      switch (modalMode) {
        case 'assign-qualifier':
        case 'remove-qualifier': {
          const qualifier = normalizeQualifierName(adminForm.qualifierAsset);
          if (!qualifier) {
            throw new Error('Qualifier asset is required');
          }
          if (!adminForm.targetAddress.trim()) {
            throw new Error('Target address is required');
          }
          if (!isValidPHICoinAddress(adminForm.targetAddress.trim())) {
            throw new Error(
              'Invalid PHICOIN address — failed the Base58Check checksum / version check.'
            );
          }
          txid =
            modalMode === 'assign-qualifier'
              ? await assetService.assignQualifier(qualifier, adminForm.targetAddress.trim())
              : await assetService.removeQualifier(qualifier, adminForm.targetAddress.trim());
          break;
        }

        case 'freeze':
        case 'unfreeze': {
          const restricted = normalizeRestrictedName(adminForm.assetName);
          if (!restricted) {
            throw new Error('Restricted asset name is required');
          }
          if (!adminForm.targetAddress.trim()) {
            throw new Error('Target address is required');
          }
          if (!isValidPHICoinAddress(adminForm.targetAddress.trim())) {
            throw new Error(
              'Invalid PHICOIN address — failed the Base58Check checksum / version check.'
            );
          }
          txid =
            modalMode === 'freeze'
              ? await assetService.freezeAddress(restricted, adminForm.targetAddress.trim())
              : await assetService.unfreezeAddress(restricted, adminForm.targetAddress.trim());
          break;
        }

        case 'global-freeze':
        case 'global-unfreeze': {
          const restricted = normalizeRestrictedName(adminForm.assetName);
          if (!restricted) {
            throw new Error('Restricted asset name is required');
          }
          if (!globalConfirmed) {
            throw new Error('Please confirm this global operation before continuing.');
          }
          txid =
            modalMode === 'global-freeze'
              ? await assetService.globalFreeze(restricted)
              : await assetService.globalUnfreeze(restricted);
          break;
        }

        case 'set-verifier': {
          const restricted = normalizeRestrictedName(adminForm.assetName);
          if (!restricted) {
            throw new Error('Restricted asset name is required');
          }
          if (!adminForm.verifierString.trim()) {
            throw new Error('Verifier string is required');
          }
          txid = await assetService.setVerifierString(restricted, adminForm.verifierString.trim());
          break;
        }

        default:
          throw new Error('Unknown operation');
      }

      setSuccessTxid(txid);
      await refreshAssets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setProcessing(false);
    }
  };

  const closeModal = () => {
    setModalMode('none');
    setError(null);
    setSuccessTxid(null);
    setReissueForm(initialReissueForm);
    setAdminForm(initialAdminForm);
    setGlobalConfirmed(false);
  };

  const modalTitle = (() => {
    switch (modalMode) {
      case 'reissue':
        return 'Reissue Asset';
      case 'assign-qualifier':
        return 'Assign Qualifier';
      case 'remove-qualifier':
        return 'Remove Qualifier';
      case 'freeze':
        return 'Freeze Address';
      case 'unfreeze':
        return 'Unfreeze Address';
      case 'global-freeze':
        return 'Global Freeze';
      case 'global-unfreeze':
        return 'Global Unfreeze';
      case 'set-verifier':
        return 'Set Verifier String';
      default:
        return '';
    }
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">Manage Assets</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-dark-mutedText">
          Reissue supply, manage qualifiers, freeze/unfreeze restricted assets
        </p>
      </div>

      {/* Section Tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-200 dark:bg-dark-elevated p-1">
        {[
          { key: 'my-assets' as const, label: 'My Assets' },
          { key: 'admin' as const, label: 'Admin Operations' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSection(tab.key)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeSection === tab.key
                ? 'bg-white dark:bg-dark-muted text-gray-900 dark:text-dark-text shadow-sm'
                : 'text-gray-600 dark:text-dark-mutedText hover:text-gray-900 dark:hover:text-dark-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* My Assets with Reissue */}
      {activeSection === 'my-assets' && (
        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface shadow-sm">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner />
            </div>
          ) : !assets || assets.length === 0 ? (
            <p className="p-6 text-sm text-gray-500 dark:text-dark-mutedText">
              No assets to manage. Issue an asset first.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-gray-50 dark:bg-dark-elevated text-gray-500 dark:text-dark-mutedText">
                  <tr>
                    <th className="px-4 py-3 font-medium">Asset</th>
                    <th className="px-4 py-3 font-medium">Balance</th>
                    <th className="px-4 py-3 font-medium">Precision</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset: Asset, i: number) => (
                    <tr
                      key={asset.assetId}
                      className={`border-b ${i % 2 === 0 ? 'bg-white dark:bg-dark-surface' : 'bg-gray-50 dark:bg-dark-elevated'}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 dark:text-dark-text">
                          {asset.assetLabel}
                        </div>
                        <div className="font-mono text-xs text-gray-500 dark:text-dark-mutedText">
                          {asset.assetId.slice(0, 16)}...
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-dark-text">
                        {asset.previousAmount}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="default">{asset.precision}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="secondary" size="sm" onClick={() => openReissue(asset)}>
                          Reissue
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Admin Operations */}
      {activeSection === 'admin' && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Qualifier Management */}
          <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary mb-4">
              Qualifier Management
            </h2>
            <div className="space-y-3">
              <Button
                variant="primary"
                onClick={() => openAdminModal('assign-qualifier')}
                className="w-full"
              >
                Assign Qualifier to Address
              </Button>
              <Button
                variant="secondary"
                onClick={() => openAdminModal('remove-qualifier')}
                className="w-full"
              >
                Remove Qualifier from Address
              </Button>
            </div>
          </div>

          {/* Restricted Asset Operations */}
          <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary mb-4">
              Restricted Asset Operations
            </h2>
            <div className="space-y-3">
              <Button
                variant="secondary"
                onClick={() => openAdminModal('freeze')}
                className="w-full"
              >
                Freeze Address
              </Button>
              <Button
                variant="secondary"
                onClick={() => openAdminModal('unfreeze')}
                className="w-full"
              >
                Unfreeze Address
              </Button>
              <Button
                variant="primary"
                onClick={() => openAdminModal('global-freeze')}
                className="w-full"
              >
                Global Freeze
              </Button>
              <Button
                variant="primary"
                onClick={() => openAdminModal('global-unfreeze')}
                className="w-full"
              >
                Global Unfreeze
              </Button>
            </div>
          </div>

          {/* Verifier String */}
          <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm md:col-span-2">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary mb-4">
              Verifier String
            </h2>
            <Button
              variant="secondary"
              onClick={() => openAdminModal('set-verifier')}
              className="w-full"
            >
              Set Verifier String
            </Button>
          </div>
        </div>
      )}

      {/* Universal Modal */}
      <Modal isOpen={modalMode !== 'none'} onClose={closeModal} title={modalTitle}>
        <div className="space-y-4">
          {successTxid ? (
            <div className="text-center py-6">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <svg
                  className="h-6 w-6 text-green-600 dark:text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-dark-text">
                Operation Successful
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-dark-mutedText">
                Transaction ID: <span className="font-mono">{successTxid}</span>
              </p>
              <Button variant="primary" onClick={closeModal} className="mt-4">
                Done
              </Button>
            </div>
          ) : (
            <>
              {/* Reissue Form */}
              {modalMode === 'reissue' && (
                <>
                  <Input
                    id="reissue-name"
                    label="Asset Name"
                    value={reissueForm.assetName}
                    onChange={(e) => setReissueForm({ ...reissueForm, assetName: e.target.value })}
                  />
                  <Input
                    id="reissue-quantity"
                    label="Additional Quantity"
                    type="number"
                    min="0"
                    step="any"
                    value={reissueForm.quantity}
                    onChange={(e) => setReissueForm({ ...reissueForm, quantity: e.target.value })}
                  />
                  <Input
                    id="reissue-decimals"
                    label="Decimal Places"
                    type="number"
                    min="0"
                    max="8"
                    value={reissueForm.decimalPlaces}
                    onChange={(e) =>
                      setReissueForm({ ...reissueForm, decimalPlaces: e.target.value })
                    }
                  />
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-secondary">
                    <input
                      type="checkbox"
                      checked={reissueForm.reissuable}
                      onChange={(e) =>
                        setReissueForm({ ...reissueForm, reissuable: e.target.checked })
                      }
                      className="rounded border-gray-300 dark:border-dark-muted"
                    />
                    Keep Reissuable
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-secondary">
                    <input
                      type="checkbox"
                      checked={reissueForm.isIPFS}
                      onChange={(e) => setReissueForm({ ...reissueForm, isIPFS: e.target.checked })}
                      className="rounded border-gray-300 dark:border-dark-muted"
                    />
                    Attach IPFS Hash
                  </label>
                  {reissueForm.isIPFS && (
                    <Input
                      id="reissue-ipfs"
                      label="IPFS Hash"
                      value={reissueForm.ipfsHash}
                      onChange={(e) => setReissueForm({ ...reissueForm, ipfsHash: e.target.value })}
                    />
                  )}
                </>
              )}

              {/* Qualifier Forms */}
              {(modalMode === 'assign-qualifier' || modalMode === 'remove-qualifier') && (
                <>
                  <Input
                    id="admin-qualifier"
                    label="Qualifier Asset"
                    placeholder="#QUALIFIER_NAME"
                    value={adminForm.qualifierAsset}
                    onChange={(e) => setAdminForm({ ...adminForm, qualifierAsset: e.target.value })}
                  />
                  <p className="text-xs text-gray-500 dark:text-dark-mutedText">
                    Qualifier assets are prefixed with <span className="font-mono">#</span>. The
                    prefix is added automatically if omitted.
                  </p>
                  <Input
                    id="admin-target"
                    label="Target Address"
                    placeholder="P..."
                    value={adminForm.targetAddress}
                    onChange={(e) => setAdminForm({ ...adminForm, targetAddress: e.target.value })}
                  />
                </>
              )}

              {/* Freeze/Unfreeze Forms */}
              {(modalMode === 'freeze' || modalMode === 'unfreeze') && (
                <>
                  <Input
                    id="admin-asset"
                    label="Restricted Asset Name"
                    placeholder="$RESTRICTED_NAME"
                    value={adminForm.assetName}
                    onChange={(e) => setAdminForm({ ...adminForm, assetName: e.target.value })}
                  />
                  <p className="text-xs text-gray-500 dark:text-dark-mutedText">
                    Restricted assets are prefixed with <span className="font-mono">$</span>. The
                    prefix is added automatically if omitted.
                  </p>
                  <Input
                    id="admin-target-freeze"
                    label="Target Address"
                    placeholder="P..."
                    value={adminForm.targetAddress}
                    onChange={(e) => setAdminForm({ ...adminForm, targetAddress: e.target.value })}
                  />
                </>
              )}

              {/* Global Freeze/Unfreeze */}
              {(modalMode === 'global-freeze' || modalMode === 'global-unfreeze') && (
                <>
                  <Input
                    id="admin-asset-global"
                    label="Restricted Asset Name"
                    placeholder="$RESTRICTED_NAME"
                    value={adminForm.assetName}
                    onChange={(e) => setAdminForm({ ...adminForm, assetName: e.target.value })}
                  />
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    This will {modalMode === 'global-freeze' ? 'freeze' : 'unfreeze'} all transfers
                    of this restricted asset globally. Restricted assets are prefixed with{' '}
                    <span className="font-mono">$</span>; the prefix is added automatically if
                    omitted.
                  </p>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-secondary">
                    <input
                      type="checkbox"
                      checked={globalConfirmed}
                      onChange={(e) => setGlobalConfirmed(e.target.checked)}
                      className="rounded border-gray-300 dark:border-dark-muted"
                    />
                    I understand this affects every holder of this asset
                  </label>
                </>
              )}

              {/* Verifier String */}
              {modalMode === 'set-verifier' && (
                <>
                  <Input
                    id="admin-asset-verifier"
                    label="Restricted Asset Name"
                    placeholder="$RESTRICTED_NAME"
                    value={adminForm.assetName}
                    onChange={(e) => setAdminForm({ ...adminForm, assetName: e.target.value })}
                  />
                  <p className="text-xs text-gray-500 dark:text-dark-mutedText">
                    Restricted assets are prefixed with <span className="font-mono">$</span>. The
                    prefix is added automatically if omitted.
                  </p>
                  <Input
                    id="admin-verifier"
                    label="Verifier String"
                    placeholder="Verifier string for restricted transfers"
                    value={adminForm.verifierString}
                    onChange={(e) => setAdminForm({ ...adminForm, verifierString: e.target.value })}
                  />
                </>
              )}

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={closeModal} disabled={processing}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={modalMode === 'reissue' ? handleReissue : handleAdminAction}
                  loading={processing}
                  disabled={
                    (modalMode === 'global-freeze' || modalMode === 'global-unfreeze') &&
                    !globalConfirmed
                  }
                >
                  {processing ? (
                    <Spinner size="sm" />
                  ) : modalMode === 'reissue' ? (
                    'Reissue'
                  ) : (
                    'Confirm'
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default ManageAssets;
