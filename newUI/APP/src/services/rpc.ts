import axios, { AxiosInstance } from 'axios';
import type { RpcConfig, RpcRequest, RpcResponse } from '@/types';

/** RPC methods that are blocked in the web UI for security reasons. */
const BLOCKED_METHODS = new Set([
  // Private key extraction
  'dumpprivkey',
  'dumpwallet',
  'signrawtransactionwithwallet',
  'signmessage',
  'signmessagewithprivkey',
  // Wallet encryption / passphrase management
  'walletpassphrase',
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
]);

/**
 * In dev mode (Vite HMR), allow non-localhost hosts for Docker networking.
 * In production builds, only localhost is permitted.
 */
const isDevMode = import.meta.env.DEV;

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
  host: import.meta.env.VITE_RPC_HOST ?? 'localhost',
  port: Number(import.meta.env.VITE_RPC_PORT) ?? 28966,
  user: import.meta.env.VITE_RPC_USER ?? '',
  password: import.meta.env.VITE_RPC_PASSWORD ?? '',
};

/** JSON-RPC client for phicoind */
export class RpcClient {
  private client: AxiosInstance;
  private idCounter = 0;

  constructor(config: Partial<RpcConfig> = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    assertLocalhost(cfg.host);
    // In dev mode, use the Vite proxy to avoid CORS and inject auth headers
    const url = isDevMode ? '/api' : `http://${cfg.host}:${cfg.port}`;

    this.client = axios.create({
      baseURL: url,
      auth: cfg.user ? { username: cfg.user, password: cfg.password } : undefined,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30_000,
    });
  }

  /**
   * SECURITY: Block sensitive RPC methods from the web UI.
   * Private key extraction, wallet dumping, and raw signing must happen
   * via phicoin-cli on the host machine, never in the browser.
   */
  private assertAllowedMethod(method: string): void {
    if (BLOCKED_METHODS.has(method)) {
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
        throw new Error(`RPC connection failed: ${err.message}`);
      }
      throw err;
    }
  }

  // ---- Wallet queries ----

  async getBalance(): Promise<number> {
    return this.raw<number>('getbalance');
  }

  async getWalletInfo(): Promise<unknown> {
    return this.raw<unknown>('getwalletinfo');
  }

  async getNewAddress(label?: string): Promise<string> {
    const params: unknown[] = [];
    if (label) params.push(label);
    return this.raw<string>('getnewaddress', params);
  }

  /**
   * REMOVED: dumpPubKey (dumpprivkey) — private key extraction is not
   * allowed in the web UI. Use phicoin-cli dumpprivkey instead.
   */

  async listAddresses(): Promise<unknown[]> {
    return this.raw<unknown[]>('listreceivedbyaddress', [0, true, false]);
  }

  // ---- Transactions ----

  async sendToAddress(destination: string, amount: number, comment?: string): Promise<string> {
    return this.raw<string>('sendtoaddress', [destination, amount, comment || '', '', false]);
  }

  async getTransaction(txid: string): Promise<unknown> {
    return this.raw<unknown>('gettransaction', [txid]);
  }

  async listTransactions(label?: string, count = 10, from = 0): Promise<unknown[]> {
    return this.raw<unknown[]>('listtransactions', [label, count, from, false]);
  }

  async decodeRawTransaction(hex: string): Promise<unknown> {
    return this.raw<unknown>('decoderawtransaction', [hex]);
  }

  /**
   * REMOVED: signRawTransactionWithWallet — signing is not allowed in the
   * web UI. Use phicoin-cli instead.
   */

  async sendRawTransaction(hex: string): Promise<string> {
    return this.raw<string>('sendrawtransaction', [hex]);
  }

  // ---- Blockchain ----

  async getBlockCount(): Promise<number> {
    return this.raw<number>('getblockcount');
  }

  async getBlockHash(height: number): Promise<string> {
    return this.raw<string>('getblockhash', [height]);
  }

  async getBlock(hash: string, verbosity = 1): Promise<unknown> {
    return this.raw<unknown>('getblock', [hash, verbosity]);
  }

  async getMempoolInfo(): Promise<unknown> {
    return this.raw<unknown>('getmempoolinfo');
  }

  async estimateSmartFee(confTarget = 6): Promise<unknown> {
    return this.raw<unknown>('estimatesmartfee', [confTarget]);
  }

  // ---- Assets ----

  async listAssets(): Promise<unknown[]> {
    return this.raw<unknown[]>('listassets', ['', true, 1000, 0]);
  }

  async getAsset(assetId: string): Promise<unknown> {
    return this.raw<unknown>('getassetdata', [assetId]);
  }

  async listAssetTransactions(_assetId: string, _count = 10, _from = 0): Promise<unknown[]> {
    // listassettransactions RPC method does not exist on phicoin daemon
    return [];
  }

  async listUnspentAsset(_assetId: string, _minConf = 0, _maxConf = 9999999): Promise<unknown[]> {
    // listunspentasset RPC method does not exist on phicoin daemon
    return [];
  }

  async issueAsset(
    assetName: string,
    qty: number,
    toAddress = '',
    changeAddress = '',
    units = 8,
    reissuable = false,
    hasIPFS = false,
    ipfsHash = ''
  ): Promise<string> {
    return this.raw<string>('issue', [
      assetName,
      qty,
      toAddress,
      changeAddress,
      units,
      reissuable,
      hasIPFS,
      ipfsHash,
    ]);
  }

  /**
   * Transfer an asset to an address.
   * Signature: transfer(asset_name, qty, to_address, message, expire_time, change_address, asset_change_address)
   */
  async transferAsset(
    assetName: string,
    qty: number,
    toAddress: string,
    message = '',
    expireTime = 0,
    changeAddress = '',
    assetChangeAddress = ''
  ): Promise<string> {
    return this.raw<string>('transfer', [
      assetName,
      qty,
      toAddress,
      message,
      expireTime,
      changeAddress,
      assetChangeAddress,
    ]);
  }

  /**
   * List asset balances for a specific address.
   * Signature: listassetbalancesbyaddress(address, onlytotal, count, start)
   */
  async getAssetBalances(address: string): Promise<unknown[]> {
    return this.raw<unknown[]>('listassetbalancesbyaddress', [address, false, 1000, 0]);
  }

  // ---- Network ----

  async getNetworkInfo(): Promise<unknown> {
    return this.raw<unknown>('getnetworkinfo');
  }

  async getPeerInfo(): Promise<unknown[]> {
    return this.raw<unknown[]>('getpeerinfo');
  }

  // ---- UTXO ----

  async listUnspent(minConf = 0, maxConf = 9999999): Promise<unknown[]> {
    return this.raw<unknown[]>('listunspent', [minConf, maxConf]);
  }

  // ---- Mining ----

  async getMiningInfo(): Promise<unknown> {
    return this.raw<unknown>('getmininginfo');
  }

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

/** Default singleton instance */
export const rpc = new RpcClient();
