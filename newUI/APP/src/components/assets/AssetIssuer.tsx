import React, { useState } from 'react';
import { assetService } from '@/services/assets';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';

interface AssetIssuerProps {
  onIssued?: (txid: string) => void;
}

interface IssueForm {
  label: string;
  quantity: string;
  decimalPlaces: string;
  isSideChain: boolean;
  isRevokeable: boolean;
  isNoAssetGroup: boolean;
  isIPFS: boolean;
  ipfsHash: string;
}

const initialForm: IssueForm = {
  label: '',
  quantity: '0',
  decimalPlaces: '8',
  isSideChain: false,
  isRevokeable: false,
  isNoAssetGroup: false,
  isIPFS: false,
  ipfsHash: '',
};

export const AssetIssuer: React.FC<AssetIssuerProps> = ({ onIssued }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<IssueForm>(initialForm);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = <K extends keyof IssueForm>(key: K, value: IssueForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  const handleSubmit = async () => {
    if (!form.label.trim()) {
      setError('Asset label is required');
      return;
    }

    const quantity = parseFloat(form.quantity);
    if (isNaN(quantity) || quantity < 0) {
      setError('Quantity must be a non-negative number');
      return;
    }

    const decimalPlaces = parseInt(form.decimalPlaces, 10);
    if (isNaN(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 18) {
      setError('Decimal places must be between 0 and 18');
      return;
    }

    setIssuing(true);
    setError(null);

    try {
      const txid = await assetService.issueAsset({
        label: form.label.trim(),
        quantity,
        decimalPlaces,
        isSideChain: form.isSideChain,
        isRevokeable: form.isRevokeable,
        isNoAssetGroup: form.isNoAssetGroup,
        isIPFS: form.isIPFS,
        ipfsHash: form.isIPFS && form.ipfsHash ? form.ipfsHash : undefined,
      });
      onIssued?.(txid);
      setForm(initialForm);
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue asset');
    } finally {
      setIssuing(false);
    }
  };

  return (
    <>
      <Button variant="primary" onClick={() => setIsOpen(true)}>
        Issue New Asset
      </Button>

      <Modal
        isOpen={isOpen}
        onClose={() => {
          setIsOpen(false);
          setError(null);
        }}
        title="Issue New Asset"
      >
        <div className="space-y-4">
          <Input
            id="asset-label"
            label="Asset Label"
            placeholder="e.g. MYTOKEN"
            value={form.label}
            onChange={(e) => updateField('label', e.target.value)}
            error={error && !form.label ? error : undefined}
          />

          <Input
            id="asset-quantity"
            label="Quantity"
            type="number"
            min="0"
            step="any"
            value={form.quantity}
            onChange={(e) => updateField('quantity', e.target.value)}
          />

          <Input
            id="asset-decimals"
            label="Decimal Places"
            type="number"
            min="0"
            max="18"
            value={form.decimalPlaces}
            onChange={(e) => updateField('decimalPlaces', e.target.value)}
          />

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-secondary">
              <input
                type="checkbox"
                checked={form.isSideChain}
                onChange={(e) => updateField('isSideChain', e.target.checked)}
                className="rounded border-gray-300 dark:border-dark-muted"
              />
              Sidechain Asset
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-secondary">
              <input
                type="checkbox"
                checked={form.isRevokeable}
                onChange={(e) => updateField('isRevokeable', e.target.checked)}
                className="rounded border-gray-300 dark:border-dark-muted"
              />
              Revokable
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-secondary">
              <input
                type="checkbox"
                checked={form.isNoAssetGroup}
                onChange={(e) => updateField('isNoAssetGroup', e.target.checked)}
                className="rounded border-gray-300 dark:border-dark-muted"
              />
              No Asset Group
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
              id="asset-ipfs"
              label="IPFS Hash"
              placeholder="Qm..."
              value={form.ipfsHash}
              onChange={(e) => updateField('ipfsHash', e.target.value)}
            />
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setIsOpen(false)} disabled={issuing}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} loading={issuing}>
              Issue Asset
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
