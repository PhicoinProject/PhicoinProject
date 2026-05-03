import React, { useState, useRef, useEffect } from 'react';
import { rpc, RpcError } from '@/services/rpc';
import { Badge } from '@/components/common/Badge';

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

  // SECURITY: Block sensitive RPC commands in the console
  const BLOCKED_METHODS = [
    'dumpprivkey',
    'dumpwallet',
    'signrawtransactionwithwallet',
    'signmessage',
    'signmessagewithprivkey',
    'walletpassphrase',
    'walletpassphrasechange',
    'encryptwallet',
    'keypoolrefill',
    'importprivkey',
    'importwallet',
    'importmulti',
    'importaddress',
    'importpubkey',
    'sendfrom',
    'sendmany',
    'sendfromaddress',
    'move',
    'getrawchangeaddress',
    'sendtoaddress',
    'sendrawtransaction',
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
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-dark-mutedText">Commands: {commandCount}</span>
          {lastError && <Badge variant="error">Last error</Badge>}
          <button
            onClick={clearConsole}
            className="rounded-md border border-gray-300 dark:border-dark-muted px-3 py-1 text-xs font-medium text-gray-600 dark:text-dark-mutedText hover:bg-gray-100 dark:hover:bg-dark-elevated"
          >
            Clear
          </button>
        </div>
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
              Note: Sensitive RPC methods (dumpprivkey, signrawtransaction, etc.) are blocked. Use
              phicoin-cli.
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
  );
};

export default RPCConsole;
