import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { tryUnlock, clearWallet, checkRateLimit } from '@/services/auth';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';

/**
 * Wallet unlock page - passphrase entry for existing encrypted wallets.
 * Stores derived key in Zustand store (memory only, never persisted).
 * Implements rate limiting: after 5 failed attempts, enforces a 30s cooldown.
 */
export const Unlock: React.FC = () => {
  const navigate = useNavigate();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => {
      const { cooldownMs } = checkRateLimit();
      setCooldown(Math.max(0, Math.ceil(cooldownMs / 1000)));
    }, 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (cooldown > 0) {
      setError(`Too many failed attempts. Please wait ${cooldown} seconds.`);
      return;
    }

    if (!passphrase) {
      setError('Passphrase is required');
      return;
    }

    setLoading(true);
    try {
      const ok = await tryUnlock(passphrase);
      if (!ok) {
        // Rate limit tracking is handled inside tryUnlock
        const { cooldownMs, remainingAttempts } = checkRateLimit();
        if (cooldownMs > 0) {
          setCooldown(Math.ceil(cooldownMs / 1000));
          setError('Incorrect passphrase. Account locked for 30 seconds.');
        } else {
          setError(
            `Incorrect passphrase. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining.`
          );
        }
        setLoading(false);
        return;
      }
      // Verify HDKey was set by tryUnlock
      const hdKeyStore = useWalletHDKeyStore.getState();
      console.log('[Unlock] HDKey set after unlock:', !!hdKeyStore.hdKey);
      navigate('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to unlock wallet';
      // Check if this is a rate limit error
      if (msg.includes('Too many failed attempts')) {
        const { cooldownMs } = checkRateLimit();
        setCooldown(Math.ceil(cooldownMs / 1000));
        setError(msg);
      } else {
        // SECURITY: Sanitize error messages - don't leak crypto details
        if (msg.includes('Wallet data')) {
          setError(msg);
        } else {
          setError('Incorrect passphrase');
        }
      }
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-dark-bg">
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-dark-surface p-8 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">PHICOIN Wallet</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-dark-mutedText">
            Enter your passphrase to unlock
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="passphrase"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary"
            >
              Passphrase
            </label>
            <input
              id="passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => {
                setPassphrase(e.target.value);
                setError('');
              }}
              className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
              placeholder="Enter passphrase"
              autoComplete="off"
              disabled={loading || cooldown > 0}
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {cooldown > 0 && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-700 dark:text-amber-400">
              Locked for {cooldown}s — too many failed attempts.
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !passphrase || cooldown > 0}
            className="w-full rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Unlocking...' : 'Unlock Wallet'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm">
          <button
            type="button"
            onClick={() => {
              clearWallet();
              navigate('/');
            }}
            className="text-phi-primary hover:underline"
          >
            Reset &amp; Create New Wallet
          </button>
        </div>
      </div>
    </div>
  );
};
