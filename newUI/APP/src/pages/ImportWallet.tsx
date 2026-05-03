import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { importEncryptedWallet } from '@/services/encryptedWallet';
import { createWalletV2 } from '@/services/auth';
import { isValidMnemonic } from '@/services/HDWallet';

export const ImportWallet: React.FC = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'file' | 'phrase'>('file');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // File import state
  const [jsonInput, setJsonInput] = useState('');

  // Phrase import state
  const [mnemonic, setMnemonic] = useState('');
  const [userSeed, setUserSeed] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleFileImport = async () => {
    setError('');
    setLoading(true);
    try {
      importEncryptedWallet(jsonInput);
      navigate('/unlock');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid wallet file');
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
                accept=".json"
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
            Create new wallet instead
          </button>
        </div>
      </div>
    </div>
  );
};
