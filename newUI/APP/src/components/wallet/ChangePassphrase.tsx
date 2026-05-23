import React, { useState } from 'react';
import { changeWalletPassword } from '@/services/auth';
import { hasV2Wallet } from '@/services/encryptedWallet';
import { useToast } from '@/components/common/Toast';

/**
 * Fully client-side "Change passphrase" panel.
 *
 * Verifies the current password by decrypting the stored encrypted seed, then
 * re-encrypts the same seed under a new password (fresh salt + IV via
 * services/auth.changeWalletPassword). No RPC, no key material leaves the browser.
 *
 * Self-contained so it can be mounted on BackupWallet/Settings without colliding
 * with the frontend lane's components.
 */
export const ChangePassphrase: React.FC = () => {
  const { showToast } = useToast();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isV2 = hasV2Wallet();

  const resetFields = () => {
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!oldPassword) {
      setError('Enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword === oldPassword) {
      setError('New password must be different from the current password.');
      return;
    }

    setSubmitting(true);
    try {
      await changeWalletPassword(oldPassword, newPassword);
      resetFields();
      showToast('Passphrase changed successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change passphrase.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'mt-1 w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary';

  return (
    <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-text">Change Passphrase</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-dark-mutedText">
        Re-encrypt your wallet seed with a new password. This happens entirely in your browser —
        your recovery phrase and password are never sent anywhere.
      </p>

      {!isV2 ? (
        <p className="mt-4 rounded-md bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-700 dark:text-amber-400">
          Changing the passphrase is only available for wallets created or imported with the current
          (encrypted-seed) format. Re-import your wallet to upgrade.
        </p>
      ) : (
        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="change-pass-old"
              className="block text-sm font-medium text-gray-700 dark:text-dark-secondary"
            >
              Current Password
            </label>
            <input
              id="change-pass-old"
              type={showPasswords ? 'text' : 'password'}
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => {
                setOldPassword(e.target.value);
                setError(null);
              }}
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="change-pass-new"
              className="block text-sm font-medium text-gray-700 dark:text-dark-secondary"
            >
              New Password
            </label>
            <input
              id="change-pass-new"
              type={showPasswords ? 'text' : 'password'}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setError(null);
              }}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-dark-mutedText">
              At least 8 characters.
            </p>
          </div>

          <div>
            <label
              htmlFor="change-pass-confirm"
              className="block text-sm font-medium text-gray-700 dark:text-dark-secondary"
            >
              Confirm New Password
            </label>
            <input
              id="change-pass-confirm"
              type={showPasswords ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setError(null);
              }}
              className={inputClass}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-dark-mutedText">
            <input
              type="checkbox"
              checked={showPasswords}
              onChange={(e) => setShowPasswords(e.target.checked)}
              className="rounded border-gray-300 dark:border-dark-muted"
            />
            Show passwords
          </label>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Changing…' : 'Change Passphrase'}
            </button>
            <button
              type="button"
              onClick={resetFields}
              disabled={submitting}
              className="rounded-md border border-gray-300 dark:border-dark-muted px-4 py-2 text-sm font-medium text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-elevated disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ChangePassphrase;
