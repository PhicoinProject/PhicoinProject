import React, { useState, useRef, useEffect, useCallback } from 'react';
import { rpc, RpcError } from '@/services/rpc';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';

/** Safe accessor for `Record<string, unknown>` network info — avoids `as any`. */
function netInfo(networkInfo: Record<string, unknown> | null, key: string, fallback = '-'): string {
  if (!networkInfo) return fallback;
  const v = networkInfo[key];
  if (v === undefined || v === null) return fallback;
  return String(v);
}

/** RPC Console page -- interactive RPC command interface (Qt parity: rpcconsole) */
export const RPCConsole: React.FC = () => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const [commandCount, setCommandCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // SECURITY: Block sensitive RPC commands in the console.
  // Mirrors the rpc.ts BLOCKED_METHODS set for defense in depth.
  const BLOCKED_METHODS = [
    // Key extraction
    'dumpprivkey',
    'dumpwallet',
    // Daemon-side signing
    'signrawtransactionwithwallet',
    'signmessage',
    'signmessagewithprivkey',
    // Wallet encryption
    'walletpassphrase',
    'walletpassphrasechange',
    'encryptwallet',
    'keypoolrefill',
    // Import
    'importprivkey',
    'importwallet',
    'importmulti',
    'importaddress',
    'importpubkey',
    // Wallet sends
    'sendfrom',
    'sendmany',
    'sendfromaddress',
    'move',
    'sendtoaddress',
    // Wallet queries
    'getbalance',
    'getwalletinfo',
    'listtransactions',
    'listreceivedbyaddress',
    'getreceivedbyaddress',
    'listaccounts',
    'listsinceblock',
    'gettransaction',
    'getnewaddress',
    'listunspent',
    // Wallet management
    'getrawchangeaddress',
    'setlabel',
    'validateaddress',
    'lockunspent',
    // Transaction ops
    'bumpfee',
    'fundrawtransaction',
    'rescanblockchain',
    'abandontransaction',
    // Multisig
    'addmultisigaddress',
    'listmyassets',
    // Asset writes (wallet-bound)
    'issue',
    'issueunique',
    'reissue',
    'transfer',
    'transferfromaddress',
    'transferfromaddresses',
    'transferqualifier',
    'issuerestrictedasset',
    'issuequalifierasset',
    'reissuerestrictedasset',
    'addtagtoaddress',
    'removetagfromaddress',
    'freezeaddress',
    'unfreezeaddress',
    'freezerestrictedasset',
    'unfreezerestrictedasset',
    // Rewards/snapshots
    'distributereward',
    'requestsnapshot',
    'purgesnapshot',
    // Message channels
    'subscribetochannel',
    'unsubscribefromchannel',
    'transferwithmessage',
    'viewallmessages',
    'viewallmessagechannels',
    // Dangerous ops
    'invalidateblock',
    'preciousblock',
    'reconsiderblock',
    'pruneblockchain',
    'clearmempool',
    'savemempool',
    'prioritisetransaction',
    'setmocktime',
    'submitblock',
    'generate',
    'generatetoaddress',
    'setgenerate',
    'getgenerate',
    'stop',
  ];

  /**
   * Parse an RPC command line into method + params.
   * Handles bracket-delimited JSON so that `listmyassets [""] true`
   * is parsed correctly as method="listmyassets", params=[]+true.
   */
  function parseRpcCommand(line: string): [string, unknown[]] {
    line = line.trim();
    // Method is everything before the first whitespace
    const spaceIdx = line.search(/\s/);
    if (spaceIdx === -1) return [line, []];

    const method = line.slice(0, spaceIdx);
    const rest = line.slice(spaceIdx + 1).trim();
    if (!rest) return [method, []];

    // Collect tokens respecting bracket nesting
    const tokens: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of rest) {
      if (ch === '[' || ch === '{') {
        depth++;
        current += ch;
      } else if (ch === ']' || ch === '}') {
        depth--;
        current += ch;
      } else if (ch === ' ' && depth === 0) {
        if (current) tokens.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current) tokens.push(current);

    // Join tokens into a single string and try to parse as a JSON array
    const joined = tokens.join('');
    try {
      const parsed = JSON.parse(joined);
      return [method, Array.isArray(parsed) ? parsed : [parsed]];
    } catch {
      // If not a valid JSON array, treat each token as a separate param
      return [method, tokens];
    }
  }

  const executeCommand = async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    // Check if the command is a blocked method
    const firstWord = trimmed.split(/\s+/)[0];
    if (BLOCKED_METHODS.includes(firstWord)) {
      setOutput((prev) => [
        ...prev,
        `$ ${trimmed}`,
        `SECURITY: Method "${firstWord}" is blocked in the web UI. Use phicoin-cli for sensitive operations.`,
      ]);
      return;
    }

    setLastError(null);
    setOutput((prev) => [...prev, `$ ${trimmed}`]);
    setHistory((prev) => [...prev, trimmed]);
    setHistoryIndex(-1);
    setCommandCount((c) => c + 1);

    const startTime = performance.now();

    try {
      const [method, params] = parseRpcCommand(trimmed);

      const result = await rpc.raw(method, params);
      const elapsed = Math.round(performance.now() - startTime);
      setOutput((prev) => [
        ...prev,
        JSON.stringify(result, null, 2),
        `(completed in ${elapsed}ms)`,
      ]);
    } catch (err: unknown) {
      const elapsed = Math.round(performance.now() - startTime);
      let msg = '';
      if (err instanceof RpcError) {
        msg = `RPC Error ${err.code}: ${err.message}`;
      } else if (err instanceof Error) {
        msg = err.message;
      } else {
        msg = String(err);
      }
      setLastError(msg);
      setOutput((prev) => [...prev, `Error: ${msg}`, `(failed in ${elapsed}ms)`]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeCommand(input);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex >= 0) {
        const newIndex = historyIndex + 1;
        if (newIndex >= history.length) {
          setHistoryIndex(-1);
          setInput('');
        } else {
          setHistoryIndex(newIndex);
          setInput(history[newIndex]);
        }
      }
    }
  };

  const clearConsole = () => {
    setOutput([]);
    setCommandCount(0);
    setLastError(null);
  };

  // ---- Ban List Management ----
  interface BanEntry {
    address: string;
    ban_until: number;
    banned_by: string;
    ban_reason: string;
  }

  const [activeTab, setActiveTab] = useState<'console' | 'bans' | 'peers' | 'network'>('console');
  const [banList, setBanList] = useState<BanEntry[]>([]);
  const [banLoading, setBanLoading] = useState(false);
  const [banIp, setBanIp] = useState('');
  const [banCooldown, setBanCooldown] = useState<number>(86400);
  const [banActionLoading, setBanActionLoading] = useState(false);

  const fetchBanList = useCallback(async () => {
    setBanLoading(true);
    try {
      const result = await rpc.raw<BanEntry[]>('listbanned');
      setBanList(Array.isArray(result) ? result : []);
    } catch {
      setBanList([]);
    } finally {
      setBanLoading(false);
    }
  }, []);

  const handleBan = async () => {
    if (!banIp.trim()) return;
    setBanActionLoading(true);
    try {
      await rpc.raw('setban', [banIp.trim(), 'ban', banCooldown]);
      setBanIp('');
      await fetchBanList();
    } catch {
      // RPC error handled silently
    } finally {
      setBanActionLoading(false);
    }
  };

  const handleUnban = async (address: string) => {
    try {
      await rpc.raw('setban', [address, 'unban']);
      await fetchBanList();
    } catch {
      // RPC error handled silently
    }
  };

  // Load ban list when tab switches
  useEffect(() => {
    if (activeTab === 'bans') {
      fetchBanList();
    }
  }, [activeTab, fetchBanList]);

  // ---- Peers Tab ----
  interface PeerEntry {
    addr: string;
    addrLocal?: string;
    services?: string;
    relaytxes?: boolean;
    lastsend?: number;
    lastrecv?: number;
    bytessent?: number;
    bytesrecv?: number;
    conntime?: number;
    timeoffset?: number;
    version?: number;
    subver?: string;
    inbound?: boolean;
    minconnect?: number;
    connectiontype?: string;
  }

  const [peerList, setPeerList] = useState<PeerEntry[]>([]);
  const [peerLoading, setPeerLoading] = useState(false);
  const [networkInfo, setNetworkInfo] = useState<Record<string, unknown> | null>(null);

  const fetchPeerList = useCallback(async () => {
    setPeerLoading(true);
    try {
      const result = await rpc.raw<PeerEntry[]>('getpeerinfo');
      setPeerList(Array.isArray(result) ? result : []);
    } catch {
      setPeerList([]);
    } finally {
      setPeerLoading(false);
    }
  }, []);

  const fetchNetworkInfo = useCallback(async () => {
    try {
      const result = await rpc.raw('getnetworkinfo');
      setNetworkInfo(result as Record<string, unknown>);
    } catch {
      // Silent
    }
  }, []);

  // Load peers and network info when tab switches
  useEffect(() => {
    if (activeTab === 'peers') {
      fetchPeerList();
      fetchNetworkInfo();
    }
  }, [activeTab, fetchPeerList, fetchNetworkInfo]);

  const quickCommands = [
    { label: 'getblockcount', cmd: 'getblockcount' },
    { label: 'getbalance', cmd: 'getbalance' },
    { label: 'getnetworkinfo', cmd: 'getnetworkinfo' },
    { label: 'getmininginfo', cmd: 'getmininginfo' },
    { label: 'getwalletinfo', cmd: 'getwalletinfo' },
    { label: 'listmyassets', cmd: 'listmyassets [""] true' },
    { label: 'listassets', cmd: 'listassets ["", true, 10, 0]' },
    { label: 'help', cmd: 'help' },
    { label: 'getmempoolinfo', cmd: 'getmempoolinfo' },
    { label: 'listunspent', cmd: 'listunspent' },
  ];

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">RPC Console</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-200 dark:bg-dark-elevated p-1 w-fit">
        {[
          { key: 'console' as const, label: 'Console' },
          { key: 'peers' as const, label: 'Peers' },
          { key: 'bans' as const, label: 'Ban List' },
          { key: 'network' as const, label: 'Network' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white dark:bg-dark-muted text-gray-900 dark:text-dark-text shadow-sm'
                : 'text-gray-600 dark:text-dark-mutedText hover:text-gray-900 dark:hover:text-dark-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'console' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500 dark:text-dark-mutedText">
                Commands: {commandCount}
              </span>
              {lastError && <Badge variant="error">Last error</Badge>}
            </div>
            <button
              onClick={clearConsole}
              className="rounded-md border border-gray-300 dark:border-dark-muted px-3 py-1 text-xs font-medium text-gray-600 dark:text-dark-mutedText hover:bg-gray-100 dark:hover:bg-dark-elevated"
            >
              Clear
            </button>
          </div>

          {/* Quick commands */}
          <div className="flex flex-wrap gap-2">
            {quickCommands.map((cmd) => (
              <button
                key={cmd.cmd}
                onClick={() => executeCommand(cmd.cmd)}
                className="rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-1 text-xs font-mono text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-muted"
              >
                {cmd.label}
              </button>
            ))}
          </div>

          {/* Output */}
          <div
            ref={outputRef}
            className="min-h-[400px] max-h-[600px] overflow-y-auto rounded-lg border bg-gray-900 p-4 font-mono text-sm text-green-400"
          >
            {output.length === 0 && (
              <div className="text-gray-500 space-y-1">
                <p>PHICOIN RPC Console</p>
                <p>Type a command or use quick buttons above.</p>
                <p className="text-gray-600">Usage: method_name [params as JSON array]</p>
                <p className="text-gray-600">Examples: getblockcount, getnetworkinfo</p>
                <p className="text-amber-500 mt-2">
                  Note: Sensitive RPC methods (dumpprivkey, signrawtransaction, etc.) are blocked.
                  Use phicoin-cli.
                </p>
              </div>
            )}
            {output.map((line, i) => {
              if (line.startsWith('$')) {
                return (
                  <div key={i} className="text-cyan-400">
                    {line}
                  </div>
                );
              }
              if (line.startsWith('Error:')) {
                return (
                  <div key={i} className="text-red-400">
                    {line}
                  </div>
                );
              }
              if (line.startsWith('(')) {
                return (
                  <div key={i} className="text-gray-500">
                    {line}
                  </div>
                );
              }
              return (
                <div key={i} className="whitespace-pre-wrap">
                  {line}
                </div>
              );
            })}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="rpc_command [params]"
              className="flex-1 rounded-md border border-gray-300 bg-gray-900 px-3 py-2 font-mono text-sm text-white placeholder-gray-500 focus:border-phi-primary focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              className="rounded-md bg-phi-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Run
            </button>
          </form>
        </div>
      )}

      {/* Peers Tab */}
      {activeTab === 'peers' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-3 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-dark-mutedText">Version</p>
              <p className="text-sm font-mono font-semibold text-gray-900 dark:text-dark-text">
                {String(netInfo(networkInfo, 'version'))}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-3 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-dark-mutedText">Connections</p>
              <p className="text-2xl font-bold text-green-600">
                {netInfo(networkInfo, 'connections', String(peerList.length))}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-3 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-dark-mutedText">Protocol</p>
              <p className="text-sm font-mono font-semibold text-gray-900 dark:text-dark-text">
                v{netInfo(networkInfo, 'protocolversion')}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-3 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-dark-mutedText">Network</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-dark-text capitalize">
                {netInfo(networkInfo, 'network')}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-dark-secondary">
                Connected Peers ({peerList.length})
              </h2>
              <Button variant="secondary" size="sm" onClick={fetchPeerList}>
                Refresh
              </Button>
            </div>
            {peerLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner />
              </div>
            ) : peerList.length === 0 ? (
              <p className="p-4 text-sm text-gray-500 dark:text-dark-mutedText">
                No connected peers.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-gray-50 dark:bg-dark-elevated text-gray-500 dark:text-dark-mutedText">
                    <tr>
                      <th className="px-4 py-2 font-medium">Address</th>
                      <th className="px-4 py-2 font-medium">Dir</th>
                      <th className="px-4 py-2 font-medium">Services</th>
                      <th className="px-4 py-2 font-medium">Version</th>
                      <th className="px-4 py-2 font-medium">Subver</th>
                      <th className="px-4 py-2 font-medium text-right">Sent / Recv</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peerList.map((peer, i) => (
                      <tr
                        key={peer.addr + i}
                        className={`border-b ${i % 2 === 0 ? 'bg-white dark:bg-dark-surface' : 'bg-gray-50 dark:bg-dark-elevated'}`}
                      >
                        <td className="px-4 py-2 font-mono text-xs text-gray-900 dark:text-dark-text">
                          {peer.addr}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant={peer.inbound ? 'warning' : 'success'}>
                            {peer.inbound ? 'In' : 'Out'}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-dark-mutedText">
                          {peer.services || '-'}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-dark-mutedText">
                          {peer.version ?? '-'}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-dark-mutedText">
                          {peer.subver || '-'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-dark-mutedText">
                          {(peer.bytessent ?? 0).toLocaleString()} /{' '}
                          {(peer.bytesrecv ?? 0).toLocaleString()}
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

      {/* Ban List Tab */}
      {activeTab === 'bans' && (
        <div className="space-y-4">
          {/* Ban IP Form */}
          <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-dark-secondary mb-3">
              Ban IP Address
            </h2>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="IP address"
                value={banIp}
                onChange={(e) => setBanIp(e.target.value)}
                className="flex-1 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
              />
              <input
                type="number"
                placeholder="Cooldown (seconds)"
                value={banCooldown}
                onChange={(e) => setBanCooldown(Number(e.target.value))}
                className="w-32 rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-elevated px-3 py-2 text-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary"
              />
              <Button
                variant="primary"
                onClick={handleBan}
                disabled={!banIp.trim() || banActionLoading}
              >
                {banActionLoading ? 'Banning...' : 'Ban'}
              </Button>
            </div>
          </div>

          {/* Ban List */}
          <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-dark-secondary">
                Banned Addresses ({banList.length})
              </h2>
              <Button variant="secondary" size="sm" onClick={fetchBanList}>
                Refresh
              </Button>
            </div>
            {banLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner />
              </div>
            ) : banList.length === 0 ? (
              <p className="p-4 text-sm text-gray-500 dark:text-dark-mutedText">
                No banned addresses.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-gray-50 dark:bg-dark-elevated text-gray-500 dark:text-dark-mutedText">
                    <tr>
                      <th className="px-4 py-2 font-medium">Address</th>
                      <th className="px-4 py-2 font-medium">Banned By</th>
                      <th className="px-4 py-2 font-medium">Reason</th>
                      <th className="px-4 py-2 font-medium">Ban Until</th>
                      <th className="px-4 py-2 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {banList.map((entry, i) => (
                      <tr
                        key={entry.address + i}
                        className={`border-b ${i % 2 === 0 ? 'bg-white dark:bg-dark-surface' : 'bg-gray-50 dark:bg-dark-elevated'}`}
                      >
                        <td className="px-4 py-2 font-mono text-xs text-gray-900 dark:text-dark-text">
                          {entry.address}
                        </td>
                        <td className="px-4 py-2 text-gray-600 dark:text-dark-mutedText">
                          {entry.banned_by}
                        </td>
                        <td className="px-4 py-2 text-gray-600 dark:text-dark-mutedText">
                          {entry.ban_reason || '—'}
                        </td>
                        <td className="px-4 py-2 text-gray-600 dark:text-dark-mutedText">
                          {entry.ban_until === 0
                            ? 'Permanent'
                            : new Date(entry.ban_until * 1000).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleUnban(entry.address)}
                          >
                            Unban
                          </Button>
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

      {/* Network Tab */}
      {activeTab === 'network' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-3 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-dark-mutedText">Inbound</p>
              <p className="text-2xl font-bold text-amber-600">
                {peerList.filter((p) => p.inbound).length}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-3 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-dark-mutedText">Outbound</p>
              <p className="text-2xl font-bold text-green-600">
                {peerList.filter((p) => !p.inbound).length}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-3 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-dark-mutedText">Total Data</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-dark-text">
                {peerList
                  .reduce((s, p) => s + (p.bytessent ?? 0) + (p.bytesrecv ?? 0), 0)
                  .toLocaleString()}{' '}
                bytes
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-3 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-dark-mutedText">Network</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-dark-text capitalize">
                {netInfo(networkInfo, 'network')}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-dark-secondary mb-3">
              Network Traffic
            </h3>
            {peerList.length > 0 ? (
              <div className="space-y-2">
                {peerList.map((peer, i) => {
                  const total = (peer.bytessent ?? 0) + (peer.bytesrecv ?? 0);
                  const pct = total > 0 ? Math.min(100, total / 10000) : 0;
                  return (
                    <div key={peer.addr + i} className="flex items-center gap-2">
                      <div className="w-8 text-xs font-mono text-gray-500 dark:text-dark-mutedText">
                        {peer.inbound ? '↓' : '↑'}
                      </div>
                      <div className="flex-1 bg-gray-200 dark:bg-dark-muted rounded-full h-4 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${peer.inbound ? 'bg-blue-500' : 'bg-green-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="w-28 text-xs font-mono text-gray-600 dark:text-dark-mutedText text-right">
                        {(total / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-dark-mutedText">No peers connected.</p>
            )}
          </div>

          {networkInfo && (
            <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-dark-secondary mb-3">
                Network Details
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500 dark:text-dark-mutedText">Protocol:</span>{' '}
                  <span className="font-mono">{String(networkInfo.protocolversion ?? '-')}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-dark-mutedText">Relay Fee:</span>{' '}
                  <span className="font-mono">{netInfo(networkInfo, 'relayfee', '- BTC/kB')}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-dark-mutedText">Total Sent:</span>{' '}
                  <span className="font-mono">
                    {netInfo(networkInfo, 'totalbytessent', '-')} bytes
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-dark-mutedText">Total Received:</span>{' '}
                  <span className="font-mono">
                    {netInfo(networkInfo, 'totalbytesrecv', '-')} bytes
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RPCConsole;
