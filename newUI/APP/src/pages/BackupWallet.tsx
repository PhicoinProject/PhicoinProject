import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toHex, fromHex } from '@/services/crypto';
import { hasV2Wallet } from '@/services/encryptedWallet';
import { ChangePassphrase } from '@/components/wallet/ChangePassphrase';

/**
 * Wallet backup page — exports encrypted wallet data for safekeeping.
 * Import is handled by /import (ImportWallet).
 * Supports both v1 (sentinel) and v2 (encrypted seed) wallet formats.
 */
export const BackupWallet: React.FC = () => {
  const navigate = useNavigate();
  const [backupData, setBackupData] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      <p className="mb-4 text-sm text-gray-600 dark:text-dark-mutedText">
        Download your wallet&apos; encrypted data. You can import this file on any device via{' '}
        <button
          type="button"
          onClick={() => navigate('/import')}
          className="text-phi-primary hover:underline"
        >
          Import Wallet
        </button>
        .
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

      {/* Change passphrase — fully client-side re-encryption of the wallet seed */}
      <div className="mt-8">
        <ChangePassphrase />
      </div>

      <div className="mt-6 text-center">
        <button onClick={() => navigate('/')} className="text-sm text-phi-primary hover:underline">
          Back to Dashboard
        </button>
      </div>
    </div>
  );
};

export default BackupWallet;
