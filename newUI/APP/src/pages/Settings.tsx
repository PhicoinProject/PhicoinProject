import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc, RPC_CONFIG_KEY } from '@/services/rpc';
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
} from '@/services/notifications';

interface RpcSettings {
  host: string;
  port: number;
  user: string;
  password: string;
}

/** Load saved RPC config from localStorage, fall back to env var defaults */
function loadRpcSettings(): RpcSettings {
  try {
    const raw = localStorage.getItem(RPC_CONFIG_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as RpcSettings;
      if (saved.host && saved.port) return saved;
    }
  } catch { /* ignore */ }
  return {
    host: import.meta.env.VITE_RPC_HOST || 'localhost',
    port: parseInt(import.meta.env.VITE_RPC_PORT || '28966', 10),
    user: import.meta.env.VITE_RPC_USER || '',
    password: import.meta.env.VITE_RPC_PASSWORD || '',
  };
}

/**
 * SECURITY: RPC credentials are stored in memory (React state) and localStorage.
 * On page reload, settings are loaded from localStorage so the RPC connection
 * persists. Credentials are never sent to third-party services.
 */

/** Shape of a banned entry from listbanned RPC */
interface BannedEntry {
  address: string;
  ban_created: number;
  ban_remaining: number;
}

type SettingsTab = 'connection' | 'currency' | 'notifications' | 'network' | 'about';

/** Settings page -- RPC configuration, notifications, ban management, and about */
export const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('connection');
  const [rpcSettings, setRpcSettings] = useState<RpcSettings>(loadRpcSettings);
  const [showPassword, setShowPassword] = useState(false);

  // SECURITY: Check if running over HTTPS in production
  const isSecureContext = import.meta.env.DEV
    ? true // localhost is always allowed in dev
    : (window.isSecureContext ?? window.location.protocol === 'https:');

  const [saved, setSaved] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('darkMode') === 'true';
  });

  // Notification state
  const [notifPermission, setNotifPermission] = useState<string>(() =>
    isNotificationSupported() ? getNotificationPermission() : 'unsupported'
  );

  // Currency / price state
  interface CryptoPrice {
    lastPriceUsd: number;
    lastPriceBtc: number;
    lastUpdated: string;
  }
  const queryClient = useQueryClient();

  const { data: cryptoPrice, error: priceErrorObj } = useQuery({
    queryKey: ['cryptoPrice'],
    queryFn: async () => {
      const res = await fetch('/proxy-price');
      if (!res.ok) throw new Error(`Price API returned ${res.status}`);
      const data = (await res.json()) as { last_price_usd: number; last_price_btc: number };
      return {
        lastPriceUsd: data.last_price_usd ?? 0,
        lastPriceBtc: data.last_price_btc ?? 0,
        lastUpdated: new Date().toISOString(),
      } as CryptoPrice;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const priceError = priceErrorObj?.message ?? null;

  const handleRefreshPrice = () => {
    queryClient.invalidateQueries({ queryKey: ['cryptoPrice'] });
  };
  const fetchPrice = handleRefreshPrice;

  // Ban management state
  const [bannedList, setBannedList] = useState<BannedEntry[]>([]);
  const [newBanAddress, setNewBanAddress] = useState('');
  const [newBanTime, setNewBanTime] = useState(86400); // 24 hours default
  const [loadingBans, setLoadingBans] = useState(false);
  const [banMessage, setBanMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(
    null
  );

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

  // Ban list queries
  const {
    data: bannedData,
    isLoading: loadingBannedQuery,
    refetch: refetchBanned,
  } = useQuery({
    queryKey: ['bannedList'],
    queryFn: async () => {
      const result = await rpc.listBanned();
      return (result || []).map((item: unknown) => {
        const obj = item as Record<string, unknown>;
        return {
          address: String(obj.address ?? ''),
          ban_created: Number(obj.ban_created ?? obj.ban_created_at ?? 0),
          ban_remaining: Number(obj.ban_remaining ?? 0),
        };
      }) as BannedEntry[];
    },
    enabled: activeTab === 'network',
    staleTime: 30_000,
  });

  useEffect(() => {
    if (bannedData) setBannedList(bannedData);
  }, [bannedData]);

  const handleSave = () => {
    // Persist to localStorage
    localStorage.setItem(RPC_CONFIG_KEY, JSON.stringify(rpcSettings));
    // Apply to RPC client at runtime
    rpc.setConfig(rpcSettings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleChange = (field: keyof RpcSettings, value: string) => {
    setRpcSettings((prev) => ({
      ...prev,
      [field]: field === 'port' ? parseInt(value, 10) || 0 : value,
    }));
  };

  const handleRequestNotifPermission = async () => {
    const perm = await requestNotificationPermission();
    setNotifPermission(perm);
  };

  // Ban management handlers
  const handleAddBan = async () => {
    if (!newBanAddress.trim()) {
      setBanMessage({ text: 'Address or subnet is required', type: 'error' });
      return;
    }
    setLoadingBans(true);
    setBanMessage(null);
    try {
      await rpc.setBan(newBanAddress.trim(), 'add', newBanTime, false);
      setBanMessage({ text: `Banned ${newBanAddress.trim()} successfully`, type: 'success' });
      setNewBanAddress('');
      await refetchBanned();
    } catch (err) {
      setBanMessage({
        text: err instanceof Error ? err.message : 'Failed to ban address',
        type: 'error',
      });
    } finally {
      setLoadingBans(false);
    }
  };

  const handleRemoveBan = async (address: string) => {
    setLoadingBans(true);
    setBanMessage(null);
    try {
      await rpc.setBan(address, 'remove');
      setBanMessage({ text: `Unbanned ${address}`, type: 'success' });
      await refetchBanned();
    } catch (err) {
      setBanMessage({
        text: err instanceof Error ? err.message : 'Failed to unban address',
        type: 'error',
      });
    } finally {
      setLoadingBans(false);
    }
  };

  const handleClearAllBans = async () => {
    setLoadingBans(true);
    setBanMessage(null);
    try {
      await rpc.clearBanned();
      setBanMessage({ text: 'All bans cleared', type: 'success' });
      await refetchBanned();
    } catch (err) {
      setBanMessage({
        text: err instanceof Error ? err.message : 'Failed to clear bans',
        type: 'error',
      });
    } finally {
      setLoadingBans(false);
    }
  };

  const formatBanTime = (seconds: number): string => {
    if (seconds <= 0) return 'Expired';
    if (seconds > 31536000) return 'Permanent';
    const days = Math.floor(seconds / 86400);
    if (days > 0) return `${days}d`;
    const hours = Math.floor(seconds / 3600);
    if (hours > 0) return `${hours}h`;
    const mins = Math.floor(seconds / 60);
    return `${mins}m`;
  };

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'connection', label: 'Connection' },
    { key: 'currency', label: 'Currency' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'network', label: 'Network' },
    { key: 'about', label: 'About' },
  ];

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

      {/* Tab navigation */}
      <div className="flex gap-1 rounded-lg bg-gray-200 dark:bg-dark-elevated p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white dark:bg-dark-muted text-gray-900 dark:text-dark-text shadow-sm'
                : 'text-gray-600 dark:text-dark-mutedText hover:text-gray-900 dark:hover:text-dark-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Connection tab */}
      {activeTab === 'connection' && (
        <div className="space-y-6">
          {/* RPC Connection */}
          <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-text">
              RPC Connection
            </h2>
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Configure your phicoind RPC connection. Changes take effect immediately for the
              current session and persist across page refreshes.
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
                  onChange={(e) => handleChange('host', e.target.value)}
                  placeholder="localhost"
                  className="mt-1 w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
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
                  type="number"
                  value={rpcSettings.port}
                  onChange={(e) => handleChange('port', e.target.value)}
                  placeholder="28966"
                  className="mt-1 w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
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
                  onChange={(e) => handleChange('user', e.target.value)}
                  placeholder="phicoinrpc"
                  className="mt-1 w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="rpc-pass"
                  className="block text-sm font-medium text-gray-700 dark:text-dark-secondary"
                >
                  RPC Password
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="rpc-pass"
                    type={showPassword ? 'text' : 'password'}
                    value={rpcSettings.password}
                    onChange={(e) => handleChange('password', e.target.value)}
                    placeholder="••••••••"
                    className="flex-1 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm text-gray-900 dark:text-dark-text focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="shrink-0 rounded-md border border-gray-300 dark:border-dark-muted px-3 py-2 text-xs font-medium text-gray-600 dark:text-dark-mutedText hover:bg-gray-50 dark:hover:bg-dark-elevated"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
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
                {saved && (
                  <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>
                )}
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

          {/* Display settings */}
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
                <span className="text-sm font-medium text-gray-700 dark:text-dark-secondary">
                  Dark Mode
                </span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Currency / Price tab */}
      {activeTab === 'currency' && (
        <div className="space-y-6">
          {/* Price display */}
          <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-text">
                Market Price
              </h2>
              <button
                onClick={() => fetchPrice()}
                className="rounded-md border border-gray-300 dark:border-dark-muted px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-elevated"
              >
                Refresh
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-600 dark:text-dark-mutedText">
              Current PHICOIN price from explorer.phicoin.net
            </p>

            {cryptoPrice ? (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-elevated p-4">
                    <p className="text-xs text-gray-500 dark:text-dark-mutedText">USD Price</p>
                    <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-dark-text">
                      ${cryptoPrice.lastPriceUsd.toFixed(8)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-elevated p-4">
                    <p className="text-xs text-gray-500 dark:text-dark-mutedText">BTC Price</p>
                    <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-dark-text">
                      ₿{cryptoPrice.lastPriceBtc.toFixed(8)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-dark-mutedText">
                  <span>Source: explorer.phicoin.net</span>
                  <span>Updated: {new Date(cryptoPrice.lastUpdated).toLocaleTimeString()}</span>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-center">
                <p className="text-sm text-gray-500 dark:text-dark-mutedText">
                  Loading price data...
                </p>
                {priceError && (
                  <p className="text-sm text-red-600 dark:text-red-400 mt-2">{priceError}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Notifications tab */}
      {activeTab === 'notifications' && (
        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-text">
            Desktop Notifications
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-dark-mutedText">
            Enable browser notifications to receive alerts for incoming transactions, outgoing
            payments, and new blocks.
          </p>

          <div className="mt-4 space-y-3">
            {notifPermission === 'unsupported' ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Your browser does not support desktop notifications.
              </p>
            ) : notifPermission === 'denied' ? (
              <div>
                <p className="text-sm text-red-600 dark:text-red-400">
                  Notifications are blocked. Please enable them in your browser settings.
                </p>
              </div>
            ) : notifPermission === 'granted' ? (
              <div>
                <p className="text-sm text-green-600 dark:text-green-400">
                  Notifications are enabled. You will receive alerts for wallet activity.
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-600 dark:text-dark-mutedText">
                  Notification permission has not been requested yet.
                </p>
                <button
                  onClick={handleRequestNotifPermission}
                  className="mt-2 rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Enable Notifications
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Network tab - Ban management */}
      {activeTab === 'network' && (
        <div className="space-y-6">
          {/* Add ban */}
          <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-text">Ban Address</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-dark-mutedText">
              Ban an IP address or subnet from connecting to your node. Use CIDR notation for
              subnets (e.g. 192.168.1.0/24).
            </p>
            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Address or subnet (e.g. 10.0.0.1)"
                  value={newBanAddress}
                  onChange={(e) => setNewBanAddress(e.target.value)}
                  className="flex-1 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                />
                <select
                  value={newBanTime}
                  onChange={(e) => setNewBanTime(Number(e.target.value))}
                  className="rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
                >
                  <option value={3600}>1 hour</option>
                  <option value={86400}>24 hours</option>
                  <option value={604800}>7 days</option>
                  <option value={31536000}>1 year</option>
                  <option value={0}>Permanent</option>
                </select>
                <button
                  onClick={handleAddBan}
                  disabled={loadingBans}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {loadingBans ? 'Banning...' : 'Ban'}
                </button>
              </div>
            </div>
          </div>

          {/* Ban list */}
          <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-text">
                Banned Addresses ({bannedList.length})
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => refetchBanned()}
                  disabled={loadingBannedQuery}
                  className="rounded-md border border-gray-300 dark:border-dark-muted px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-elevated disabled:opacity-50"
                >
                  Refresh
                </button>
                <button
                  onClick={handleClearAllBans}
                  disabled={loadingBans || bannedList.length === 0}
                  className="rounded-md border border-red-300 dark:border-red-800 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Ban operation feedback */}
            {banMessage && (
              <p
                className={`mt-3 text-sm ${banMessage.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
              >
                {banMessage.text}
              </p>
            )}

            {loadingBannedQuery ? (
              <p className="mt-3 text-sm text-gray-500 dark:text-dark-mutedText">
                Loading ban list...
              </p>
            ) : bannedList.length === 0 ? (
              <p className="mt-3 text-sm text-gray-400 dark:text-dark-mutedText">
                No addresses are currently banned.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-gray-50 dark:bg-dark-elevated text-gray-500 dark:text-dark-mutedText">
                    <tr>
                      <th className="px-4 py-2 font-medium">Address</th>
                      <th className="px-4 py-2 font-medium text-right">Time Remaining</th>
                      <th className="px-4 py-2 font-medium text-right">Banned Since</th>
                      <th className="px-4 py-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bannedList.map((entry, i) => (
                      <tr
                        key={entry.address}
                        className={`border-b ${i % 2 === 0 ? 'bg-white dark:bg-dark-surface' : 'bg-gray-50 dark:bg-dark-elevated'}`}
                      >
                        <td className="px-4 py-2 font-mono text-xs text-gray-900 dark:text-dark-text">
                          {entry.address}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600 dark:text-dark-mutedText">
                          {formatBanTime(entry.ban_remaining)}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-500 dark:text-dark-mutedText">
                          {new Date(entry.ban_created * 1000).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => handleRemoveBan(entry.address)}
                            disabled={loadingBans}
                            className="text-xs text-phi-primary hover:underline disabled:opacity-50"
                          >
                            Unban
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* About tab */}
      {activeTab === 'about' && (
        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-text">About</h2>
          <div className="mt-4 space-y-1 text-sm text-gray-600 dark:text-dark-mutedText">
            <p>PHICOIN Wallet v0.1.0</p>
            <p>React + TypeScript + Tailwind CSS</p>
            <p>Backend: phicoind (Proof-of-Work, PhihaashV2)</p>
            <p className="pt-2">
              Pure frontend wallet with HD key derivation and raw transaction building.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
