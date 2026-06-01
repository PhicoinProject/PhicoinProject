import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateMnemonic, validateMnemonic, mnemonicToSeed } from '@scure/bip39';
import { BIP39_WORDLIST } from '@/services/bip39wordlist';
import { toHex } from '@/services/crypto';

// Load the canonical BIP39 English list straight from @scure's shipped file (read via fs to
// avoid the package-subpath module resolution that jest's ESM resolver can't handle).
function loadStandardEnglish(): string[] {
  const js = readFileSync(
    join(process.cwd(), 'node_modules/@scure/bip39/wordlists/english.js'),
    'utf8'
  );
  const m = js.match(/`([^`]*)`/);
  if (!m) throw new Error('could not parse @scure english wordlist');
  return m[1].split('\n').map((s) => s.trim()).filter(Boolean);
}

// The PHICOIN wordlist MUST equal the standard BIP39 English list EXCEPT for the single
// PHICOIN-specific substitution at index 1427 ('phicoin' in place of standard 'raven'),
// matching the C++/Qt wallet's src/wallet/bip39_english.h. This test guards against the list
// silently drifting back to standard (which would break C++<->newUI seed migration) or being
// "re-sorted" alphabetically (which would corrupt the BIP39 index mapping).
const SWAP_INDEX = 1427;
const STANDARD = loadStandardEnglish();

describe('BIP39 wordlist (PHICOIN)', () => {
  it('has exactly 2048 unique words', () => {
    expect(BIP39_WORDLIST).toHaveLength(2048);
    expect(new Set(BIP39_WORDLIST).size).toBe(2048);
  });

  it('substitutes "phicoin" for "raven" at index 1427 (matches C++ bip39_english.h)', () => {
    expect(BIP39_WORDLIST[SWAP_INDEX]).toBe('phicoin');
    expect(BIP39_WORDLIST[SWAP_INDEX - 1]).toBe('rather');
    expect(BIP39_WORDLIST[SWAP_INDEX + 1]).toBe('raw');
    expect(BIP39_WORDLIST.includes('phicoin')).toBe(true);
    expect(BIP39_WORDLIST.includes('raven')).toBe(false);
  });

  it('differs from the standard BIP39 English list ONLY at index 1427', () => {
    expect(STANDARD).toHaveLength(2048);
    expect(STANDARD[SWAP_INDEX]).toBe('raven'); // sanity: standard has the word we replaced
    const diffs: number[] = [];
    for (let i = 0; i < 2048; i++) {
      if (BIP39_WORDLIST[i] !== STANDARD[i]) diffs.push(i);
    }
    expect(diffs).toEqual([SWAP_INDEX]);
  });

  it('round-trips: a generated mnemonic validates and yields a 64-byte seed', async () => {
    const m = generateMnemonic(BIP39_WORDLIST, 256); // 24 words
    expect(m.split(' ')).toHaveLength(24);
    expect(validateMnemonic(m, BIP39_WORDLIST)).toBe(true);
    const seed = await mnemonicToSeed(m);
    expect(seed).toHaveLength(64);
  });

  it('mnemonicToSeed still matches the canonical BIP39 vector (PBKDF2 is wordlist-independent)', async () => {
    // Standard BIP39 test vector (Trezor): all-"abandon"+"about", passphrase "TREZOR".
    const m =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const seed = await mnemonicToSeed(m, 'TREZOR');
    expect(toHex(seed)).toBe(
      'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04'
    );
  });
});
