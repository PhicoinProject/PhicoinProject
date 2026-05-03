import { isValidPhicoinAddress, satoshisToPhi, phiToSatoshis } from '../../src/utils/crypto';
import { formatDate, truncate, formatConfirmations } from '../../src/utils/format';

describe('crypto utilities', () => {
  test('isValidPhicoinAddress accepts mainnet P addresses', () => {
    expect(isValidPhicoinAddress('PHomeAddress...')).toBe(true);
  });

  test('isValidPhicoinAddress accepts mainnet H addresses', () => {
    expect(isValidPhicoinAddress('HScriptAddress...')).toBe(true);
  });

  test('isValidPhicoinAddress rejects invalid addresses', () => {
    expect(isValidPhicoinAddress('1InvalidAddress')).toBe(false);
  });

  test('satoshisToPhi converts correctly', () => {
    expect(satoshisToPhi(100000000)).toBe('1');
    expect(satoshisToPhi(50000000)).toBe('0.5');
  });

  test('phiToSatoshis converts correctly', () => {
    expect(phiToSatoshis(1)).toBe(100000000);
    expect(phiToSatoshis(0.5)).toBe(50000000);
  });
});

describe('format utilities', () => {
  test('truncate shortens long strings', () => {
    const long = 'abcdef0123456789abcdef';
    const result = truncate(long, 4, 4);
    expect(result).toBe('abcd...6789');
  });

  test('formatConfirmations shows unconfirmed', () => {
    expect(formatConfirmations(0)).toBe('Unconfirmed');
  });

  test('formatConfirmations shows confirmed', () => {
    expect(formatConfirmations(10)).toBe('Confirmed');
  });
});
