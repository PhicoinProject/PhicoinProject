// TypeScript interfaces for PHICOIN daemon RPC response types.
// These types describe the shape of data returned by the various RPC methods
// exposed by phicoind (Bitcoin Core fork).

// =====================================================================
// Address Index RPC Responses
// =====================================================================

/** Response from `getaddressbalance`. */
export interface AddressBalance {
  /** Balance in satoshis. */
  balance: number;
  /** Balance excluding high-frequency small outputs. */
  high_frequency_balance?: number;
}

/** A single UTXO returned by `getaddressutxos`. */
export interface AddressUtxo {
  /** Transaction ID. */
  txid: string;
  /** Output index (vout). */
  outputIndex: number;
  /** Script pubkey hex. */
  scriptPubKey: string;
  /** Value in satoshis. */
  value: number;
  /** Number of confirmations. */
  confirmations: number;
  /** Whether this output comes from a coinbase transaction. */
  coinbase?: boolean;
  /** Status block height. */
  status?: {
    block_height: number;
    hash: string;
    confirmed: boolean;
  };
}

/** A single mempool entry returned by `getaddressmempool`. */
export interface AddressMempoolEntry {
  /** Transaction ID. */
  txid: string;
  /** Array of transaction IDs blocking this one. */
  blocking?: string[];
}

// =====================================================================
// Raw Transaction RPC Responses
// =====================================================================

/** Response from `getrawtransaction` (verbose mode). */
export interface RawTransactionVerbose {
  txid: string;
  hash?: string;
  size: number;
  weight: number;
  version: number;
  locktime: number;
  vin: unknown[];
  vout: unknown[];
  blockhash?: string;
  confirmations: number;
  time?: number;
  blocktime?: number;
  hex?: string;
}

/** Single entry from `testmempoolaccept`. */
export interface MempoolAcceptEntry {
  txid: string;
  wtxid: string;
  allowed: boolean;
  'reject-reason'?: string;
  reason?: string;
}

/** Response from `estimatesmartfee`. */
export interface EstimateSmartFeeResult {
  /** Fee rate in BTC/kvB (as a decimal string). */
  feerate?: number;
  /** Errors encountered during estimation. */
  errors?: string[];
  /** Whether the transaction is BIP125-replaceable. */
  'bip125-replaceable'?: boolean;
}

/** Response from `signrawtransactionwithkey`. */
export interface SignRawTransactionResult {
  /** Hex-encoded signed transaction. */
  hex: string;
  /** Whether all inputs were successfully signed. */
  complete: boolean;
  /** Errors per input. */
  errors?: Array<{ txid: string; vout: number; scriptSIG: string; sequence: number; error: string }>;
}

/** Response from `decodescript`. */
export interface DecodedScriptResult {
  asm: string;
  type: string;
  p2sh?: string;
  witness_v0_scripthash?: string;
  witness_v1_taproot?: string;
}

// =====================================================================
// Blockchain RPC Responses
// =====================================================================

/** Response from `getblockchaininfo`. */
export interface BlockchainInfo {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
  difficulty: number;
  time: number;
  mediantime: number;
  verificationprogress: number;
  initialblockdownload: boolean;
  chainwork: string;
  size_on_disk: number;
  pruned: boolean;
  softforks?: Record<string, unknown>;
  warnings?: string;
}

/** Response from `getnetworkinfo`. */
export interface NetworkInfo {
  version: number;
  subversion: string;
  protocolversion: number;
  localservices: string;
  localrelay: boolean;
  timeoffset: number;
  connections: number;
  connections_in?: number;
  connections_out?: number;
  networkactive: boolean;
  networks?: unknown[];
  relayfee: number;
  incrementalfee: number;
  localaddresses?: unknown[];
  warnings?: string;
}

/** Response from `getmempoolinfo`. */
export interface MempoolInfo {
  size: number;
  bytes: number;
  maxmempool: number;
  mempoolminfee: number;
  minrelaytxfee: number;
}

/** Response from `getblock` (verbosity 1). */
export interface BlockVerbose {
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

// =====================================================================
// Network / Peer RPC Responses
// =====================================================================

/** Response from `getnettotals`. */
export interface NetTotals {
  totalbytesrecv: number;
  totalbytessent: number;
  timemillis: number;
}

/** A single peer from `getpeerinfo`. */
export interface PeerInfo {
  id: number;
  addr: string;
  addrbind: string;
  addrlocal: string;
  network: string;
  services: string;
  lastsend: number;
  lastrecv: number;
  last_transaction?: number;
  bytessent: number;
  bytesrecv: number;
  conntime: number;
  timeoffset: number;
  pingtime?: number;
  minping?: number;
  version: number;
  subver: string;
  inbound: boolean;
  addnode?: boolean;
  startingheight: number;
  ban_score?: number;
}

/** Response from `getmininginfo`. */
export interface MiningInfo {
  blocks: number;
  currentblockweight?: number;
  currentblocktx: number;
  difficulty: number;
  networkhashps: number;
  pooledtx: number;
  chain: string;
  warnings?: string;
}

/** A single banned entry from `listbanned`. */
export interface BannedEntry {
  address: string;
  ban_entry: number;
  banned_seconds: number;
}

/** A chain tip from `getchaintips`. */
export interface ChainTip {
  height: number;
  hash: string;
  branchlen: number;
  status: string;
}

// =====================================================================
// Batch / Generic Helpers
// =====================================================================

/** Union of known address balance shapes (single vs batch response). */
export type AddressBalanceResult = AddressBalance | { result: AddressBalance };
