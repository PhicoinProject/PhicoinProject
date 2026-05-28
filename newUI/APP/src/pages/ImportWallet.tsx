import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { importEncryptedWallet } from '@/services/encryptedWallet';
import { retrieveEncryptedSeed } from '@/services/encryptedWallet';
import { createWalletV2, finalizeUnlockedSession } from '@/services/auth';
import { isValidMnemonic, deriveMasterSeed, seedToHDKey } from '@/services/HDWallet';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';

export const ImportWallet: React.FC = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'file' | 'phrase'>('file');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // File import state
  const [jsonInput, setJsonInput] = useState('');
  const [fileName, setFileName] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [isDragging, setIsDragging] = useState(false);

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

          // SECURITY (P1): unlock for the live session using the in-memory HD
          // key only. We do NOT persist a session AES key + seed ciphertext
          // (the old auto-unlock vector); a full refresh requires re-entering
          // the password via the Unlock page.
          finalizeUnlockedSession();
          // Zeroize the seed copy now that the HD key is loaded.
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

      // Auto-unlock: derive HDKey from mnemonic + seed and set it in memory.
      const masterSeed = await deriveMasterSeed(mnemonic, userSeed);
      const hdKey = seedToHDKey(masterSeed);
      useWalletHDKeyStore.getState().setHDKey(hdKey);

      // SECURITY (P1): mark the session unlocked using the in-memory HD key
      // only — no persisted session decryption key. Refresh requires the
      // password via the Unlock page.
      finalizeUnlockedSession();
      masterSeed.fill(0);

      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet import failed');
    }
    setLoading(false);
  };

  const readFileDialog = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      setJsonInput(ev.target?.result as string);
      setFileName(file.name);
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readFileDialog(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.name.endsWith('.json') || file.type === 'application/json') {
      readFileDialog(file);
    } else {
      setError('Please drop a .json file');
    }
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
            <p className="text-sm text-gray-600 dark:text-dark-mutedText">
              Upload the <code className="font-mono text-xs">phicoin-wallet-backup-*.json</code> file exported from your wallet, or paste the JSON below.
            </p>
            <div>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleFileUpload}
                className="hidden"
                id="backup-file-input"
              />
              <label
                htmlFor="backup-file-input"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-phi-primary bg-phi-primary/10'
                    : 'border-gray-300 dark:border-dark-muted hover:border-phi-primary/50 dark:hover:border-phi-primary/50'
                }`}
              >
                {fileName ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="mt-2 text-sm font-medium text-gray-900 dark:text-dark-text">{fileName}</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-dark-mutedText">Click or drag to replace</p>
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-gray-400 dark:text-dark-mutedText" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="mt-2 text-sm text-gray-600 dark:text-dark-mutedText">
                      <span className="font-medium text-phi-primary">Click to choose</span> or drag and drop
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-dark-mutedText">.json backup file</p>
                  </>
                )}
              </label>
            </div>
            <p className="text-center text-sm text-gray-500 dark:text-dark-mutedText">— or —</p>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary">
                Paste Backup JSON
              </label>
              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                className="w-full h-32 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm font-mono text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
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
                  className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
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
              className="w-full rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
                className="w-full h-24 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
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
                className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                placeholder="Your custom seed passphrase"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary">
                Encryption Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
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
                className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                placeholder="Re-enter password"
                autoComplete="off"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !mnemonic || !userSeed || !password}
              className="w-full rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
