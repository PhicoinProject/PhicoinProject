import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { importEncryptedWallet } from '@/services/encryptedWallet';
import { retrieveEncryptedSeed } from '@/services/encryptedWallet';
import { createWalletV2 } from '@/services/auth';
import { isValidMnemonic, seedToHDKey } from '@/services/HDWallet';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';
import { resetRateLimit } from '@/services/auth';

export const ImportWallet: React.FC = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'file' | 'phrase'>('file');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // File import state
  const [jsonInput, setJsonInput] = useState('');
  const [importPassword, setImportPassword] = useState('');

  // Phrase import state
  const [mnemonic, setMnemonic] = useState('');
  const [userSeed, setUserSeed] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleFileImport = async () => {
    setError('');
    setLoading(true);
    try {
      const json = JSON.parse(jsonInput);

      if (json.version === 2 || json.format === 'phicoin-encrypted-wallet') {
        // V2 encrypted wallet — store to localStorage first
        importEncryptedWallet(jsonInput);

        // Verify password by attempting decryption
        if (!importPassword.trim()) {
          setError('Enter your wallet password to verify the import');
          setLoading(false);
          return;
        }

        try {
          const masterSeed = await retrieveEncryptedSeed(importPassword);
          const hdKey = seedToHDKey(masterSeed);
          useWalletHDKeyStore.getState().setHDKey(hdKey);

          // Unlock
          sessionStorage.setItem('phi:unlocked', 'true');
          resetRateLimit();

          // Session key for auto-unlock on refresh
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
          const toHexArr = (b: Uint8Array) =>
            Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
          sessionStorage.setItem('phi:sessionKey', toHexArr(sessionKey));
          sessionStorage.setItem(
            'phi:sessionEncryptedSeed',
            toHexArr(new Uint8Array([...iv, ...new Uint8Array(encrypted)]))
          );
          sessionKey.fill(0);
          masterSeed.fill(0);

          navigate('/');
        } catch {
          setError('Incorrect password. Please try again.');
          // Clear on wrong password
          localStorage.removeItem('phi:v2:encryptedSeed');
          localStorage.removeItem('phi:v2:salt');
          localStorage.removeItem('phi:v2:iv');
          localStorage.removeItem('phi:v2:meta');
        }
      } else if (json.version === 1) {
        // V1 legacy backup — no password verification needed via this page,
        // just store and redirect to unlock
        if (!json.data?.salt || !json.data?.sentinel) {
          throw new Error('Invalid v1 backup: missing data');
        }
        localStorage.setItem('phi:salt', json.data.salt);
        localStorage.setItem('phi:sentinel', json.data.sentinel);
        if (json.data.mnemonicHash) localStorage.setItem('phi:mnemonicHash', json.data.mnemonicHash);
        if (json.data.created) localStorage.setItem('phi:created', json.data.created);

        navigate('/unlock');
      } else {
        throw new Error('Unsupported backup format');
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Invalid JSON. Please check the file content.');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Invalid wallet backup file');
      }
    }
    setLoading(false);
  };

  const handlePhraseImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isValidMnemonic(mnemonic)) {
      setError('Invalid mnemonic phrase');
      return;
    }
    if (userSeed.length < 8) {
      setError('Custom seed must be at least 8 characters');
      return;
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await createWalletV2(mnemonic, userSeed, password);
      navigate('/unlock');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet import failed');
    }
    setLoading(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setJsonInput(ev.target?.result as string);
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-dark-bg">
      <div className="w-full max-w-2xl rounded-lg bg-white dark:bg-dark-surface p-8 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">Import Wallet</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-dark-mutedText">
            Restore an existing PHICOIN wallet
          </p>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 rounded-lg bg-gray-200 dark:bg-dark-elevated p-1 mb-6">
          <button
            onClick={() => { setMode('file'); setError(''); }}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              mode === 'file'
                ? 'bg-white dark:bg-dark-muted text-gray-900 dark:text-dark-text shadow-sm'
                : 'text-gray-600 dark:text-dark-mutedText hover:text-gray-900 dark:hover:text-dark-secondary'
            }`}
          >
            Encrypted Backup
          </button>
          <button
            onClick={() => { setMode('phrase'); setError(''); }}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              mode === 'phrase'
                ? 'bg-white dark:bg-dark-muted text-gray-900 dark:text-dark-text shadow-sm'
                : 'text-gray-600 dark:text-dark-mutedText hover:text-gray-900 dark:hover:text-dark-secondary'
            }`}
          >
            Recovery Phrase
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {mode === 'file' ? (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary">
                Upload Backup File
              </label>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleFileUpload}
                className="w-full text-sm text-gray-600 dark:text-dark-mutedText"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary">
                Or paste JSON
              </label>
              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                className="w-full h-32 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm font-mono focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                placeholder='{"version": 2, "format": "phicoin-encrypted-wallet", ...}'
              />
            </div>

            {/* V2 backup password verification */}
            {jsonInput && (() => {
              try {
                const j = JSON.parse(jsonInput);
                return j.version === 2 || j.format === 'phicoin-encrypted-wallet';
              } catch { return false; }
            })() && (
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
                  placeholder="Enter wallet password to verify"
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-dark-mutedText">
                  We need your password to verify the backup is valid.
                </p>
              </div>
            )}

            <button
              onClick={handleFileImport}
              disabled={loading || !jsonInput}
              className="w-full rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Importing...' : 'Import Wallet'}
            </button>
          </div>
        ) : (
          <form onSubmit={handlePhraseImport} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary">
                24-Word Recovery Phrase
              </label>
              <textarea
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value)}
                className="w-full h-24 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                placeholder="Enter 24 words separated by spaces..."
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary">
                Custom Seed
              </label>
              <input
                type="password"
                value={userSeed}
                onChange={(e) => setUserSeed(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                placeholder="Your custom seed passphrase"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary">
                New Encryption Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                placeholder="Min 12 characters"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                placeholder="Re-enter password"
                autoComplete="off"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !mnemonic || !userSeed || !password}
              className="w-full rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Importing...' : 'Restore Wallet'}
            </button>
          </form>
        )}

        <div className="mt-4 text-center text-sm">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-phi-primary hover:underline"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportWallet;
