import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createWalletV2 } from '@/services/auth';
import { generateMnemonicWords, isValidMnemonic } from '@/services/HDWallet';

function calculateStrength(password: string): { score: number; label: string; color: string } {
  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  const clamped = Math.min(4, Math.max(0, score - 2));
  const labels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500', 'bg-green-600'];
  return { score: clamped, label: labels[clamped], color: colors[clamped] };
}

type Step = 'mnemonic' | 'seed' | 'password' | 'verifying';

export const CreateWallet: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('mnemonic');
  const [mnemonic, setMnemonic] = useState(() => generateMnemonicWords());
  const [userSeed, setUserSeed] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmedBackup, setConfirmedBackup] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [quizIndices, setQuizIndices] = useState<number[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});

  const strength = useMemo(() => calculateStrength(password), [password]);

  // SECURITY (P2): on unmount, defensively remove any legacy plaintext mnemonic an
  // older build may have persisted to web storage. We deliberately do NOT call
  // setMnemonic('') here: clearing state in an unmount cleanup is a no-op for a real
  // unmount (React GCs the component state anyway), but under React 18 StrictMode's
  // dev-only mount→unmount→remount probe the cleanup fires on the first mount and
  // wipes the freshly generated phrase, leaving the recovery-phrase grid blank.
  useEffect(() => {
    return () => {
      sessionStorage.removeItem('phi:createMnemonic');
    };
  }, []);

  const generateNewMnemonic = () => {
    const words = generateMnemonicWords();
    setMnemonic(words);
    setConfirmedBackup(false);
  };

  const generateQuiz = () => {
    const words = mnemonic.split(' ');
    const indices = new Set<number>();
    while (indices.size < 6) {
      indices.add(Math.floor(Math.random() * words.length));
    }
    const sorted = Array.from(indices).sort((a, b) => a - b);
    setQuizIndices(sorted);
    setQuizAnswers({});
  };

  const handleNext = () => {
    setError('');
    if (step === 'mnemonic') {
      setStep('seed');
    } else if (step === 'seed') {
      setStep('password');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
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
      localStorage.setItem('phi:walletVersion', '2');
      // SECURITY (P2): the recovery phrase is kept ONLY in this component's
      // in-memory React state for the backup quiz below. We must never persist
      // the plaintext mnemonic to web storage, where any script (or XSS) could
      // read it without the password.
      setStep('verifying');
      generateQuiz();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet creation failed');
    }
    setLoading(false);
  };

  const checkQuiz = () => {
    const words = mnemonic.split(' ');
    for (const idx of quizIndices) {
      if (quizAnswers[idx] !== words[idx]) {
        setError('Some answers are incorrect. Please try again.');
        return;
      }
    }
    // Drop the in-memory phrase before leaving the create flow.
    setMnemonic('');
    navigate('/');
  };

  const renderMnemonicStep = () => (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
          Recovery Phrase
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-dark-mutedText">
          Write down these 24 words. They are your only backup.
        </p>
      </div>
      <div className="rounded-lg border border-amber-200 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 p-4">
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Store this phrase safely. If you lose it, you cannot recover your wallet.
        </p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {mnemonic.split(' ').map((word, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded bg-gray-50 dark:bg-dark-elevated px-2 py-2"
          >
            <span className="text-xs text-gray-500 dark:text-dark-mutedText">{i + 1}</span>
            <span className="text-sm font-medium text-gray-800 dark:text-dark-secondary">
              {word}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={generateNewMnemonic}
          className="flex-1 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-4 py-2 text-sm font-medium text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-muted"
        >
          Regenerate
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-secondary">
        <input
          type="checkbox"
          checked={confirmedBackup}
          onChange={(e) => setConfirmedBackup(e.target.checked)}
          className="rounded border-gray-300 dark:border-dark-muted"
        />
        I have written down my recovery phrase
      </label>
    </div>
  );

  const renderSeedStep = () => (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
          Custom Seed
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-dark-mutedText">
          Add your own secret phrase. Combined with the recovery phrase, this creates your wallet.
        </p>
      </div>
      <div className="rounded-lg border border-blue-200 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20 p-4">
        <p className="text-sm text-blue-700 dark:text-blue-400">
          This acts as your BIP39 passphrase. Without it, the recovery phrase alone cannot restore
          this wallet.
        </p>
      </div>
      <div>
        <label
          htmlFor="userSeed"
          className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary"
        >
          Custom Seed
        </label>
        <input
          id="userSeed"
          type="password"
          value={userSeed}
          onChange={(e) => setUserSeed(e.target.value)}
          className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
          placeholder="At least 8 characters"
          autoComplete="off"
        />
        {userSeed.length > 0 && userSeed.length < 8 && (
          <p className="mt-1 text-xs text-red-500 dark:text-red-400">
            Need {8 - userSeed.length} more character{8 - userSeed.length === 1 ? '' : 's'}
          </p>
        )}
      </div>
    </div>
  );

  const renderPasswordStep = () => (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
          Encryption Password
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-dark-mutedText">
          This password protects your wallet data on this device.
        </p>
      </div>
      <div>
        <label
          htmlFor="password"
          className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary"
        >
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
            placeholder="Min 12 characters"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 dark:text-dark-mutedText"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        {password && (
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
              className={`mt-1 text-xs ${strength.score <= 1 ? 'text-red-500' : strength.score === 2 ? 'text-yellow-500' : 'text-green-500'}`}
            >
              {strength.label}
            </p>
          </div>
        )}
      </div>
      <div>
        <label
          htmlFor="confirmPassword"
          className="mb-1 block text-sm font-medium text-gray-700 dark:text-dark-secondary"
        >
          Confirm Password
        </label>
        <input
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
          placeholder="Re-enter password"
          autoComplete="off"
        />
        {confirmPassword && password !== confirmPassword && (
          <p className="mt-1 text-xs text-red-500 dark:text-red-400">Passwords do not match</p>
        )}
      </div>
    </div>
  );

  const renderQuizStep = () => {
    return (
      <div className="space-y-4">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
            Verify Recovery Phrase
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-dark-mutedText">
            Select the correct words for the highlighted positions.
          </p>
        </div>
        <div className="space-y-3">
          {quizIndices.map((idx) => (
            <div key={idx} className="flex items-center gap-3">
              <span className="rounded bg-phi-primary px-2 py-1 text-xs font-medium text-white w-8 text-center">
                {idx + 1}
              </span>
              <input
                type="text"
                value={quizAnswers[idx] || ''}
                onChange={(e) => setQuizAnswers({ ...quizAnswers, [idx]: e.target.value })}
                className="flex-1 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                placeholder={`Word ${idx + 1}`}
                autoComplete="off"
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-dark-bg">
      <div className="w-full max-w-2xl rounded-lg bg-white dark:bg-dark-surface p-8 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">
            Create PHICOIN Wallet
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-dark-mutedText">
            {step === 'mnemonic' && 'Step 1/4: Recovery phrase'}
            {step === 'seed' && 'Step 2/4: Custom seed'}
            {step === 'password' && 'Step 3/4: Encryption password'}
            {step === 'verifying' && 'Step 4/4: Verify recovery'}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {step === 'mnemonic' && renderMnemonicStep()}
          {step === 'seed' && renderSeedStep()}
          {step === 'password' && renderPasswordStep()}
          {step === 'verifying' && renderQuizStep()}

          {step !== 'verifying' && (
            <div className="flex gap-3">
              {step !== 'mnemonic' && (
                <button
                  type="button"
                  onClick={() => {
                    if (step === 'seed') setStep('mnemonic');
                    if (step === 'password') setStep('seed');
                  }}
                  className="flex-1 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-4 py-2 text-sm font-medium text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-muted"
                >
                  Back
                </button>
              )}
              {step === 'password' ? (
                <button
                  type="submit"
                  disabled={loading || password.length < 12 || password !== confirmPassword}
                  className="flex-1 rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {loading ? 'Creating...' : 'Create Wallet'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={
                    (step === 'mnemonic' && !confirmedBackup) ||
                    (step === 'seed' && userSeed.length < 8)
                  }
                  className="flex-1 rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Next
                </button>
              )}
            </div>
          )}

          {step === 'verifying' && (
            <button
              type="button"
              onClick={checkQuiz}
              className="w-full rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Verify & Complete
            </button>
          )}
        </form>

        <div className="mt-4 text-center text-sm">
          <button
            type="button"
            onClick={() => navigate('/import')}
            className="text-phi-primary hover:underline"
          >
            Import existing wallet
          </button>
        </div>
      </div>
    </div>
  );
};
