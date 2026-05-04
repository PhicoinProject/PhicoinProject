import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { assetService } from '@/services/assets';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { AssetType } from '@/services/assetSerialization';

type AssetTypeKey = 'ROOT' | 'SUB' | 'UNIQUE' | 'QUALIFIER' | 'RESTRICTED';

interface IssueForm {
  assetType: AssetTypeKey;
  label: string;
  quantity: string;
  decimalPlaces: string;
  parentAsset: string;
  verifierString: string;
  isReissuable: boolean;
  isIPFS: boolean;
  ipfsHash: string;
}

const initialForm: IssueForm = {
  assetType: 'ROOT',
  label: '',
  quantity: '0',
  decimalPlaces: '8',
  parentAsset: '',
  verifierString: '',
  isReissuable: false,
  isIPFS: false,
  ipfsHash: '',
};

const ASSET_TYPES: { key: AssetTypeKey; label: string; description: string }[] = [
  { key: 'ROOT', label: 'ROOT', description: 'Standard fungible token' },
  { key: 'SUB', label: 'SUB', description: 'Sub-asset of an existing ROOT' },
  { key: 'UNIQUE', label: 'UNIQUE', description: 'Non-fungible unique asset (NFT)' },
  { key: 'QUALIFIER', label: 'QUALIFIER', description: 'Qualifier for restricted assets' },
  { key: 'RESTRICTED', label: 'RESTRICTED', description: 'Restricted transfer asset' },
];

/** Create Asset page — issue all asset types (ROOT/SUB/UNIQUE/QUALIFIER/RESTRICTED) */
export const CreateAsset: React.FC = () => {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<IssueForm>(initialForm);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);

  const updateField = <K extends keyof IssueForm>(key: K, value: IssueForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  const handleTypeSelect = (type: AssetTypeKey) => {
    setForm((prev) => ({
      ...prev,
      assetType: type,
      // Reset quantity for UNIQUE assets
      quantity: type === 'UNIQUE' ? '1' : prev.quantity,
    }));
    setError(null);
  };

  const handleSubmit = async () => {
    if (!form.label.trim()) {
      setError('Asset label is required');
      return;
    }
    if (form.label.trim().length > 31) {
      setError('Asset label must be 31 characters or fewer');
      return;
    }

    const quantity = parseFloat(form.quantity);
    if (isNaN(quantity) || quantity < 0) {
      setError('Quantity must be a non-negative number');
      return;
    }

    const decimalPlaces = parseInt(form.decimalPlaces, 10);
    if (isNaN(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 8) {
      setError('Decimal places must be between 0 and 8');
      return;
    }

    setIssuing(true);
    setError(null);

    try {
      const txid = await assetService.issueAsset({
        label: form.label.trim(),
        quantity,
        decimalPlaces,
        isRevokeable: form.isReissuable,
        isIPFS: form.isIPFS,
        ipfsHash: form.isIPFS && form.ipfsHash ? form.ipfsHash : undefined,
      });

      setTxid(txid);
      await queryClient.invalidateQueries({ queryKey: ['myAssets'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue asset');
    } finally {
      setIssuing(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setForm(initialForm);
    setError(null);
    setTxid(null);
  };

  const selectedType = ASSET_TYPES.find((t) => t.key === form.assetType);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">Create Asset</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-dark-mutedText">
            Issue a new asset on the PHICOIN blockchain
          </p>
        </div>
        <Button variant="primary" onClick={() => setIsOpen(true)}>
          Create New Asset
        </Button>
      </div>

      {/* Asset Type Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {ASSET_TYPES.map((type) => (
          <button
            key={type.key}
            onClick={() => handleTypeSelect(type.key)}
            className={`rounded-lg border p-4 text-left transition-all hover:shadow-md ${
              form.assetType === type.key
                ? 'border-phi-primary bg-phi-primary/5 dark:bg-phi-primary/10'
                : 'border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface hover:border-gray-300 dark:hover:border-dark-muted'
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-dark-text">{type.label}</h3>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                  form.assetType === type.key
                    ? 'bg-phi-primary/10 text-phi-primary'
                    : 'bg-gray-100 dark:bg-dark-elevated text-gray-600 dark:text-dark-mutedText'
                }`}
              >
                Type {AssetType[type.key]}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-dark-mutedText">{type.description}</p>
          </button>
        ))}
      </div>

      {/* Selected Type Details */}
      {selectedType && (
        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
            {selectedType.label} Asset Details
          </h2>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-dark-mutedText">Type Value:</span>
              <span className="font-mono text-gray-900 dark:text-dark-text">
                {AssetType[selectedType.key]}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-dark-mutedText">Description:</span>
              <span className="text-gray-900 dark:text-dark-text">{selectedType.description}</span>
            </div>
            {selectedType.key === 'SUB' && (
              <p className="text-amber-600 dark:text-amber-400 mt-2">
                Sub-assets require an existing ROOT asset. Use the CLI to specify the parent asset.
              </p>
            )}
            {selectedType.key === 'UNIQUE' && (
              <p className="text-blue-600 dark:text-amber-400 mt-2">
                Unique assets are non-fungible (quantity always 1). They support IPFS hash attachment for metadata.
              </p>
            )}
            {selectedType.key === 'QUALIFIER' && (
              <p className="text-purple-600 dark:text-purple-400 mt-2">
                Qualifiers are used to restrict transfers of restricted assets. Assign qualifiers to addresses via the Restricted page.
              </p>
            )}
            {selectedType.key === 'RESTRICTED' && (
              <p className="text-red-600 dark:text-red-400 mt-2">
                Restricted assets have transfer limitations controlled by the issuer. Use verifier strings to define transfer conditions.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Create Asset Modal */}
      <Modal isOpen={isOpen} onClose={handleClose} title="Create New Asset">
        <div className="space-y-4">
          {txid ? (
            <div className="text-center py-6">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <svg className="h-6 w-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-dark-text">
                Asset Created Successfully
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-dark-mutedText">
                Transaction ID:{' '}
                <span className="font-mono">{txid}</span>
              </p>
              <Button variant="primary" onClick={handleClose} className="mt-4">
                Done
              </Button>
            </div>
          ) : (
            <>
              {/* Asset Type Selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-dark-secondary mb-2">
                  Asset Type
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {ASSET_TYPES.map((type) => (
                    <button
                      key={type.key}
                      type="button"
                      onClick={() => handleTypeSelect(type.key)}
                      className={`rounded-md px-2 py-2 text-xs font-medium transition-colors ${
                        form.assetType === type.key
                          ? 'bg-phi-primary text-white'
                          : 'bg-gray-100 dark:bg-dark-elevated text-gray-700 dark:text-dark-secondary hover:bg-gray-200 dark:hover:bg-dark-muted'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              <Input
                id="create-asset-label"
                label="Asset Label"
                placeholder="e.g. MYTOKEN"
                value={form.label}
                onChange={(e) => updateField('label', e.target.value)}
                error={error && !form.label ? error : undefined}
              />

              {form.assetType !== 'UNIQUE' && (
                <Input
                  id="create-asset-quantity"
                  label="Quantity"
                  type="number"
                  min="0"
                  step="any"
                  value={form.quantity}
                  onChange={(e) => updateField('quantity', e.target.value)}
                />
              )}

              <Input
                id="create-asset-decimals"
                label="Decimal Places"
                type="number"
                min="0"
                max="8"
                value={form.decimalPlaces}
                onChange={(e) => updateField('decimalPlaces', e.target.value)}
              />

              {form.assetType === 'RESTRICTED' && (
                <Input
                  id="create-asset-verifier"
                  label="Verifier String"
                  placeholder="Verifier string for restricted transfers"
                  value={form.verifierString}
                  onChange={(e) => updateField('verifierString', e.target.value)}
                />
              )}

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-secondary">
                  <input
                    type="checkbox"
                    checked={form.isReissuable}
                    onChange={(e) => updateField('isReissuable', e.target.checked)}
                    className="rounded border-gray-300 dark:border-dark-muted"
                  />
                  Reissuable (can increase supply later)
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-secondary">
                  <input
                    type="checkbox"
                    checked={form.isIPFS}
                    onChange={(e) => updateField('isIPFS', e.target.checked)}
                    className="rounded border-gray-300 dark:border-dark-muted"
                  />
                  Attach IPFS Hash
                </label>
              </div>

              {form.isIPFS && (
                <Input
                  id="create-asset-ipfs"
                  label="IPFS Hash"
                  placeholder="Qm..."
                  value={form.ipfsHash}
                  onChange={(e) => updateField('ipfsHash', e.target.value)}
                />
              )}

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={handleClose} disabled={issuing}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleSubmit} loading={issuing}>
                  {issuing ? <Spinner size="sm" /> : `Issue ${form.assetType} Asset`}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};
