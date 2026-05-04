import React, { useState } from 'react';
import { signMessageWithWallet, verifyMessage as verifyMessageFn } from '@/services/messageSigner';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { useToast } from '@/components/common/Toast';

type Tab = 'sign' | 'verify';

/** Sign / Verify message page */
export const SignVerify: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('sign');
  const { showToast } = useToast();

  // --- Sign tab state ---
  const [signMessage, setSignMessage] = useState('');
  const [signing, setSigning] = useState(false);
  const [signature, setSignature] = useState('');
  const [signAddress, setSignAddress] = useState('');

  // --- Verify tab state ---
  const [verifyAddress, setVerifyAddress] = useState('');
  const [verifyMessage, setVerifyMessage] = useState('');
  const [verifySignature, setVerifySignature] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null);

  // --- Sign handler ---
  const handleSign = async () => {
    if (!signMessage.trim()) {
      showToast('Please enter a message to sign.', 'warning');
      return;
    }
    setSigning(true);
    setSignature('');
    setSignAddress('');
    try {
      const result = await signMessageWithWallet(signMessage.trim());
      setSignature(result.signature);
      setSignAddress(result.address);
      showToast('Message signed successfully.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to sign message';
      showToast(msg, 'error');
    } finally {
      setSigning(false);
    }
  };

  const handleCopySignature = () => {
    if (signature) {
      navigator.clipboard.writeText(signature);
      showToast('Signature copied to clipboard.', 'success');
    }
  };

  // --- Verify handler ---
  const handleVerify = async () => {
    if (!verifyAddress.trim() || !verifyMessage.trim() || !verifySignature.trim()) {
      showToast('Please fill in all fields.', 'warning');
      return;
    }
    setVerifying(true);
    setVerifyResult(null);
    try {
      const valid = verifyMessageFn(
        verifyMessage.trim(),
        verifySignature.trim(),
        verifyAddress.trim()
      );
      setVerifyResult(valid);
      showToast(
        valid ? 'Signature is valid.' : 'Signature is invalid.',
        valid ? 'success' : 'error'
      );
    } catch {
      showToast('Failed to verify signature.', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const handleResetVerify = () => {
    setVerifyAddress('');
    setVerifyMessage('');
    setVerifySignature('');
    setVerifyResult(null);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-bold text-gray-900 dark:text-dark-text md:text-2xl">
        Sign &amp; Verify Messages
      </h1>

      {/* Tab switcher */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('sign')}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'sign'
              ? 'bg-phi-primary text-white'
              : 'bg-white dark:bg-dark-surface text-gray-600 dark:text-dark-mutedText border border-gray-300 dark:border-dark-muted hover:bg-gray-50 dark:hover:bg-dark-elevated'
          }`}
        >
          Sign Message
        </button>
        <button
          onClick={() => setActiveTab('verify')}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'verify'
              ? 'bg-phi-primary text-white'
              : 'bg-white dark:bg-dark-surface text-gray-600 dark:text-dark-mutedText border border-gray-300 dark:border-dark-muted hover:bg-gray-50 dark:hover:bg-dark-elevated'
          }`}
        >
          Verify Message
        </button>
      </div>

      {/* Tab content */}
      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
        {activeTab === 'sign' ? (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-dark-text">
              Sign a Message
            </h2>
            <p className="text-sm text-gray-500 dark:text-dark-mutedText">
              Sign an arbitrary message with your wallet&apos;s private key. The resulting
              Base64-encoded signature can be verified by anyone using your public address.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-dark-secondary">
                Message
              </label>
              <textarea
                rows={5}
                className="mt-1 w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-surface text-gray-900 dark:text-dark-text px-3 py-2 text-sm shadow-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                placeholder="Enter the message you want to sign..."
                value={signMessage}
                onChange={(e) => setSignMessage(e.target.value)}
              />
            </div>

            <Button
              onClick={handleSign}
              disabled={!signMessage.trim() || signing}
              loading={signing}
            >
              Sign
            </Button>

            {signature && (
              <div className="mt-4 space-y-3 rounded-md border border-gray-200 dark:border-dark-border p-4">
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-dark-mutedText">
                    Address
                  </p>
                  <p className="mt-1 break-all font-mono text-sm text-gray-800 dark:text-dark-secondary">
                    {signAddress}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-dark-mutedText">
                    Signature (Base64)
                  </p>
                  <p className="mt-1 break-all font-mono text-sm text-gray-800 dark:text-dark-secondary">
                    {signature}
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={handleCopySignature}>
                  Copy Signature
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-dark-text">
              Verify a Message
            </h2>
            <p className="text-sm text-gray-500 dark:text-dark-mutedText">
              Verify that a signature was produced by the private key corresponding to a given
              PHICOIN address.
            </p>

            <Input
              id="verify-address"
              label="PHICOIN Address"
              placeholder="P..."
              value={verifyAddress}
              onChange={(e) => setVerifyAddress(e.target.value)}
            />

            <div>
              <label
                htmlFor="verify-message"
                className="block text-sm font-medium text-gray-700 dark:text-dark-secondary"
              >
                Message
              </label>
              <textarea
                id="verify-message"
                rows={5}
                className="mt-1 w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-surface text-gray-900 dark:text-dark-text px-3 py-2 text-sm shadow-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                placeholder="Enter the original message..."
                value={verifyMessage}
                onChange={(e) => setVerifyMessage(e.target.value)}
              />
            </div>

            <Input
              id="verify-signature"
              label="Signature (Base64)"
              placeholder="Enter the Base64-encoded signature..."
              value={verifySignature}
              onChange={(e) => setVerifySignature(e.target.value)}
            />

            <div className="flex gap-2">
              <Button
                onClick={handleVerify}
                disabled={
                  !verifyAddress.trim() ||
                  !verifyMessage.trim() ||
                  !verifySignature.trim() ||
                  verifying
                }
                loading={verifying}
              >
                Verify
              </Button>
              {verifyResult !== null && (
                <Button variant="secondary" onClick={handleResetVerify}>
                  Reset
                </Button>
              )}
            </div>

            {verifyResult !== null && (
              <div
                className={`mt-4 rounded-md border p-4 text-sm font-medium ${
                  verifyResult
                    ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-400'
                }`}
              >
                {verifyResult ? (
                  <span>
                    Signature is valid. The message was signed by the owner of the provided address.
                  </span>
                ) : (
                  <span>
                    Signature is invalid. The message was NOT signed by the owner of the provided
                    address.
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SignVerify;
