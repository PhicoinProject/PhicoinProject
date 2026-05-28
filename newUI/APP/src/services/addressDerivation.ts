import { HDKey } from '@scure/bip32';
import { base58, bech32 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { getCoinType, receivePath, changePath } from './HDWallet';
import { NETWORK } from '@/utils/constants';
import type { DerivedAddress } from '@/types';

// PHICOIN network address parameters, sourced from the centralized network
// config so a future network switch is a single-file change.
const PUB_KEY_HASH = NETWORK.pubKeyHashVersion; // 'P' prefix for P2PKH
const SCRIPT_HASH = NETWORK.scriptHashVersion; // 'H' prefix for P2SH
const BECH32_PREFIX = NETWORK.bech32Prefix; // Bech32 HRP for SegWit addresses

/** Address type enum */
export type AddressType = 'p2pkh' | 'p2wpkh' | 'p2sh-p2wpkh';

/**
 * Compute hash160 (RIPEMD160(SHA256(data))) - standard Bitcoin address hashing.
 */
function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

/**
 * Create a Base58Check-encoded address from a public key hash and version byte.
 * Format: [version][hash160][checksum(4)]
 */
function base58CheckEncode(version: number, data: Uint8Array): string {
  // Payload: version + data
  const payload = new Uint8Array(1 + data.length);
  payload[0] = version;
  payload.set(data, 1);

  // Checksum: first 4 bytes of SHA256(SHA256(payload))
  const hash1 = sha256(payload);
  const hash2 = sha256(hash1);
  const checksum = hash2.slice(0, 4);

  // Append checksum
  const withChecksum = new Uint8Array(payload.length + 4);
  withChecksum.set(payload);
  withChecksum.set(checksum, payload.length);

  return base58.encode(withChecksum);
}

/**
 * Create a P2PKH scriptPubKey from a compressed public key.
 * Script: OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
 */
function scriptPubKeyFromPubKey(pubKey: Uint8Array): Uint8Array {
  const h160 = hash160(pubKey);
  const script = new Uint8Array(25);
  script[0] = 0x76; // OP_DUP
  script[1] = 0xa9; // OP_HASH160
  script[2] = 0x14; // push 20 bytes
  script.set(h160, 3);
  script[23] = 0x88; // OP_EQUALVERIFY
  script[24] = 0xac; // OP_CHECKSIG
  return script;
}

/**
 * Derive a P2PKH address from an HDKey at a given derivation path.
 * Returns Base58Check-encoded PHICOIN address starting with 'P'.
 */
export function deriveAddress(hdKey: HDKey, path: string): string {
  return deriveAddressByType(hdKey, path, 'p2pkh');
}

/**
 * Derive an address of the specified type from an HDKey.
 * - p2pkh: Legacy P2PKH (Base58Check, 'P' prefix)
 * - p2wpkh: Native SegWit (Bech32, 'PHC1' prefix)
 * - p2sh-p2wpkh: Nested SegWit (Base58Check, 'H' prefix)
 */
export function deriveAddressByType(
  hdKey: HDKey,
  path: string,
  type: AddressType = 'p2pkh'
): string {
  const derived = hdKey.derive(path);
  const publicKey = derived.publicKey;
  if (!publicKey) throw new Error('No public key derived');

  const compressedPubKey = compressPublicKey(publicKey);
  const h160 = hash160(compressedPubKey);

  switch (type) {
    case 'p2pkh':
      return base58CheckEncode(PUB_KEY_HASH, h160);

    case 'p2wpkh': {
      // P2WPKH: witness version 0 + witness program (hash160)
      const witnessProgram = new Uint8Array(21);
      witnessProgram[0] = 0; // witness version 0
      witnessProgram.set(h160, 1);
      return bech32.encode(BECH32_PREFIX, witnessProgram);
    }

    case 'p2sh-p2wpkh': {
      // P2SH-P2WPKH: wrap P2WPKH witness script in P2SH
      const witnessScript = new Uint8Array(22);
      witnessScript[0] = 0; // OP_0
      witnessScript.set(h160, 1);
      const redeemHash = hash160(witnessScript);
      return base58CheckEncode(SCRIPT_HASH, redeemHash);
    }

    default:
      return base58CheckEncode(PUB_KEY_HASH, h160);
  }
}

/**
 * Create a P2WPKH scriptPubKey from a compressed public key.
 * Script: OP_0 <pubKeyHash>
 */
export function scriptPubKeyFromPubKeyP2WPKH(pubKey: Uint8Array): Uint8Array {
  const h160 = hash160(pubKey);
  const script = new Uint8Array(22);
  script[0] = 0x00; // OP_0
  script.set(h160, 1);
  return script;
}

/**
 * Create a P2SH-P2WPKH scriptPubKey from a compressed public key.
 * OP_HASH160 <hash160(OP_0 <pubKeyHash>)> OP_EQUAL
 */
export function scriptPubKeyFromPubKeyP2SHP2WPKH(pubKey: Uint8Array): Uint8Array {
  const witnessScript = scriptPubKeyFromPubKeyP2WPKH(pubKey);
  return getP2SHScriptPubKey(witnessScript);
}

/** Derive a receive address at m/44'/coinType'/0'/0/index */
export function deriveReceiveAddress(
  hdKey: HDKey,
  network: 'mainnet' | 'testnet',
  index: number
): DerivedAddress {
  const coinType = getCoinType(network);
  const path = receivePath(coinType, index);
  const addr = deriveAddress(hdKey, path);

  return {
    address: addr,
    path,
    index,
    isChange: false,
    network: coinType,
    label: `Receive ${index}`,
  };
}

/** Derive a change address at m/44'/coinType'/0'/1/index */
export function deriveChangeAddress(
  hdKey: HDKey,
  network: 'mainnet' | 'testnet',
  index: number
): DerivedAddress {
  const coinType = getCoinType(network);
  const path = changePath(coinType, index);
  const addr = deriveAddress(hdKey, path);

  return {
    address: addr,
    path,
    index,
    isChange: true,
    network: coinType,
    label: `Change ${index}`,
  };
}

/**
 * Derive a contiguous range of addresses on ONE BIP44 chain efficiently.
 *
 * deriveReceiveAddress/deriveChangeAddress re-derive the full path from the master
 * key on every call — for m/44'/coinType'/0'/{chain}/index that is 5 deriveChild ops
 * per address (3 of them hardened, the expensive kind). A gap-limit pool scan derives
 * 100+ addresses across both chains, so re-doing the hardened m/44'/coinType'/0' prefix
 * every time dominates wall-clock time (~8s measured; the RPC is not the bottleneck).
 *
 * Here we derive the chain node m/44'/coinType'/0'/{chain} ONCE, then take only the
 * non-hardened leaf child per index — ~1 op per address instead of 5. BIP32 guarantees
 * chainNode.deriveChild(i) equals deriving the full path, so addresses are identical
 * (covered by addressDerivation.test).
 */
export function deriveAddressRange(
  hdKey: HDKey,
  network: 'mainnet' | 'testnet',
  isChange: boolean,
  startIndex: number,
  count: number
): DerivedAddress[] {
  const coinType = getCoinType(network);
  const chain = isChange ? 1 : 0;
  const chainNode = hdKey.derive(`m/44'/${coinType}'/0'/${chain}`);
  const out: DerivedAddress[] = [];
  for (let k = 0; k < count; k++) {
    const index = startIndex + k;
    const leaf = chainNode.deriveChild(index);
    if (!leaf.publicKey) throw new Error('No public key derived');
    const h160 = hash160(compressPublicKey(leaf.publicKey));
    out.push({
      address: base58CheckEncode(PUB_KEY_HASH, h160),
      path: `m/44'/${coinType}'/0'/${chain}/${index}`,
      index,
      isChange,
      network: coinType,
      label: `${isChange ? 'Change' : 'Receive'} ${index}`,
    });
  }
  return out;
}

/** Generate a pool of unused receive addresses */
export function deriveAddressPool(
  hdKey: HDKey,
  network: 'mainnet' | 'testnet',
  start: number,
  count: number
): DerivedAddress[] {
  const addresses: DerivedAddress[] = [];
  for (let i = start; i < start + count; i++) {
    addresses.push(deriveReceiveAddress(hdKey, network, i));
  }
  return addresses;
}

/**
 * Compress a public key if uncompressed.
 * @scure/bip32 returns 33-byte compressed keys by default.
 */
function compressPublicKey(pubKey: Uint8Array): Uint8Array {
  if (pubKey.length === 33) return pubKey;
  if (pubKey.length === 65) {
    const parity = pubKey[64] & 1;
    const compressed = new Uint8Array(33);
    compressed[0] = parity === 0 ? 0x02 : 0x03;
    compressed.set(pubKey.slice(1, 33), 1);
    return compressed;
  }
  throw new Error(`Invalid public key length: ${pubKey.length}`);
}

/**
 * Verify an address is a valid PHICOIN Base58Check address.
 * Checks version byte (P2PKH = 0x37, P2SH = 0x3c).
 */
export function isValidPHICoinAddress(address: string): boolean {
  if (!address || address.length < 20 || address.length > 40) return false;
  try {
    const decoded = base58.decode(address);

    if (decoded.length < 5) return false;

    // Verify checksum
    const payload = decoded.slice(0, -4);
    const checksum = decoded.slice(-4);
    const hash1 = sha256(payload);
    const hash2 = sha256(hash1);
    if (
      hash2[0] !== checksum[0] ||
      hash2[1] !== checksum[1] ||
      hash2[2] !== checksum[2] ||
      hash2[3] !== checksum[3]
    ) {
      return false;
    }

    // Verify version byte
    const version = payload[0];
    return version === PUB_KEY_HASH || version === SCRIPT_HASH;
  } catch {
    return false;
  }
}

/**
 * Get P2PKH scriptPubKey hex for a derived address (needed for PSBT construction).
 */
export function getScriptPubKeyFromPublicKey(hdKey: HDKey, path: string): Uint8Array {
  const derived = hdKey.derive(path);
  const publicKey = derived.publicKey;
  if (!publicKey) throw new Error('No public key derived');
  return scriptPubKeyFromPubKey(compressPublicKey(publicKey));
}

/**
 * Get P2SH scriptPubKey from a redeem script.
 */
export function getP2SHScriptPubKey(redeemScript: Uint8Array): Uint8Array {
  const h160 = hash160(redeemScript);
  const script = new Uint8Array(23);
  script[0] = 0xa9; // OP_HASH160
  script[1] = 0x14; // push 20 bytes
  script.set(h160, 2);
  script[22] = 0x87; // OP_EQUAL
  return script;
}

/** PHICOIN address version bytes */
export { PUB_KEY_HASH, SCRIPT_HASH };
