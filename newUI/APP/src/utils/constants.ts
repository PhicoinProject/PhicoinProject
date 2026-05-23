/** Application-wide constants */

// Network
export const DEFAULT_RPC_PORT = 28966;
export const DEFAULT_P2P_PORT = 28964;
export const DEFAULT_RPC_HOST = 'localhost';

// Blockchain
export const CONFIRMATION_TARGET = 6;
export const SATOSHI_MULTIPLIER = 1e8;
export const PHICOID_DECIMAL_PLACES = 8;

// Polling intervals (ms)
export const BALANCE_POLL_INTERVAL = 15_000;
export const TRANSACTION_POLL_INTERVAL = 15_000;
export const NETWORK_STATUS_POLL_INTERVAL = 15_000;
export const MEMPOOL_POLL_INTERVAL = 15_000;
export const BLOCK_HEIGHT_POLL_INTERVAL = 15_000;
export const MINING_INFO_POLL_INTERVAL = 30_000;
export const ASSET_STALE_TIME = 60_000;
export const DATA_STALE_TIME = 30_000;

// Display
export const APP_VERSION = 'v0.1.0';
export const TRUNCATE_START = 8;
export const TRUNCATE_END = 8;

// Address prefixes
export const MAINNET_ADDRESS_PREFIXES = ['P', 'H'] as const;
export const TESTNET_ADDRESS_PREFIXES = ['n', 'm', '2'] as const;

// Asset status values
export const ASSET_STATUS_ISSUED = 'ISSUED';
export const ASSET_STATUS_REVOKED = 'REVOKED';

// Key derivation (matching Bitcoin Core scrypt parameters)
export const SCRYPT_PARAMS = { n: 16384, r: 8, p: 1 };

// V2 wallet encryption
export const WALLET_KDF_ITERATIONS = 1_000_000;

// HD wallet coin types (from chainparams.cpp)
export const MAINNET_COIN_TYPE = 0;
export const TESTNET_COIN_TYPE = 1;

/**
 * Network type identifier.
 */
export type NetworkType = 'mainnet' | 'testnet';

/**
 * Per-network parameters (coin type, address version bytes, prefixes).
 * Centralizes values that were previously hardcoded across services so that
 * adding/switching networks is a single-file change. Values come from
 * PHICOIN chainparams.cpp.
 */
export interface NetworkParams {
  /** BIP44 coin type used in derivation path m/0'/coinType'/0'/change/index */
  coinType: number;
  /** Base58Check version byte for P2PKH ('P' addresses) */
  pubKeyHashVersion: number;
  /** Base58Check version byte for P2SH ('H' addresses) */
  scriptHashVersion: number;
  /** Human-readable part for native SegWit (bech32) addresses */
  bech32Prefix: string;
  /** Accepted Base58 address leading characters */
  addressPrefixes: readonly string[];
  /**
   * Asset issuance burn output scriptPubKey (P2PKH hex). The issuance burn fee
   * is paid to this script. Stored as the exact script hex to avoid any
   * address-encoding round-trip mismatch. Mainnet burn address:
   * PkC3bSAjN99cFg9yQbPYn5sQ89Gnvnnmcf.
   */
  assetBurnScriptPubKey: string;
}

export const MAINNET: NetworkParams = {
  coinType: MAINNET_COIN_TYPE,
  pubKeyHashVersion: 0x38, // 56 -> 'P'
  scriptHashVersion: 0x10, // 16 -> 'H'
  bech32Prefix: 'PHC',
  addressPrefixes: MAINNET_ADDRESS_PREFIXES,
  assetBurnScriptPubKey: '76a9148684a6449c157dd0a2f393fc5147e47cd4fd9f2588ac',
};

export const TESTNET: NetworkParams = {
  coinType: TESTNET_COIN_TYPE,
  pubKeyHashVersion: 0x6f,
  scriptHashVersion: 0xc4,
  bech32Prefix: 'tphc',
  addressPrefixes: TESTNET_ADDRESS_PREFIXES,
  assetBurnScriptPubKey: '',
};

/**
 * The active network. Defaults to mainnet. A future testnet switch only needs
 * to change this binding (or make it configurable) — services read network
 * parameters exclusively through {@link getNetworkParams} / {@link NETWORK}.
 */
export const ACTIVE_NETWORK: NetworkType = 'mainnet';

/** Resolve the parameters for a given network (defaults to the active one). */
export function getNetworkParams(network: NetworkType = ACTIVE_NETWORK): NetworkParams {
  return network === 'testnet' ? TESTNET : MAINNET;
}

/** Parameters for the currently active network. */
export const NETWORK: NetworkParams = getNetworkParams();

// Query defaults
export const DEFAULT_PAGE_SIZE = 10;
export const TRANSACTION_LOAD_MORE = 50;
