import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toHex, fromHex } from '@/services/crypto';
import { hasV2Wallet, retrieveEncryptedSeed } from '@/services/encryptedWallet';

/**
 * Wallet backup page - exports encrypted wallet data for safekeeping.
 * Supports both v1 (sentinel) and v2 (encrypted seed) wallet formats.
 */
export const BackupWallet: React.FC = () => {
  const navigate = useNavigate();
  const [backupData, setBackupData] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [mnemonic, setMnemonic] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [mode, setMode] = useState<'export' | 'mnemonic'>('export');

  const generateV2Backup = (): string | null => {
    const encryptedHex = localStorage.getItem('phi:v2:encryptedSeed');
    const saltHex = localStorage.getItem('phi:v2:salt');
    const ivHex = localStorage.getItem('phi:v2:iv');
    const metaJson = localStorage.getItem('phi:v2:meta');

    if (!encryptedHex || !saltHex) {
      return null;
    }

    const meta = metaJson ? JSON.parse(metaJson) : {};

    const backup = {
      version: 2,
      format: 'phicoin-encrypted-wallet',
      encrypted: {
        iv: ivHex || '',
        cipher: encryptedHex,
      },
      kdf: {
        type: 'PBKDF2',
        iterations: meta.iterations ?? 1_000_000,
        salt: saltHex,
      },
      meta: {
        created: meta.created ?? new Date().toISOString(),
      },
    };

    return JSON.stringify(backup, null, 2);
  };

  const generateV1Backup = (): string | null => {
    const salt = localStorage.getItem('phi:salt');
    const sentinel = localStorage.getItem('phi:sentinel');
    const mnemonicHash = localStorage.getItem('phi:mnemonicHash');
    const created = localStorage.getItem('phi:created');

    if (!salt || !sentinel) {
      return null;
    }

    const backup = {
      version: 1,
      format: 'phicoin-encrypted-backup',
      data: {
        salt: toHex(fromHex(salt)),
        sentinel,
        mnemonicHash,
        created,
      },
    };
    return JSON.stringify(backup, null, 2);
  };

  const generateBackup = () => {
    const isV2 = hasV2Wallet();
    const data = isV2 ? generateV2Backup() : generateV1Backup();

    if (!data) {
      setError('No wallet found to backup.');
      return;
    }

    setBackupData(data);
  };

  const verifyPasswordForMnemonic = async () => {
    if (!password.trim()) {
      setError('Enter your wallet password');
      return;
    }

    setVerifying(true);
    setError(null);

    try {
      await retrieveEncryptedSeed(password);
      // Password correct - if we stored mnemonic during creation, show it
      const createMnemonic = sessionStorage.getItem('phi:createMnemonic');

      // Note: We intentionally do NOT store the mnemonic in localStorage.
      // After verification, users should refer to their written backup.
      // This feature is for display confirmation only.
      if (createMnemonic) {
        setMnemonic(createMnemonic);
        setShowMnemonic(true);
      } else {
        setError('Recovery phrase not available. Please refer to your written backup.');
      }
    } catch {
      setError('Incorrect password. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const exportToFile = () => {
    const blob = new Blob([backupData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `phicoin-wallet-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(backupData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-2 text-xl font-bold text-gray-900 dark:text-dark-text">Backup Wallet</h1>
      <p className="mb-6 text-sm text-gray-600 dark:text-dark-mutedText">
        Export your encrypted wallet data. Store this file securely offline.
      </p>

      <div className="mb-6 rounded-lg border border-amber-200 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 p-4">
        <h3 className="font-medium text-amber-800 dark:text-amber-400">Important</h3>
        <ul className="mt-2 list-inside list-disc text-sm text-amber-700 dark:text-amber-400 space-y-1">
          <li>Never store this file online or share it with anyone</li>
          <li>Keep multiple copies in different physical locations</li>
          <li>You will need your password to restore from this backup</li>
          <li>This backup does NOT contain your password or recovery phrase</li>
        </ul>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Mode selection tabs */}
      <div className="mb-6 flex gap-4 border-b border-gray-200 dark:border-dark-border">
        <button
          type="button"
          onClick={() => {
            setMode('export');
            setError(null);
          }}
          className={`pb-2 px-1 text-sm font-medium transition-colors ${
            mode === 'export'
              ? 'border-b-2 border-phi-primary text-phi-primary'
              : 'text-gray-500 hover:text-gray-700 dark:text-dark-mutedText'
          }`}
        >
          Encrypted Backup
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('mnemonic');
            setError(null);
          }}
          className={`pb-2 px-1 text-sm font-medium transition-colors ${
            mode === 'mnemonic'
              ? 'border-b-2 border-phi-primary text-phi-primary'
              : 'text-gray-500 hover:text-gray-700 dark:text-dark-mutedText'
          }`}
        >
          Recovery Phrase
        </button>
      </div>

      {mode === 'export' ? (
        <div>
          <p className="mb-4 text-sm text-gray-600 dark:text-dark-mutedText">
            Download your wallet&apos;s encrypted data. You can import this file on any device.
          </p>

          <button
            onClick={() => {
              setError(null);
              generateBackup();
            }}
            className="mb-4 rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Generate Backup
          </button>

          {backupData && (
            <div className="space-y-4">
              <div className="rounded-md bg-gray-50 dark:bg-dark-elevated p-4">
                <pre className="overflow-x-auto text-xs font-mono text-gray-800 dark:text-dark-secondary">
                  {backupData}
                </pre>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={exportToFile}
                  className="flex-1 rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900"
                >
                  Download File
                </button>
                <button
                  onClick={copyToClipboard}
                  className="rounded-md border border-gray-300 dark:border-dark-muted px-4 py-2 text-sm font-medium text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-elevated"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-dark-mutedText">
            Your recovery phrase was shown during wallet creation. If you have it written down, you
            don&apos;t need this feature. Enter your password to view it one more time.
          </p>

          {!showMnemonic ? (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="mnemonicPassword"
                  className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary"
                >
                  Wallet Password
                </label>
                <input
                  id="mnemonicPassword"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                  placeholder="Enter your password"
                  autoComplete="off"
                />
              </div>
              <button
                onClick={verifyPasswordForMnemonic}
                disabled={verifying}
                className="rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {verifying ? 'Verifying...' : 'View Recovery Phrase'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-red-200 dark:border-red-600 bg-red-50 dark:bg-red-900/20 p-4">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">
                  WARNING: Do not screenshot or share your recovery phrase!
                </p>
              </div>
              {mnemonic && (
                <div className="grid grid-cols-4 gap-2">
                  {mnemonic.split(' ').map((word, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded bg-gray-50 dark:bg-dark-elevated px-2 py-2"
                    >
                      <span className="text-xs text-gray-400 dark:text-dark-mutedText">
                        {i + 1}
                      </span>
                      <span className="text-sm font-medium text-gray-800 dark:text-dark-secondary">
                        {word}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => {
                  setShowMnemonic(false);
                  setMnemonic('');
                  setPassword('');
                }}
                className="text-sm text-phi-primary hover:underline"
              >
                Hide Recovery Phrase
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 text-center">
        <button onClick={() => navigate('/')} className="text-sm text-phi-primary hover:underline">
          Back to Dashboard
        </button>
      </div>
    </div>
  );
};
