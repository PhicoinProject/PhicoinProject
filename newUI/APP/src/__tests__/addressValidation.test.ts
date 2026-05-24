import { describe, it, expect } from '@jest/globals';
import { isValidPHICoinAddress } from '@/services/addressDerivation';

describe('isValidPHICoinAddress (Base58Check)', () => {
  // A real P2PKH address from the test wallet.
  const VALID = 'PrLCb6UXfvvas1phW6zPETcJtXHB7FyxVr';

  it('accepts a valid P-prefixed address', () => {
    expect(isValidPHICoinAddress(VALID)).toBe(true);
  });

  it('rejects a one-character typo (checksum fails)', () => {
    // Flip the last character — charset is still valid but the checksum no longer matches.
    const typo = VALID.slice(0, -1) + (VALID.endsWith('r') ? 's' : 'r');
    expect(isValidPHICoinAddress(typo)).toBe(false);
  });

  it('rejects a transposition typo (checksum fails)', () => {
    const chars = VALID.split('');
    [chars[10], chars[11]] = [chars[11], chars[10]];
    expect(isValidPHICoinAddress(chars.join(''))).toBe(false);
  });

  it('rejects garbage and wrong-prefix strings', () => {
    expect(isValidPHICoinAddress('not-an-address')).toBe(false);
    expect(isValidPHICoinAddress('')).toBe(false);
    // Valid Base58 charset + length but bogus content → checksum fails.
    expect(isValidPHICoinAddress('P' + '1'.repeat(33))).toBe(false);
  });
});
