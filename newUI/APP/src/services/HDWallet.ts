import {
  mnemonicToSeed,
  generateMnemonic as generateMnemonicBip39,
  validateMnemonic,
} from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { BIP39_WORDLIST as wordlist } from './bip39wordlist';
import { toHex } from './crypto';
import { MAINNET_COIN_TYPE, TESTNET_COIN_TYPE } from '@/utils/constants';

/** Generate 24-word BIP39 mnemonic from 256 bits of CSPRNG entropy */
export function generateMnemonicWords(): string {
  return generateMnemonicBip39(wordlist, 256);
}

/** Validate a 24-word mnemonic string */
export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist);
}

/** Derive BIP39 master seed from mnemonic + passphrase (user custom seed) */
export async function deriveMasterSeed(mnemonic: string, passphrase: string): Promise<Uint8Array> {
  return mnemonicToSeed(mnemonic, passphrase);
}

/** Derive BIP32 HDKey from a 512-byte master seed */
export function seedToHDKey(seed: Uint8Array): HDKey {
  return HDKey.fromMasterSeed(seed);
}

/** Derive a child key at a BIP44 path */
export function derivePath(hdKey: HDKey, path: string): HDKey {
  return hdKey.derive(path);
}

// BIP44 receive path: m/44'/coinType'/0'/0/addressIndex. The purpose level is 44'
// to match the PHICOIN Qt/core wallet's HD scheme (src/wallet/wallet.cpp DeriveNewChildKey,
// hdKeypath "m/44'/<ExtCoinType>'/<account>'/<change>/<index>"), so a mnemonic is portable
// between Qt and this wallet. (It previously used 0', which derived different addresses and
// broke seed migration from Qt.)
export function receivePath(coinType: number, index: number): string {
  return `m/44'/${coinType}'/0'/0/${index}`;
}

/** BIP44 change path: m/44'/coinType'/0'/1/addressIndex (matches Qt internal chain). */
export function changePath(coinType: number, index: number): string {
  return `m/44'/${coinType}'/0'/1/${index}`;
}

/** Get coin type for network */
export function getCoinType(network: 'mainnet' | 'testnet'): number {
  return network === 'mainnet' ? MAINNET_COIN_TYPE : TESTNET_COIN_TYPE;
}

/** Convert a BIP32 private key to hex (internal use only) */
export function privateKeyToHex(hdKey: HDKey): string {
  if (!hdKey.privateKey) throw new Error('No private key');
  return toHex(hdKey.privateKey);
}

/** Convert a BIP32 public key to hex */
export function publicKeyToHex(hdKey: HDKey): string {
  if (!hdKey.publicKey) throw new Error('No public key');
  return toHex(hdKey.publicKey);
}

/** Get master key fingerprint (first 4 bytes of chain code) */
export function masterFingerprint(hdKey: HDKey): string {
  if (!hdKey.chainCode) throw new Error('No chain code');
  return toHex(hdKey.chainCode.slice(0, 4));
}
