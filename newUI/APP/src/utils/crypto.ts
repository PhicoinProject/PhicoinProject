import { MAINNET_ADDRESS_PREFIXES, TESTNET_ADDRESS_PREFIXES, SATOSHI_MULTIPLIER } from './constants';

/** Cryptographic utility functions */

/**
 * Validate a PHICOIN address format.
 * PHICOIN addresses start with 'P' for pubkey addresses and 'H' for script addresses.
 */
export function isValidPhicoinAddress(address: string, network: 'mainnet' | 'testnet' = 'mainnet'): boolean {
  if (!address) return false;
  const prefixes = network === 'mainnet' ? MAINNET_ADDRESS_PREFIXES : TESTNET_ADDRESS_PREFIXES;
  return prefixes.some((prefix) => address.startsWith(prefix));
}

/**
 * Format a raw amount (satoshis-like smallest unit) to human-readable PHI.
 * PHICOIN uses 8 decimal places like Bitcoin.
 */
export function satoshisToPhi(satoshis: number | bigint): string {
  const value = typeof satoshis === 'bigint' ? satoshis.toString() : String(satoshis);
  const num = parseFloat(value);
  return (num / SATOSHI_MULTIPLIER).toFixed(8).replace(/\.?0+$/, '');
}

/**
 * Convert human-readable PHI amount to satoshis.
 */
export function phiToSatoshis(phi: number | string): number {
  const value = typeof phi === 'string' ? parseFloat(phi) : phi;
  return Math.round(value * SATOSHI_MULTIPLIER);
}
