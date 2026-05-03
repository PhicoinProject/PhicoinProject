import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/services/rpc';

interface RpcSettings {
  host: string;
  port: number;
  user: string;
  password: string;
}

/**
 * SECURITY: RPC credentials are stored in memory only (React state).
 * They are never persisted to localStorage, sessionStorage, or cookies.
 * On page reload, the user must re-enter credentials or rely on environment defaults.
 * This prevents credential theft via XSS or browser storage inspection.
 */

/** Settings page -- RPC configuration */
export const Settings: React.FC = () => {
  const [rpcSettings] = useState<RpcSettings>(() => ({
    host: import.meta.env.VITE_RPC_HOST || 'localhost',
    port: parseInt(import.meta.env.VITE_RPC_PORT || '28966', 10),
    user: import.meta.env.VITE_RPC_USER || '',
    password: import.meta.env.VITE_RPC_PASSWORD || '',
  }));

  // SECURITY: Check if running over HTTPS in production
  const isSecureContext = import.meta.env.DEV
    ? true // localhost is always allowed in dev
    : (window.isSecureContext ?? window.location.protocol === 'https:');

  const [saved, setSaved] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('darkMode') === 'true';
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  // Test connection
  const { data: connectionStatus, refetch: testConnection } = useQuery({
    queryKey: ['rpcConnectionTest'],
    queryFn: async () => {
      try {
        const count = await rpc.getBlockCount();
        return { connected: true, blockCount: count };
      } catch {
        return { connected: false, error: 'Cannot connect' };
      }
    },
    enabled: false,
  });

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">Settings</h1>

      {/* SECURITY: HTTPS warning in production */}
      {!isSecureContext && !import.meta.env.DEV && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
          <h2 className="text-sm font-semibold text-red-800 dark:text-red-400">Security Warning</h2>
          <p className="mt-1 text-sm text-red-700 dark:text-red-400">
            This wallet is not running over HTTPS. Network traffic including your passphrase and RPC
            communication may be intercepted by attackers on your network. Use HTTPS in production.
          </p>
        </div>
      )}

      {/* RPC Connection */}
      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-text">RPC Connection</h2>
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          RPC configuration is set via environment variables (.env). Restart the application to
          apply changes.
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="rpc-host"
              className="block text-sm font-medium text-gray-700 dark:text-dark-secondary"
            >
              Host
            </label>
            <input
              id="rpc-host"
              type="text"
              value={rpcSettings.host}
              readOnly
              className="mt-1 w-full rounded-md border border-gray-200 dark:border-dark-muted bg-gray-50 dark:bg-dark-elevated px-3 py-2 text-sm text-gray-500 dark:text-dark-mutedText"
            />
          </div>
          <div>
            <label
              htmlFor="rpc-port"
              className="block text-sm font-medium text-gray-700 dark:text-dark-secondary"
            >
              Port
            </label>
            <input
              id="rpc-port"
              type="text"
              value={rpcSettings.port}
              readOnly
              className="mt-1 w-full rounded-md border border-gray-200 dark:border-dark-muted bg-gray-50 dark:bg-dark-elevated px-3 py-2 text-sm text-gray-500 dark:text-dark-mutedText"
            />
          </div>
          <div>
            <label
              htmlFor="rpc-user"
              className="block text-sm font-medium text-gray-700 dark:text-dark-secondary"
            >
              RPC User
            </label>
            <input
              id="rpc-user"
              type="text"
              value={rpcSettings.user}
              readOnly
              className="mt-1 w-full rounded-md border border-gray-200 dark:border-dark-muted bg-gray-50 dark:bg-dark-elevated px-3 py-2 text-sm text-gray-500 dark:text-dark-mutedText"
            />
          </div>
          <div>
            <label
              htmlFor="rpc-pass"
              className="block text-sm font-medium text-gray-700 dark:text-dark-secondary"
            >
              RPC Password
            </label>
            <input
              id="rpc-pass"
              type="password"
              value={rpcSettings.password}
              readOnly
              className="mt-1 w-full rounded-md border border-gray-200 dark:border-dark-muted bg-gray-50 dark:bg-dark-elevated px-3 py-2 text-sm text-gray-500 dark:text-dark-mutedText"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className="rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Save Settings
            </button>
            <button
              onClick={() => testConnection()}
              className="rounded-md border border-gray-300 dark:border-dark-muted px-4 py-2 text-sm font-medium text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-elevated"
            >
              Test Connection
            </button>
            {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>}
          </div>
          {connectionStatus && (
            <p
              className={`text-sm ${connectionStatus.connected ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
            >
              {connectionStatus.connected
                ? `Connected (block #${(connectionStatus as { blockCount: number }).blockCount})`
                : 'Not connected'}
            </p>
          )}
        </div>
      </div>

      {/* Display */}
      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-text">Display</h2>
        <div className="mt-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={darkMode}
                onChange={(e) => setDarkMode(e.target.checked)}
                className="sr-only"
              />
              <div
                className={`block h-6 w-11 rounded-full transition-colors ${darkMode ? 'bg-phi-primary' : 'bg-gray-300'}`}
              ></div>
              <div
                className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform ${darkMode ? 'translate-x-5' : 'translate-x-0'}`}
              ></div>
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-dark-secondary">Dark Mode</span>
          </label>
        </div>
      </div>

      {/* About */}
      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-text">About</h2>
        <div className="mt-4 space-y-1 text-sm text-gray-600 dark:text-dark-mutedText">
          <p>PHICOIN Wallet v0.1.0</p>
          <p>React + TypeScript + Tailwind CSS</p>
          <p>Backend: phicoind (Proof-of-Work, PhihaashV2)</p>
        </div>
      </div>
    </div>
  );
};

export default Settings;
