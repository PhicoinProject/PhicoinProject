import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface BackupVerifyLocationState {
  mnemonic?: string;
}

export const BackupVerify: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // SECURITY (P2): the phrase is passed via in-memory React Router state only.
  // We intentionally do NOT fall back to a persisted `phi:createMnemonic`
  // value, since persisting the plaintext mnemonic to web storage exposes it
  // to any script/XSS without the password. If no phrase is present (e.g. a
  // direct hard-navigation to this route), we redirect home.
  const mnemonic = (location.state as BackupVerifyLocationState | null)?.mnemonic || '';
  const [quizIndices, setQuizIndices] = useState<number[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (!mnemonic) {
      navigate('/');
      return;
    }
    const words = mnemonic.split(' ');
    const indices = new Set<number>();
    while (indices.size < 6) {
      indices.add(Math.floor(Math.random() * words.length));
    }
    setQuizIndices(Array.from(indices).sort((a, b) => a - b));
  }, [mnemonic, navigate]);

  const checkQuiz = () => {
    const words = mnemonic.split(' ');
    for (const idx of quizIndices) {
      if (quizAnswers[idx]?.toLowerCase() !== words[idx].toLowerCase()) {
        setError('Some answers are incorrect. Please try again.');
        return;
      }
    }
    navigate('/');
  };

  if (!mnemonic) {
    return null;
  }

  const words = mnemonic.split(' ');

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-dark-bg">
      <div className="w-full max-w-2xl rounded-lg bg-white dark:bg-dark-surface p-8 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">
            Backup Verification
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-dark-mutedText">
            Verify your recovery phrase to complete wallet setup
          </p>
        </div>

        <div className="rounded-lg border border-amber-200 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 p-4 mb-6">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Please verify that you have written down your recovery phrase correctly.
          </p>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-6">
          {words.map((word: string, i: number) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded bg-gray-50 dark:bg-dark-elevated px-2 py-2"
            >
              <span className="text-xs text-gray-400 dark:text-dark-mutedText">{i + 1}</span>
              <span className="text-sm font-medium text-gray-800 dark:text-dark-secondary">
                {word}
              </span>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-medium text-gray-700 dark:text-dark-secondary mb-3">
          Select the correct words:
        </h3>
        <div className="space-y-3 mb-6">
          {quizIndices.map((idx) => (
            <div key={idx} className="flex items-center gap-3">
              <span className="rounded bg-phi-primary px-2 py-1 text-xs font-medium text-white w-8 text-center">
                {idx + 1}
              </span>
              <input
                type="text"
                value={quizAnswers[idx] || ''}
                onChange={(e) => setQuizAnswers({ ...quizAnswers, [idx]: e.target.value })}
                className="flex-1 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                placeholder={`Word ${idx + 1}`}
                autoComplete="off"
              />
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <button
          onClick={checkQuiz}
          className="w-full rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Verify & Complete
        </button>

        <div className="mt-4 text-center text-sm">
          <button onClick={() => navigate('/')} className="text-phi-primary hover:underline">
            Skip verification (not recommended)
          </button>
        </div>
      </div>
    </div>
  );
};
