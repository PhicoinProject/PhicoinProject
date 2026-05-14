import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toHex, fromHex, deriveWalletKey } from '@/services/crypto';
import { hasV2Wallet, retrieveEncryptedSeed, importEncryptedWallet } from '@/services/encryptedWallet';
import { seedToHDKey } from '@/services/HDWallet';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';
import { resetRateLimit } from '@/services/auth';

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
  const [mode, setMode] = useState<'export' | 'mnemonic' | 'import'>('export');

  // Import state
  const [importFile, setImportFile] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [importVersion, setImportVersion] = useState<'v1' | 'v2' | null>(null);

  const generateV2Backup = (): string | null => {
    const encryptedHex = localStorage.getItem('phi:v2:encryptedSeed');
    const saltHex = localStorage.getItem('phi:v2:salt');
    const ivHex = localStorage.getItem('phi:v2:iv');
    const metaJson = localStorage.getItem('phi:v2:meta');

    if (!encryptedHex || !saltHex) {
      return null;
    }

    const meta = metaJson ? JSON.parse(metaJson) : {};

    // encryptedHex from localStorage is [iv][ciphertext+tag]; importEncryptedWallet
    // expects cipher WITHOUT iv (it prepends iv itself), so strip the first 12 bytes.
    const cipherHex = encryptedHex.slice(24); // 12 bytes = 24 hex chars

    const backup = {
      version: 2,
      format: 'phicoin-encrypted-wallet',
      encrypted: {
        iv: ivHex || '',
        cipher: cipherHex,
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportSuccess(false);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setImportFile(text);
      try {
        const json = JSON.parse(text);
        if (json.version === 2 || json.format === 'phicoin-encrypted-wallet') {
          setImportVersion('v2');
        } else {
          setImportVersion('v1');
        }
      } catch {
        setImportVersion(null);
      }
    };
    reader.onerror = () => {
      setError('Failed to read file. Try again.');
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportSuccess(false);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setImportFile(text);
      try {
        const json = JSON.parse(text);
        if (json.version === 2 || json.format === 'phicoin-encrypted-wallet') {
          setImportVersion('v2');
        } else {
          setImportVersion('v1');
        }
      } catch {
        setImportVersion(null);
      }
    };
    reader.onerror = () => {
      setError('Failed to read file. Try again.');
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleImport = async () => {
    if (!importFile) {
      setError('Select a backup file first.');
      return;
    }
    if (!importPassword.trim()) {
      setError('Enter the wallet password to verify the import.');
      return;
    }

    setImportLoading(true);
    setError(null);

    try {
      const json = JSON.parse(importFile);

      if (json.version === 2 || json.format === 'phicoin-encrypted-wallet') {
        // V2 encrypted wallet import
        importEncryptedWallet(importFile);

        // Attempt to decrypt to verify password
        const masterSeed = await retrieveEncryptedSeed(importPassword);
        const hdKey = seedToHDKey(masterSeed);
        useWalletHDKeyStore.getState().setHDKey(hdKey);

        // Set session unlock flags
        sessionStorage.setItem('phi:unlocked', 'true');
        resetRateLimit();

        // Store session key for auto-unlock on refresh
        try {
          const sessionKey = crypto.getRandomValues(new Uint8Array(32));
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const toBuf = (arr: Uint8Array): ArrayBuffer => {
            const ab = new ArrayBuffer(arr.length);
            new Uint8Array(ab).set(arr);
            return ab;
          };
          const aesKey = await crypto.subtle.importKey(
            'raw', toBuf(sessionKey), { name: 'AES-GCM', length: 256 }, false, ['encrypt']
          );
          const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: toBuf(iv) }, aesKey, toBuf(masterSeed)
          );
          const toHexArr = (bytes: Uint8Array) =>
            Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
          sessionStorage.setItem('phi:sessionKey', toHexArr(sessionKey));
          sessionStorage.setItem(
            'phi:sessionEncryptedSeed',
            toHexArr(new Uint8Array([...iv, ...new Uint8Array(encrypted)]))
          );
          sessionKey.fill(0);
        } catch {
          // Auto-unlock won't work, but wallet still functions
        }

        masterSeed.fill(0);
        setImportSuccess(true);
      } else if (json.version === 1) {
        // V1 legacy backup import
        if (!json.data?.salt || !json.data?.sentinel) {
          throw new Error('Invalid v1 backup: missing salt or sentinel');
        }
        localStorage.setItem('phi:salt', json.data.salt);
        localStorage.setItem('phi:sentinel', json.data.sentinel);
        if (json.data.mnemonicHash) localStorage.setItem('phi:mnemonicHash', json.data.mnemonicHash);
        if (json.data.created) localStorage.setItem('phi:created', json.data.created);

        // Verify password by decrypting sentinel
        const salt = fromHex(json.data.salt);
        const key = await deriveWalletKey(importPassword, salt, 1000 * 64 * 8);
        const encryptedData = fromHex(json.data.sentinel);
        let decrypted: ArrayBuffer;
        try {
          decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: encryptedData.slice(0, 12).buffer },
            key,
            encryptedData.slice(12).buffer
          );
        } catch {
          // Try with 16-byte IV
          decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: encryptedData.slice(0, 16).buffer },
            key,
            encryptedData.slice(16).buffer
          );
        }
        const plaintext = new TextDecoder().decode(decrypted);
        if (plaintext !== 'phi-wallet-verified') {
          // Clear invalid import
          localStorage.removeItem('phi:salt');
          localStorage.removeItem('phi:sentinel');
          setError('Incorrect password. Import failed.');
          setImportLoading(false);
          return;
        }

        // V1 wallet doesn't store encrypted seed, so we can't derive HDKey
        // User needs to unlock via the normal unlock screen
        sessionStorage.setItem('phi:unlocked', 'true');
        localStorage.setItem('phi:walletVersion', '1');
        setImportSuccess(true);
      } else {
        throw new Error('Unsupported backup format');
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'Invalid v1 backup: missing salt or sentinel') {
        setError(err.message);
      } else if (err instanceof Error && err.message === 'Unsupported backup format') {
        setError(err.message);
      } else {
        setError('Import failed: wrong password or corrupted backup file.');
      }
      // Clear partially imported data on failure
      if (importVersion === 'v2') {
        localStorage.removeItem('phi:v2:encryptedSeed');
        localStorage.removeItem('phi:v2:salt');
        localStorage.removeItem('phi:v2:iv');
        localStorage.removeItem('phi:v2:meta');
      }
    } finally {
      setImportLoading(false);
    }
  };

  const resetImport = () => {
    setImportFile(null);
    setImportFileName('');
    setImportPassword('');
    setImportSuccess(false);
    setImportVersion(null);
    setError(null);
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
        <button
          type="button"
          onClick={() => {
            setMode('import');
            setError(null);
          }}
          className={`pb-2 px-1 text-sm font-medium transition-colors ${
            mode === 'import'
              ? 'border-b-2 border-phi-primary text-phi-primary'
              : 'text-gray-500 hover:text-gray-700 dark:text-dark-mutedText'
          }`}
        >
          Import Backup
        </button>
      </div>

      {mode === 'export' && (
        <div>
          <p className="mb-4 text-sm text-gray-600 dark:text-dark-mutedText">
            Download your wallet&apos; encrypted data. You can import this file on any device.
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
      )}

      {mode === 'mnemonic' && (
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

      {mode === 'import' && (
        <div>
          <p className="mb-4 text-sm text-gray-600 dark:text-dark-mutedText">
            Restore your wallet from a previously exported backup file.
          </p>

          <div className="mb-6 rounded-lg border border-amber-200 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 p-4">
            <h3 className="font-medium text-amber-800 dark:text-amber-400">Before You Import</h3>
            <ul className="mt-2 list-inside list-disc text-sm text-amber-700 dark:text-amber-400 space-y-1">
              <li>Make sure you have the correct backup file (<code className="font-mono text-xs">phicoin-wallet-backup-*.json</code>)</li>
              <li>You will need the wallet password to verify the import</li>
              <li>Importing will replace any existing wallet in this browser</li>
            </ul>
          </div>

          {importSuccess ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-green-200 dark:border-green-600 bg-green-50 dark:bg-green-900/20 p-4">
                <p className="font-medium text-green-700 dark:text-green-400">
                  Wallet imported successfully!
                </p>
                {importVersion === 'v2' && (
                  <p className="mt-1 text-sm text-green-600 dark:text-green-400">
                    Your wallet is now unlocked and ready to use.
                  </p>
                )}
                {importVersion === 'v1' && (
                  <p className="mt-1 text-sm text-green-600 dark:text-green-400">
                    V1 wallet imported. Redirecting to unlock...
                  </p>
                )}
              </div>
              <button
                onClick={() => navigate('/')}
                className="rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Go to Dashboard
              </button>
              <button
                onClick={resetImport}
                className="ml-3 text-sm text-phi-primary hover:underline"
              >
                Import Another Backup
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* File upload area */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary">
                  Backup File
                </label>
                <label
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-dark-muted bg-gray-50 dark:bg-dark-elevated p-8 cursor-pointer hover:border-phi-primary transition-colors"
                >
                  <svg
                    className="h-10 w-10 text-gray-400 dark:text-dark-mutedText"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  {importFileName ? (
                    <p className="mt-2 text-sm font-medium text-gray-800 dark:text-dark-secondary">
                      {importFileName}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-gray-600 dark:text-dark-mutedText">
                      Click to select or drag and drop
                    </p>
                  )}
                  <p className="mt-1 text-xs text-gray-500 dark:text-dark-mutedText">
                    .json backup file
                  </p>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Version info */}
              {importVersion && (
                <div className="text-xs text-gray-500 dark:text-dark-mutedText">
                  Detected format: {importVersion === 'v2' ? 'V2 Encrypted Wallet' : 'V1 Legacy Backup'}
                </div>
              )}

              {/* Password input */}
              {importFile && (
                <>
                  <div>
                    <label
                      htmlFor="importPassword"
                      className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary"
                    >
                      Wallet Password
                    </label>
                    <input
                      id="importPassword"
                      type="password"
                      value={importPassword}
                      onChange={(e) => setImportPassword(e.target.value)}
                      className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                      placeholder="Enter the wallet password"
                      autoComplete="off"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-dark-mutedText">
                      We need your password to verify the backup is not corrupted.
                    </p>
                  </div>

                  <button
                    onClick={handleImport}
                    disabled={importLoading}
                    className="w-full rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {importLoading ? 'Importing...' : 'Import Wallet'}
                  </button>

                  <button
                    onClick={resetImport}
                    type="button"
                    className="w-full text-sm text-gray-600 dark:text-dark-mutedText hover:text-gray-800 dark:hover:text-dark-secondary"
                  >
                    Cancel
                  </button>
                </>
              )}
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

export default BackupWallet;
