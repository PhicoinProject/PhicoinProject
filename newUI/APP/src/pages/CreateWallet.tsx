import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { createWallet } from '@/services/auth';

/**
 * Calculate passphrase strength: 0 (weak) to 4 (very strong).
 * Scoring factors: length, uppercase, lowercase, digits, special chars.
 */
function calculateStrength(passphrase: string): { score: number; label: string; color: string } {
  let score = 0;
  if (passphrase.length >= 12) score++;
  if (passphrase.length >= 16) score++;
  if (/[a-z]/.test(passphrase)) score++;
  if (/[A-Z]/.test(passphrase)) score++;
  if (/\d/.test(passphrase)) score++;
  if (/[^a-zA-Z0-9]/.test(passphrase)) score++;

  // Normalize to 0-4 scale
  const clamped = Math.min(4, Math.max(0, score - 2));
  const labels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500', 'bg-green-600'];
  return { score: clamped, label: labels[clamped], color: colors[clamped] };
}

/**
 * Wallet creation page - generates a secure passphrase, derives encryption key,
 * and stores encrypted sentinel for future unlock verification.
 */
export const CreateWallet: React.FC = () => {
  const navigate = useNavigate();
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [generatedMnemonic, setGeneratedMnemonic] = useState('');

  const strength = useMemo(() => calculateStrength(passphrase), [passphrase]);

  // Generate a random 12-word mnemonic (simplified BIP39-like)
  const generateMnemonic = () => {
    const words = [
      'abandon',
      'ability',
      'able',
      'about',
      'above',
      'absent',
      'absorb',
      'abstract',
      'absurd',
      'abuse',
      'access',
      'accident',
      'account',
      'accuse',
      'achieve',
      'acid',
      'acoustic',
      'acquire',
      'across',
      'action',
      'actor',
      'actual',
      'adapt',
      'add',
      'addict',
      'address',
      'adjust',
      'admit',
      'adult',
      'advance',
      'advice',
      'aerobic',
      'affair',
      'afford',
      'afraid',
      'again',
      'agent',
      'agree',
      'ahead',
      'aim',
      'air',
      'airport',
      'aisle',
      'alarm',
      'album',
      'alcohol',
      'alert',
      'alien',
      'align',
      'allow',
      'almost',
      'alone',
      'alpha',
      'already',
      'also',
      'alter',
      'always',
      'amateur',
      'amazing',
      'among',
      'amount',
      'amused',
      'anchor',
      'ancient',
      'anger',
      'angle',
      'angry',
      'animal',
      'ankle',
      'announce',
      'annual',
      'another',
      'answer',
      'antenna',
      'antique',
      'anxiety',
      'any',
      'apart',
      'apology',
      'appear',
      'apple',
      'approve',
      'april',
      'arch',
      'arctic',
      'area',
      'arena',
      'argue',
      'arm',
      'armed',
    ];
    const selected: string[] = [];
    for (let i = 0; i < 12; i++) {
      const idx = crypto.getRandomValues(new Uint32Array(1))[0] % words.length;
      selected.push(words[idx]);
    }
    setGeneratedMnemonic(selected.join(' '));
    return selected;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // SECURITY: Require minimum 12 characters
    if (passphrase.length < 12) {
      setError('Passphrase must be at least 12 characters');
      return;
    }

    if (passphrase !== confirmPassphrase) {
      setError('Passphrases do not match');
      return;
    }

    if (!generatedMnemonic) {
      setError('Mnemonic not generated. Try again.');
      return;
    }

    setLoading(true);
    try {
      // Use the centralized auth service for wallet creation
      await createWallet(passphrase, generatedMnemonic);

      // Clear mnemonic from state after brief display
      setTimeout(() => setGeneratedMnemonic(''), 30000);

      navigate('/unlock');
    } catch (err) {
      setError(`Wallet creation failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-dark-bg">
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-dark-surface p-8 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">
            Create PHICOIN Wallet
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-dark-mutedText">
            Set up a new encrypted wallet
          </p>
        </div>

        {generatedMnemonic ? (
          <div className="mb-6 rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-4">
            <p className="text-xs text-yellow-700 dark:text-yellow-400">
              This is a temporary backup phrase for demonstration. PHICOIN uses native daemon HD
              wallets - for production use, back up your wallet.dat file.
            </p>
            <p className="mt-1 text-sm font-medium text-yellow-800 dark:text-yellow-300">
              Your recovery phrase (save this securely):
            </p>
            <p className="mt-2 font-mono text-sm break-all text-yellow-900 dark:text-yellow-200">
              {generatedMnemonic}
            </p>
            <p className="mt-2 text-xs text-yellow-700 dark:text-yellow-400">
              This phrase is your backup. Never share it. It will be hidden after 30 seconds.
            </p>
            <button
              type="button"
              onClick={() => setGeneratedMnemonic('')}
              className="mt-2 text-xs font-medium text-yellow-800 dark:text-yellow-300 hover:underline"
            >
              Hide
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={generateMnemonic}
            className="mb-4 w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-4 py-2 text-sm font-medium text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-muted"
          >
            Generate Recovery Phrase
          </button>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary">
              Passphrase
            </label>
            <div className="relative">
              <input
                type={showPassphrase ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                placeholder="Min 12 characters"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPassphrase(!showPassphrase)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 dark:text-dark-mutedText"
              >
                {showPassphrase ? 'Hide' : 'Show'}
              </button>
            </div>
            {/* Password strength meter */}
            {passphrase && (
              <div className="mt-2">
                <div className="flex gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        i < strength.score ? strength.color : 'bg-gray-200 dark:bg-dark-muted'
                      }`}
                    />
                  ))}
                </div>
                <p
                  className={`mt-1 text-xs ${
                    strength.score <= 1
                      ? 'text-red-600 dark:text-red-400'
                      : strength.score === 2
                        ? 'text-yellow-600 dark:text-amber-400'
                        : 'text-green-600 dark:text-green-400'
                  }`}
                >
                  {strength.label}
                  {passphrase.length < 12 &&
                    ` — need ${12 - passphrase.length} more character${12 - passphrase.length === 1 ? '' : 's'}`}
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary">
              Confirm Passphrase
            </label>
            <input
              type="password"
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
              placeholder="Re-enter passphrase"
              autoComplete="off"
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !passphrase || !confirmPassphrase || !generatedMnemonic}
            className="w-full rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Wallet'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-phi-primary hover:underline"
          >
            Back to login
          </button>
        </div>
      </div>
    </div>
  );
};
