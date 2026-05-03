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

// Query defaults
export const DEFAULT_PAGE_SIZE = 10;
export const TRANSACTION_LOAD_MORE = 50;
