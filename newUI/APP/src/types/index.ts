// Blockchain and wallet type definitions for PHICOIN wallet

/** A unspent transaction output */
export interface UTXO {
  txid: string;
  vout: number;
  scriptPubKey: string;
  amount: number;
  confirmations: number;
  coinbase: boolean;
  assetLabel?: string;
  assetAmount?: AssetAmount;
}

/** An address on the PHICOIN network */
export interface Address {
  address: string;
  label: string;
  isMine: boolean;
  isWatchOnly: boolean;
  balance: number;
  totalReceived: number;
  txids: string[];
}

/** A blockchain transaction */
export interface Transaction {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: Vin[];
  vout: Vout[];
  hex?: string;
  blockhash?: string;
  confirmations: number;
  time: number;
  blocktime: number;
  assetDetails?: AssetTransactionDetail[];
}

/** Input of a transaction */
export interface Vin {
  txid: string;
  vout: number;
  scriptSig?: {
    asm: string;
    hex: string;
  };
  witnesses?: string[];
  coinbase?: string;
  sequence: number;
}

/** Output of a transaction */
export interface Vout {
  value: number;
  n: number;
  scriptPubKey: {
    asm: string;
    desc: string;
    hex: string;
    address?: string;
    type: string;
  };
  assetLabel?: string;
  assetAmount?: AssetAmount[];
}

/** PHICOIN native asset */
export interface Asset {
  assetId: string;
  assetLabel: string;
  status: string;
  assetTx: string;
  nonce: number;
  precision: number;
  previousAmount: number;
  previousTransactions: number;
  ipfsHash?: string;
}

/** Asset amount with optional lot data (for NFTs) */
export interface AssetAmount {
  assetId: string;
  amount: number;
  slot: number;
  entropy: string;
  assetLabel?: string;
}

/** Asset transfer detail on a transaction */
export interface AssetTransactionDetail {
  assetId: string;
  assetLabel: string;
  amount: number;
  in: number;
  out: number;
  transfer: number;
  generation: number;
}

/** Wallet state managed by Zustand */
export interface WalletState {
  unlocked: boolean;
  walletName: string;
  balances: Record<string, number>;
  phiBalance: number;
  addresses: Address[];
  currentAddress: string;
  network: 'mainnet' | 'testnet';
  syncStatus: {
    blocks: number;
    headers: number;
    synced: boolean;
  };
  lastBlockHeight: number;
  error: string | null;
}

/** RPC response envelope */
export interface RpcResponse<T = unknown> {
  jsonrpc: string;
  id: string;
  result: T;
  error?: RpcError;
}

/** RPC error structure */
export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** RPC request */
export interface RpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

/** RPC server configuration */
export interface RpcConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

/** Block header information */
export interface BlockHeader {
  hash: string;
  confirmations: number;
  strippedsize: number;
  size: number;
  weight: number;
  height: number;
  version: number;
  versionHex: string;
  merkleroot: string;
  tx: string[];
  time: number;
  mediantime: number;
  nonce: number;
  bits: string;
  difficulty: number;
  chainwork: string;
  nTx: number;
  previousblockhash?: string;
  nextblockhash?: string;
}

/** Balance information */
export interface Balance {
  phi: number;
  trusted: number;
  untrusted: number;
  immature: number;
}

/** Send transaction parameters */
export interface SendParams {
  destination: string;
  amount: number;
  assetId?: string;
  subtractFeeFromAmount?: boolean;
  comment?: string;
}

/** Recent transaction for the dashboard */
export interface RecentTransaction extends Transaction {
  direction: 'in' | 'out';
  displayAmount: string;
  formattedDate: string;
}
