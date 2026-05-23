import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { assetService } from '@/services/assets';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { AssetType } from '@/services/assetSerialization';
import { useMyAssets } from '@/hooks/useMyAssets';

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
  quantity: '1',
  decimalPlaces: '0',
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

// Name-character rules mirrored from src/assets/assets.cpp regexes.
const ROOT_NAME_RE = /^[A-Z]([A-Z0-9-]{1,30}[A-Z0-9])?$/; // 1-31 chars, no leading/trailing/double hyphen handled separately
const SUB_NAME_RE = /^[A-Z0-9]([A-Z0-9-]{0,61}[A-Z0-9])?$/;
const UNIQUE_TAG_RE = /^[-A-Za-z0-9@$%&*()[\]{}?:]+$/;
const QUALIFIER_NAME_RE = /^[A-Z0-9-]{3,}$/; // the part after the leading '#'
const RESTRICTED_NAME_RE = /^[A-Z0-9-]{3,}$/; // the part after the leading '$'
const DOUBLE_HYPHEN_RE = /--/;

/**
 * Whether the selected asset type needs a parent ROOT asset.
 * SUB assets nest under "PARENT/NAME"; UNIQUE assets nest under "PARENT#TAG".
 */
function needsParent(type: AssetTypeKey): boolean {
  return type === 'SUB' || type === 'UNIQUE';
}

/** Whether the quantity field applies (fungible only). */
function hasQuantity(type: AssetTypeKey): boolean {
  // UNIQUE is always 1; QUALIFIER/RESTRICTED are issued at qty 1 by convention.
  return type === 'ROOT' || type === 'SUB' || type === 'RESTRICTED';
}

/** Whether decimal precision applies (fungible divisible only). */
function hasPrecision(type: AssetTypeKey): boolean {
  return type === 'ROOT' || type === 'SUB' || type === 'RESTRICTED';
}

/** Compose the full on-chain asset name from the form parts. */
function composeFullName(form: IssueForm): string {
  const raw = form.label.trim();
  switch (form.assetType) {
    case 'SUB':
      return `${form.parentAsset}/${raw.toUpperCase()}`;
    case 'UNIQUE':
      return `${form.parentAsset}#${raw}`;
    case 'QUALIFIER':
      return `#${raw.toUpperCase()}`;
    case 'RESTRICTED':
      return `$${raw.toUpperCase()}`;
    case 'ROOT':
    default:
      return raw.toUpperCase();
  }
}

/**
 * Validate the form for the selected asset type.
 * Returns an error message, or null when valid.
 */
function validateForm(form: IssueForm): string | null {
  const raw = form.label.trim();
  if (!raw) return 'Asset name is required';

  if (needsParent(form.assetType) && !form.parentAsset) {
    return 'Select a parent asset (you must own its owner token)';
  }

  switch (form.assetType) {
    case 'ROOT': {
      const name = raw.toUpperCase();
      if (name.length < 3 || name.length > 31) return 'ROOT name must be 3-31 characters';
      if (!ROOT_NAME_RE.test(name) || DOUBLE_HYPHEN_RE.test(name)) {
        return 'ROOT name: A-Z, 0-9, single hyphens; must start with a letter';
      }
      break;
    }
    case 'SUB': {
      const name = raw.toUpperCase();
      if (name.length < 1 || name.length > 31) return 'Sub-asset name must be 1-31 characters';
      if (!SUB_NAME_RE.test(name) || DOUBLE_HYPHEN_RE.test(name)) {
        return 'Sub-asset name: A-Z, 0-9, single hyphens';
      }
      break;
    }
    case 'UNIQUE': {
      if (!UNIQUE_TAG_RE.test(raw)) {
        return 'Unique tag: letters, digits and -@$%&*()[]{}?: are allowed';
      }
      break;
    }
    case 'QUALIFIER': {
      const name = raw.toUpperCase();
      if (!QUALIFIER_NAME_RE.test(name) || DOUBLE_HYPHEN_RE.test(name)) {
        return 'Qualifier name: at least 3 characters of A-Z, 0-9, single hyphens';
      }
      break;
    }
    case 'RESTRICTED': {
      const name = raw.toUpperCase();
      if (!RESTRICTED_NAME_RE.test(name) || DOUBLE_HYPHEN_RE.test(name)) {
        return 'Restricted name: at least 3 characters of A-Z, 0-9, single hyphens';
      }
      break;
    }
  }

  if (hasQuantity(form.assetType)) {
    const quantity = parseFloat(form.quantity);
    if (isNaN(quantity) || quantity <= 0) return 'Quantity must be a positive number';
  }

  if (hasPrecision(form.assetType)) {
    const decimals = parseInt(form.decimalPlaces, 10);
    if (isNaN(decimals) || decimals < 0 || decimals > 8) {
      return 'Decimal places must be between 0 and 8';
    }
  }

  if (form.isIPFS && !form.ipfsHash.trim()) {
    return 'Enter an IPFS hash or disable the IPFS option';
  }

  return null;
}

/** Create Asset page — issue all asset types (ROOT/SUB/UNIQUE/QUALIFIER/RESTRICTED) */
export const CreateAsset: React.FC = () => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<IssueForm>(initialForm);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);

  // Owned ROOT assets that can act as a parent for SUB/UNIQUE issuance.
  // The owner token (name ending in "!") proves issuance rights for the ROOT.
  const { data: myAssets } = useMyAssets();
  const ownedRoots = useMemo(() => {
    const roots = (myAssets ?? [])
      .filter((a) => a.isOwner && a.assetId.endsWith('!') && !a.assetId.includes('/'))
      .map((a) => a.assetId.slice(0, -1));
    return Array.from(new Set(roots)).sort();
  }, [myAssets]);

  const updateField = <K extends keyof IssueForm>(key: K, value: IssueForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  const handleTypeSelect = (type: AssetTypeKey) => {
    setForm((prev) => ({
      ...prev,
      assetType: type,
      // UNIQUE is always a single non-divisible token.
      quantity: type === 'UNIQUE' ? '1' : prev.quantity,
      decimalPlaces: hasPrecision(type) ? prev.decimalPlaces : '0',
      // Clear parent when switching to a type that doesn't use one.
      parentAsset: needsParent(type) ? prev.parentAsset : '',
    }));
    setError(null);
  };

  const handleSubmit = async () => {
    const validationError = validateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    const fullName = composeFullName(form);
    const quantity = hasQuantity(form.assetType) ? parseFloat(form.quantity) : 1;
    const decimalPlaces = hasPrecision(form.assetType) ? parseInt(form.decimalPlaces, 10) : 0;

    setIssuing(true);
    setError(null);

    try {
      const newTxid = await assetService.issueAsset({
        label: fullName,
        quantity,
        decimalPlaces,
        isRevokeable: form.isReissuable,
        isIPFS: form.isIPFS,
        ipfsHash: form.isIPFS && form.ipfsHash ? form.ipfsHash.trim() : undefined,
      });

      setTxid(newTxid);
      await queryClient.invalidateQueries({ queryKey: ['myAssets'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue asset');
    } finally {
      setIssuing(false);
    }
  };

  const handleReset = () => {
    setForm(initialForm);
    setError(null);
    setTxid(null);
  };

  const selectedType = ASSET_TYPES.find((t) => t.key === form.assetType);
  const previewName = form.label.trim() ? composeFullName(form) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">Create Asset</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-dark-mutedText">
          Issue a new asset on the PHICOIN blockchain. Select a type to configure its fields.
        </p>
      </div>

      {/* Asset Type Selector */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {ASSET_TYPES.map((type) => (
          <button
            key={type.key}
            type="button"
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

      {/* Asset Configuration Form — rendered inline once a type is selected */}
      {selectedType && (
        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
              {selectedType.label} Asset
            </h2>
            <span className="font-mono text-xs text-gray-500 dark:text-dark-mutedText">
              Type {AssetType[selectedType.key]}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-dark-mutedText">
            {selectedType.description}
          </p>

          <div className="mt-5 space-y-4">
            {/* Parent asset selector (SUB / UNIQUE) */}
            {needsParent(form.assetType) && (
              <div>
                <label
                  htmlFor="create-asset-parent"
                  className="block text-sm font-medium text-gray-700 dark:text-dark-secondary"
                >
                  Parent Asset
                </label>
                <select
                  id="create-asset-parent"
                  value={form.parentAsset}
                  onChange={(e) => updateField('parentAsset', e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                >
                  <option value="">Select a ROOT asset you own…</option>
                  {ownedRoots.map((root) => (
                    <option key={root} value={root}>
                      {root}
                    </option>
                  ))}
                </select>
                {ownedRoots.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    No owner tokens found. You must hold the owner token of a ROOT asset to
                    issue {form.assetType === 'SUB' ? 'sub-assets' : 'unique assets'} under it.
                  </p>
                )}
              </div>
            )}

            {/* Asset name (label) */}
            <Input
              id="create-asset-label"
              label={
                form.assetType === 'SUB'
                  ? 'Sub-asset Name'
                  : form.assetType === 'UNIQUE'
                    ? 'Unique Tag'
                    : form.assetType === 'QUALIFIER'
                      ? 'Qualifier Name'
                      : form.assetType === 'RESTRICTED'
                        ? 'Restricted Name'
                        : 'Asset Name'
              }
              placeholder={
                form.assetType === 'UNIQUE'
                  ? 'e.g. SERIAL001'
                  : form.assetType === 'QUALIFIER'
                    ? 'e.g. KYC'
                    : form.assetType === 'RESTRICTED'
                      ? 'e.g. SECURITY'
                      : 'e.g. MYTOKEN'
              }
              value={form.label}
              onChange={(e) => updateField('label', e.target.value)}
            />

            {/* Live full-name preview */}
            {previewName && (
              <p className="text-xs text-gray-500 dark:text-dark-mutedText">
                Full name:{' '}
                <span className="font-mono text-gray-800 dark:text-dark-secondary">
                  {previewName}
                </span>
              </p>
            )}

            {/* Quantity (fungible types only) */}
            {hasQuantity(form.assetType) && (
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

            {/* Decimal places (divisible types only) */}
            {hasPrecision(form.assetType) && (
              <Input
                id="create-asset-decimals"
                label="Decimal Places"
                type="number"
                min="0"
                max="8"
                value={form.decimalPlaces}
                onChange={(e) => updateField('decimalPlaces', e.target.value)}
              />
            )}

            {/* Verifier string (RESTRICTED only) */}
            {form.assetType === 'RESTRICTED' && (
              <Input
                id="create-asset-verifier"
                label="Verifier String"
                placeholder="e.g. KYC&ACCREDITED (qualifiers required to hold)"
                value={form.verifierString}
                onChange={(e) => updateField('verifierString', e.target.value)}
              />
            )}

            {/* Reissuable + IPFS toggles */}
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
                Attach IPFS Hash {form.assetType === 'UNIQUE' && '(metadata for the NFT)'}
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
              <Button variant="secondary" onClick={handleReset} disabled={issuing}>
                Reset
              </Button>
              <Button variant="primary" onClick={handleSubmit} loading={issuing}>
                {issuing ? <Spinner size="sm" /> : `Issue ${form.assetType} Asset`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Success Modal */}
      <Modal isOpen={!!txid} onClose={handleReset} title="Asset Created">
        <div className="text-center py-6">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <svg
              className="h-6 w-6 text-green-600 dark:text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-dark-text">
            Asset Created Successfully
          </h3>
          <p className="mt-1 break-all text-sm text-gray-500 dark:text-dark-mutedText">
            Transaction ID: <span className="font-mono">{txid}</span>
          </p>
          <Button variant="primary" onClick={handleReset} className="mt-4">
            Done
          </Button>
        </div>
      </Modal>
    </div>
  );
};

export default CreateAsset;
