import axios, { AxiosInstance } from 'axios';
import type { RpcConfig, RpcRequest, RpcResponse } from '@/types';

/**
 * RPC methods that are blocked in the web UI for security reasons.
 *
 * SECURITY (P4): this is the single source of truth for the blocklist. The RPC
 * Console imports the same Set so it cannot drift from the transport-layer
 * guard. All entries MUST be lower-case — the guard lower-cases the incoming
 * method before checking membership so case variants (e.g. "DumpPrivKey")
 * cannot bypass it.
 */
export const BLOCKED_METHODS = new Set([
  // Private key extraction
  'dumpprivkey',
  'dumpwallet',
  'signrawtransactionwithwallet',
  'signrawtransactionwithkey',
  'signrawtransactionwithprivkey',
  'signmessage',
  'signmessagewithprivkey',
  // Wallet encryption / passphrase management
  'walletpassphrase',
  'walletlock',
  'walletpassphrasechange',
  'encryptwallet',
  'keypoolrefill',
  // Import operations (private key / wallet data)
  'importprivkey',
  'importwallet',
  'importmulti',
  'importaddress',
  'importpubkey',
  // Deprecated send methods
  'sendfrom',
  'sendmany',
  'sendfromaddress',
  'move',
  // Address generation that could expose change addresses
  'getrawchangeaddress',
  // Wallet balance and info queries
  'getbalance',
  'getwalletinfo',
  // Wallet transaction queries
  'listtransactions',
  'listreceivedbyaddress',
  'getreceivedbyaddress',
  'listaccounts',
  'listsinceblock',
  'gettransaction',
  'getnewaddress',
  // Wallet address management
  'setlabel',
  'validateaddress',
  // Wallet signing
  'signrawtransactionwithwallet',
  // UTXO management
  'listunspent',
  'lockunspent',
  // Transaction operations
  'bumpfee',
  'fundrawtransaction',
  'rescanblockchain',
  'sendtoaddress',
  // Multisig
  'addmultisigaddress',
  // Wallet-scoped asset listing
  'listmyassets',
  // Transaction recovery
  'abandontransaction',
  // Asset issuance (wallet-bound)
  'issue',
  'issueunique',
  'reissue',
  'issuerestrictedasset',
  'issuequalifierasset',
  'reissuerestrictedasset',
  // Asset transfers (wallet-bound)
  'transfer',
  'transferfromaddress',
  'transferfromaddresses',
  'transferqualifier',
  // Address tagging
  'addtagtoaddress',
  'removetagfromaddress',
  // Asset freezing
  'freezeaddress',
  'unfreezeaddress',
  'freezerestrictedasset',
  'unfreezerestrictedasset',
  // Reward distribution (write)
  'distributereward',
  // Snapshot management (write)
  'requestsnapshot',
  'purgesnapshot',
  // Message channels (write)
  'subscribetochannel',
  'unsubscribefromchannel',
  'transferwithmessage',
  // Message channels (read, wallet-bound)
  'viewallmessages',
  'viewallmessagechannels',
  // Dangerous blockchain operations
  'invalidateblock',
  'preciousblock',
  'reconsiderblock',
  'pruneblockchain',
  'clearmempool',
  'savemempool',
  'prioritisetransaction',
  'setmocktime',
  // Dangerous mining operations
  'submitblock',
  'generate',
  'generatetoaddress',
  'setgenerate',
  'getgenerate',
  // Dangerous utility
  'stop',
  // Additional wallet-bound methods
  'getreceivedbyaccount',
  'listreceivedbyaccount',
  'disconnectnode',
  'addnode',
  'getaddednodeinfo',
]);

/**
 * Read a Vite env var safely. import.meta.env is only available in Vite builds;
 * during Jest tests it is undefined, so we return the fallback.
 */
function viteEnv(key: string, fallback: string): string {
  try {
    const env: Record<string, unknown> = import.meta.env;
    const val = env?.[key];
    if (val && typeof val === 'string') return val;
    if (val !== undefined) return String(val);
  } catch {
    // ignore
  }
  return fallback;
}

/**
 * In dev mode (Vite HMR), allow non-localhost hosts for Docker networking.
 * In production builds, only localhost is permitted.
 */
const isDevMode = typeof import.meta.env !== 'undefined'
  ? (import.meta.env.DEV === true || import.meta.env.MODE === 'development')
  : false;

/**
 * In dev mode, allow Docker container names and any hostname.
 * In production, only localhost/loopback addresses are permitted.
 */
function assertLocalhost(host: string): void {
  if (isDevMode) return; // Docker dev networking allows container names
  const allowedHosts = ['localhost', '127.0.0.1', '::1'];
  if (!allowedHosts.includes(host.toLowerCase())) {
    throw new Error(
      `SECURITY: RPC host must be localhost or a loopback address. ` +
        `Refused connection to "${host}". Configure VITE_RPC_HOST or use the local daemon.`
    );
  }
}

const DEFAULT_CONFIG: RpcConfig = {
  host: viteEnv('VITE_RPC_HOST', 'localhost'),
  port: Number(viteEnv('VITE_RPC_PORT', '28966')),
  user: viteEnv('VITE_RPC_USER', ''),
  password: viteEnv('VITE_RPC_PASSWORD', ''),
};

/** localStorage key for user-saved RPC config */
export const RPC_CONFIG_KEY = 'phi:rpcConfig';

/** JSON-RPC client for phicoind */
export class RpcClient {
  private client!: AxiosInstance;
  private idCounter = 0;
  private config: RpcConfig;

  constructor(config: Partial<RpcConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initClient(this.config);
  }

  /** Re-create the axios client with the given config */
  private initClient(cfg: RpcConfig) {
    assertLocalhost(cfg.host);
    // In dev mode, always use the Vite proxy to handle CORS.
    // Direct browser requests to the daemon will be blocked by CORS.
    // The proxy injects auth headers and forwards to the daemon.
    const useProxy = isDevMode;
    const url = useProxy ? '/api' : `http://${cfg.host}:${cfg.port}`;

    this.client = axios.create({
      baseURL: url,
      auth: !useProxy && cfg.user ? { username: cfg.user, password: cfg.password } : undefined,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30_000,
    });
  }

  /** Update RPC config at runtime and re-create the axios client */
  setConfig(newConfig: Partial<RpcConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.initClient(this.config);
  }

  /** Return a copy of the current RPC config */
  getConfig(): RpcConfig {
    return { ...this.config };
  }

  /**
   * SECURITY: Block sensitive RPC methods from the web UI.
   * Private key extraction, wallet dumping, and raw signing must happen
   * via phicoin-cli on the host machine, never in the browser.
   */
  private assertAllowedMethod(method: string): void {
    // SECURITY (P4): normalize case so variants like "DumpPrivKey" or
    // "DUMPWALLET" cannot slip past the lower-case blocklist entries.
    if (BLOCKED_METHODS.has(method.trim().toLowerCase())) {
      throw new Error(
        `SECURITY: RPC method "${method}" is blocked in the web UI. ` +
          `Use phicoin-cli for sensitive operations.`
      );
    }
  }

  /** Send a raw JSON-RPC request */
  async raw<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    this.assertAllowedMethod(method);
    const request: RpcRequest = {
      jsonrpc: '2.0',
      id: String(++this.idCounter),
      method,
      params,
    };

    try {
      const res = await this.client.post<RpcResponse<T>>('/', request);
      if (res.data.error) {
        throw new RpcError(res.data.error.code, res.data.error.message);
      }
      return res.data.result;
    } catch (err) {
      if (err instanceof RpcError) throw err;
      if (axios.isAxiosError(err)) {
        // Some daemons return JSON-RPC errors with HTTP 500 — extract and throw
        // those as proper RpcErrors so the caller sees the daemon's error message.
        const data = err.response?.data;
        if (data && typeof data === 'object' && 'error' in data && data.error) {
          throw new RpcError(
            Number(data.error.code ?? -1),
            String(data.error.message ?? 'unknown')
          );
        }
        // For non-JSON-RPC errors, capture whatever body we can for debugging
        let detail = err.message;
        if (data) {
          try {
            const body = typeof data === 'string' ? data : JSON.stringify(data);
            detail = body.substring(0, 300);
          } catch { /* ignore */ }
        }
        throw new Error(
          `RPC "${method}" failed: HTTP ${err.response?.status} — ${detail}`
        );
      }
      throw err;
    }
  }

  /**
   * Execute many JSON-RPC calls in a SINGLE HTTP request (JSON-RPC 2.0 batch).
   *
   * The daemon accepts an array of request objects and returns an array of
   * responses (httprpc.cpp routes arrays to JSONRPCExecBatch). This collapses N
   * HTTP round-trips into one, bypassing the browser's ~6-connections-per-host
   * limit — the difference between a fluid asset page and a ~20s freeze when a
   * page needs dozens of per-address / per-asset lookups (each fast on the daemon
   * but serialized by the connection pool when fired as separate requests).
   *
   * Results are returned in the SAME order as `calls`, matched by id. A per-call
   * error (or missing/short response) yields null for that slot, mirroring the
   * `.catch(() => null)` resilience callers used with individual requests. Large
   * batches are chunked so one oversized request can't be rejected wholesale.
   */
  async rawBatch<T = unknown>(
    calls: { method: string; params?: unknown[] }[],
    chunkSize = 50
  ): Promise<(T | null)[]> {
    if (calls.length === 0) return [];
    for (const c of calls) this.assertAllowedMethod(c.method);

    const out: (T | null)[] = [];
    for (let i = 0; i < calls.length; i += chunkSize) {
      const chunk = calls.slice(i, i + chunkSize);
      const requests: RpcRequest[] = chunk.map((c) => ({
        jsonrpc: '2.0',
        id: String(++this.idCounter),
        method: c.method,
        params: c.params ?? [],
      }));
      try {
        const res = await this.client.post<RpcResponse<T>[]>('/', requests);
        const data = Array.isArray(res.data) ? res.data : [];
        const byId = new Map<string, RpcResponse<T>>();
        for (const r of data) byId.set(String(r.id), r);
        for (const req of requests) {
          const r = byId.get(req.id);
          out.push(r && !r.error ? r.result : null);
        }
      } catch {
        for (let k = 0; k < chunk.length; k++) out.push(null);
      }
    }
    return out;
  }

  // ---- Address index queries ----

  /**
   * Get the total received balance for a single address.
   * Calls: getaddressbalance (address-index)
   */
  async getAddressBalance(address: string): Promise<unknown> {
    return this.raw<unknown>('getaddressbalance', [address]);
  }

  /**
   * Get the COMBINED balance/received for many addresses in a SINGLE RPC call.
   *
   * The daemon's getaddressbalance accepts the {addresses:[...]} object form and
   * sums `balance`/`received` (in satoshis) across every address into one object
   * (see src/rpc/misc.cpp getaddressbalance, non-asset branch). Unused/empty
   * addresses simply contribute 0 (GetAddressIndex returns success with no
   * entries), so this is equivalent to summing per-address balances but uses one
   * round-trip instead of N. Use this when you only need the aggregate total.
   *
   * NOTE: this returns a single combined total and CANNOT be used to attribute a
   * balance to an individual address — use {@link getAddressBalanceBatch} for
   * per-address results.
   */
  async getAddressBalanceCombined(addresses: string[]): Promise<{ balance: number; received: number }> {
    if (addresses.length === 0) return { balance: 0, received: 0 };
    const result = await this.raw<unknown>('getaddressbalance', [{ addresses }]);
    const data: Record<string, unknown> =
      result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
    return {
      balance: Number(data.balance ?? 0),
      received: Number(data.received ?? 0),
    };
  }

  /**
   * Get the total received balance for multiple addresses (batched).
   * Calls getaddressbalance for each address and returns a map.
   */
  async getAddressBalanceBatch(addresses: string[]): Promise<Record<string, unknown>> {
    if (addresses.length === 0) return {};
    // Call getaddressbalance individually for each address to get accurate
    // per-address balances. The batch RPC form returns a combined total that
    // cannot be correctly distributed per-address.
    const results: Record<string, unknown> = {};
    await Promise.all(
      addresses.map(async (addr) => {
        try { results[addr] = await this.getAddressBalance(addr); }
        catch { results[addr] = { balance: 0, received: 0 }; }
      })
    );
    return results;
  }

  /**
   * Get all unspent outputs for a single address.
   * Calls: getaddressutxos (address-index)
   */
  async getAddressUTXOs(address: string): Promise<unknown[]> {
    return this.raw<unknown[]>('getaddressutxos', [{ addresses: [address] }]) ?? [];
  }

  /**
   * Get all unspent outputs for multiple addresses (batched).
   * Calls getaddressutxos for each address.
   */
  async getAddressUTXOsBatch(addresses: string[]): Promise<unknown[]> {
    if (addresses.length === 0) return [];
    try {
      return (await this.raw<unknown[]>('getaddressutxos', [{ addresses }])) ?? [];
    } catch {
      const all: unknown[] = [];
      await Promise.all(
        addresses.map(async (addr) => {
          try {
            const utxos = await this.getAddressUTXOs(addr);
            all.push(...(utxos as unknown[]));
          } catch { /* skip */ }
        })
      );
      return all;
    }
  }

  /**
   * Get all transaction IDs for a single address.
   * Calls: getaddresstxids (address-index)
   */
  async getAddressTxIds(address: string): Promise<string[]> {
    return this.raw<string[]>('getaddresstxids', [address]);
  }

  /**
   * Get all transaction IDs for multiple addresses (batched).
   * Calls getaddresstxids for each address.
   */
  async getAddressTxIdsBatch(addresses: string[]): Promise<string[]> {
    const all: string[] = [];
    await Promise.all(
      addresses.map(async (addr) => {
        try {
          const txids = await this.getAddressTxIds(addr);
          all.push(...txids);
        } catch {
          // Skip addresses with no txids or errors
        }
      })
    );
    return all;
  }

  /**
   * Get all mempool transactions for a single address.
   * Calls: getaddressmempool (address-index)
   */
  async getAddressMempool(address: string): Promise<unknown[]> {
    return this.raw<unknown[]>('getaddressmempool', [address]);
  }

  /**
   * Get all mempool transactions for multiple addresses (batched).
   */
  async getAddressMempoolBatch(addresses: string[]): Promise<unknown[]> {
    if (addresses.length === 0) return [];
    try {
      return (await this.raw<unknown[]>('getaddressmempool', [{ addresses }])) ?? [];
    } catch {
      const all: unknown[] = [];
      await Promise.all(
        addresses.map(async (addr) => {
          try {
            const entries = await this.getAddressMempool(addr);
            all.push(...(entries as unknown[]));
          } catch { /* skip */ }
        })
      );
      return all;
    }
  }

  // ---- Raw transaction operations ----

  /**
   * Get a raw transaction by txid.
   * Verbose 0: hex string, Verbose 1: JSON, Verbose 2: JSON with hex.
   * Calls: getrawtransaction
   */
  async getRawTransaction(txid: string, verbose = 2): Promise<unknown> {
    return this.raw<unknown>('getrawtransaction', [txid, verbose]);
  }

  /**
   * Submit a raw transaction to the mempool and relay network.
   * Calls: testmempoolaccept
   */
  async testMempoolAccept(rawTx: string, allowHighFees = false): Promise<unknown[]> {
    return this.raw<unknown[]>('testmempoolaccept', [[rawTx], allowHighFees]);
  }

  /**
   * Decode a script hex string.
   * Calls: decodescript
   */
  async decodeScript(hex: string): Promise<unknown> {
    return this.raw<unknown>('decodescript', [hex]);
  }

  /**
   * Create a raw transaction.
   * Calls: createrawtransaction
   */
  async createRawTransaction(
    inputs: Array<{ txid: string; vout: number }>,
    outputs: Record<string, number>,
    locktime = 0,
    replaceable = false
  ): Promise<string> {
    const params: unknown[] = [inputs, outputs];
    if (locktime > 0) params.push(locktime);
    if (replaceable) params.push(replaceable);
    return this.raw<string>('createrawtransaction', params);
  }

  /**
   * @deprecated SECURITY (P4): `signrawtransactionwithkey` is now in
   * BLOCKED_METHODS, so this will throw. Private keys must never be sent to the
   * daemon from the browser — sign locally via `txSigner.signRawTransaction`
   * (pure @noble) instead. Kept only to document the blocked surface.
   * Calls: signrawtransactionwithkey
   */
  async signRawTransactionWithPrivkeys(
    hex: string,
    prevTxs: unknown[] = [],
    privKeys: string[] = []
  ): Promise<unknown> {
    return this.raw<unknown>('signrawtransactionwithkey', [hex, privKeys, prevTxs]);
  }

  /**
   * Decode a raw transaction hex into its JSON representation.
   * Calls: decoderawtransaction
   */
  async decodeRawTransaction(hex: string): Promise<unknown> {
    return this.raw<unknown>('decoderawtransaction', [hex]);
  }

  /**
   * Broadcast a signed raw transaction to the network.
   * Calls: sendrawtransaction
   */
  async sendRawTransaction(hex: string, allowHighFees = true): Promise<string> {
    return this.raw<string>('sendrawtransaction', [hex, allowHighFees]);
  }

  /**
   * Estimate a smart fee rate for a given confirmation target.
   * Calls: estimatesmartfee
   */
  async estimateSmartFee(confTarget = 6): Promise<unknown> {
    return this.raw<unknown>('estimatesmartfee', [confTarget]);
  }

  // ---- Blockchain queries ----

  /**
   * Get detailed blockchain state information.
   * Calls: getblockchaininfo
   */
  async getBlockchainInfo(): Promise<unknown> {
    return this.raw<unknown>('getblockchaininfo');
  }

  /**
   * Get the current block count.
   * Calls: getblockcount
   */
  async getBlockCount(): Promise<number> {
    return this.raw<number>('getblockcount');
  }

  /**
   * Get a block hash by height.
   * Calls: getblockhash
   */
  async getBlockHash(height: number): Promise<string> {
    return this.raw<string>('getblockhash', [height]);
  }

  /**
   * Get a block by hash.
   * Calls: getblock
   */
  async getBlock(hash: string, verbosity = 1): Promise<unknown> {
    return this.raw<unknown>('getblock', [hash, verbosity]);
  }

  /**
   * Get a block header by hash.
   * Calls: getblockheader
   */
  async getBlockHeader(hash: string, verbose = true): Promise<unknown> {
    return this.raw<unknown>('getblockheader', [hash, verbose]);
  }

  /**
   * Get the best (tip) block hash.
   * Calls: getbestblockhash
   */
  async getBestBlockHash(): Promise<string> {
    return this.raw<string>('getbestblockhash');
  }

  /**
   * Get the current network difficulty.
   * Calls: getdifficulty
   */
  async getDifficulty(): Promise<number> {
    return this.raw<number>('getdifficulty');
  }

  /**
   * Get all chain tips (potential forks).
   * Calls: getchaintips
   */
  async getChainTips(): Promise<unknown[]> {
    return this.raw<unknown[]>('getchaintips');
  }

  // ---- Mempool queries ----

  /**
   * Get mempool information.
   * Calls: getmempoolinfo
   */
  async getMempoolInfo(): Promise<unknown> {
    return this.raw<unknown>('getmempoolinfo');
  }

  /**
   * Get all transaction IDs in the mempool, or full entries if verbose.
   * Calls: getrawmempool
   */
  async getRawMempool(verbose = false): Promise<unknown> {
    return this.raw<unknown>('getrawmempool', [verbose]);
  }

  /**
   * Get detailed mempool data for a single transaction.
   * Calls: getmempoolentry
   */
  async getMempoolEntry(txid: string): Promise<unknown> {
    return this.raw<unknown>('getmempoolentry', [txid]);
  }

  // ---- Asset queries (non-wallet) ----

  /**
   * List all assets on the blockchain (not wallet-scoped).
   * Calls: listassets
   */
  async listAssets(): Promise<unknown[]> {
    return this.raw<unknown[]>('listassets', ['', true, 1000, 0]);
  }

  /**
   * Get data about a specific asset by its ID.
   * Calls: getassetdata
   */
  async getAsset(assetId: string): Promise<unknown> {
    return this.raw<unknown>('getassetdata', [assetId]);
  }

  /**
   * List asset balances for a specific address.
   * Calls: listassetbalancesbyaddress
   * Returns: { assetName: balance, "ASSET!": ownerBalance, ... }
   */
  async getAssetBalances(address: string): Promise<Record<string, number>> {
    return this.raw<Record<string, number>>('listassetbalancesbyaddress', [address, false, 1000, 0]) || {};
  }

  // ---- Network queries ----

  /**
   * Get network connection information.
   * Calls: getnetworkinfo
   */
  async getNetworkInfo(): Promise<unknown> {
    return this.raw<unknown>('getnetworkinfo');
  }

  /**
   * Get peer connection details.
   * Calls: getpeerinfo
   */
  async getPeerInfo(): Promise<unknown[]> {
    return this.raw<unknown[]>('getpeerinfo');
  }

  /**
   * Get network byte totals (received / sent).
   * Calls: getnettotals
   */
  async getNetTotals(): Promise<unknown> {
    return this.raw<unknown>('getnettotals');
  }

  // ---- Ban management ----

  /**
   * Add, remove, or update a ban on a subnet or address.
   * Commands: "add", "remove", "flush".
   * Calls: setban
   */
  async setBan(
    subnet: string,
    command: string,
    bantime?: number,
    absolute?: boolean
  ): Promise<boolean> {
    const params: unknown[] = [subnet, command];
    if (command === 'add' && bantime !== undefined) params.push(bantime);
    if (command === 'add' && absolute !== undefined) params.push(absolute);
    return this.raw<boolean>('setban', params);
  }

  /**
   * List all banned addresses/subnets.
   * Calls: listbanned
   */
  async listBanned(): Promise<unknown[]> {
    return this.raw<unknown[]>('listbanned');
  }

  /**
   * Clear all banned addresses.
   * Calls: clearbanned
   */
  async clearBanned(): Promise<boolean> {
    return this.raw<boolean>('clearbanned');
  }

  /**
   * Ping other nodes to measure latency.
   * Calls: ping
   */
  async ping(): Promise<void> {
    return this.raw<void>('ping');
  }

  /**
   * Get address deltas (efficient balance change tracking).
   * Calls: getaddressdeltas
   */
  async getAddressDeltas(addresses: string[]): Promise<unknown[]> {
    try {
      return (await this.raw<unknown[]>('getaddressdeltas', [{ addresses }])) ?? [];
    } catch {
      // Not all versions support getaddressdeltas
      return [];
    }
  }

  // ---- Message sign/verify (pure computation, no wallet.dat) ----

  /**
   * Sign a message with a private key (for message sign/verify feature).
   * Calls: signmessage (note: this signs locally, not wallet-bound)
   * NOTE: This should only be called via the local messageSigner, not RPC.
   */
  async signMessage(_address: string, _message: string): Promise<string> {
    // Deliberately not calling RPC — use messageSigner.ts instead
    throw new Error('Use messageSigner.sign() for local message signing');
  }

  /**
   * Verify a message signature (pure computation, safe for public node).
   * Calls: verifymessage (read-only, does not touch wallet)
   */
  async verifyMessage(address: string, signature: string, message: string): Promise<boolean> {
    try {
      const result = await this.raw<boolean>('verifymessage', [address, signature, message]);
      return !!result;
    } catch {
      return false;
    }
  }

  // ---- Utility ----

  /**
   * Get help information for an RPC command.
   * Calls: help
   */
  async help(command?: string): Promise<string> {
    if (command) {
      return this.raw<string>('help', [command]);
    }
    return this.raw<string>('help');
  }

  // ---- Mining ----

  /**
   * Get mining-related information.
   * Calls: getmininginfo
   */
  async getMiningInfo(): Promise<unknown> {
    return this.raw<unknown>('getmininginfo');
  }

  /**
   * Get a block template for mining.
   * Calls: getblocktemplate
   */
  async getBlockTemplate(): Promise<unknown> {
    return this.raw<unknown>('getblocktemplate', [{ mode: 'template' }]);
  }
}

/** Custom RPC error class */
export class RpcError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(`RPC Error ${code}: ${message}`);
    this.code = code;
    this.name = 'RpcError';
  }
}

/**
 * Load user-saved RPC config from localStorage (if any) and apply it to the singleton.
 * This lets Settings page changes persist across page refreshes.
 */
function loadSavedRpcConfig(client: RpcClient): void {
  try {
    const raw = localStorage.getItem(RPC_CONFIG_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<RpcConfig>;
    if (saved.host || typeof saved.port === 'number' || saved.user || saved.password !== undefined) {
      client.setConfig({
        host: saved.host,
        port: typeof saved.port === 'number' ? saved.port : Number(saved.port),
        user: saved.user,
        password: saved.password,
      });
    }
  } catch {
    // ignore corrupt localStorage
  }
}

/** Default singleton instance */
export const rpc = new RpcClient();
loadSavedRpcConfig(rpc);
