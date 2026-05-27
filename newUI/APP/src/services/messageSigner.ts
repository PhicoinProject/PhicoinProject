import * as nobleSecp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { hmac } from '@noble/hashes/hmac';
import { base58 } from '@scure/base';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';
import { receivePath, getCoinType } from './HDWallet';
import { NETWORK } from '@/utils/constants';

// Initialize noble/secp256k1 for deterministic signing
const hmacSha256 = (key: Uint8Array, ...msgs: Uint8Array[]) => {
  const data = new Uint8Array(msgs.reduce((s, m) => s + m.length, 0));
  let off = 0;
  for (const m of msgs) { data.set(m, off); off += m.length; }
  return hmac(sha256, data, key);
};
nobleSecp.utils.hmacSha256Sync = hmacSha256;

// PHICOIN address prefix (pubkey hash) — sourced from the centralized network
// config so it always matches addressDerivation.ts.
const PUB_KEY_HASH = NETWORK.pubKeyHashVersion;

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

/**
 * Convert Uint8Array to base64 string (browser-compatible, no Buffer needed).
 */
function toBase64(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(binary);
}

/**
 * Convert base64 string to Uint8Array (browser-compatible, no Buffer needed).
 */
function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compute the SHA256d digest of a PHICOIN signed message.
 * Format: "\x18PHICOIN Signed Message:\n{len}{message}".
 */
function messageHash(message: string): Uint8Array {
  const prefix = '\x18PHICOIN Signed Message:\n';
  const payload = new TextEncoder().encode(prefix + message.length + message);
  return sha256(sha256(payload));
}

/**
 * Header byte for a compact recoverable signature.
 * Bitcoin/PHICOIN convention: 27 + recId, plus 4 when the signing key is
 * compressed. This wallet always derives addresses from compressed pubkeys, so
 * the compressed flag is set.
 */
const COMPRESSED_SIG_OFFSET = 4;

/**
 * Sign a PHICOIN message.
 *
 * P6: emit the canonical 65-byte compact recoverable signature
 * `[27 + recId + 4][r(32)][s(32)]` (Base64-encoded), using the REAL recovery id
 * returned by noble's `signSync(..., { recovered: true })`. This matches
 * Bitcoin/PHICOIN `signmessage` output and lets verifiers recover the exact key
 * directly, instead of the old approach that appended a fixed recId=0 and forced
 * the verifier to brute-force all four candidates.
 */
export function signMessage(message: string, privateKey: Uint8Array): string {
  const hash = messageHash(message);

  // recovered: true → [DER signature, recovery id]. der:true keeps a parseable
  // form we convert to compact (r||s). signSync also low-S normalizes, so the
  // recovery id matches the emitted r,s.
  const [derSig, recId] = nobleSecp.signSync(hash, privateKey.slice(0, 32), {
    der: true,
    recovered: true,
  });

  // Convert DER -> compact 64-byte (r||s).
  const compact = nobleSecp.Signature.fromDER(derSig).toCompactRawBytes();

  const out = new Uint8Array(65);
  out[0] = 27 + recId + COMPRESSED_SIG_OFFSET;
  out.set(compact, 1);
  return toBase64(out);
}

/**
 * Verify a PHICOIN signed message.
 *
 * P6: parse the 65-byte compact recoverable signature, derive the recovery id
 * from the header byte, recover exactly one public key, and compare its address
 * to the expected one. Falls back to scanning recovery ids only for legacy /
 * non-conforming header bytes, so older signatures still verify.
 */
export function verifyMessage(message: string, signature: string, address: string): boolean {
  try {
    const sigBytes = fromBase64(signature);
    if (sigBytes.length !== 65) return false;

    const header = sigBytes[0];
    const compact = sigBytes.slice(1); // 64 bytes: r||s
    const sig = nobleSecp.Signature.fromCompact(compact);
    const hash = messageHash(message);

    // Derive recId from the header byte when it is in the canonical range
    // (27..34 covers both uncompressed and compressed variants).
    const headerRecId = header >= 27 && header <= 34 ? (header - 27) & 0x03 : -1;

    const tryRecId = (recId: number): boolean => {
      try {
        const pubKey = nobleSecp.recoverPublicKey(hash, sig, recId, true);
        return publicKeyToAddress(pubKey) === address;
      } catch {
        return false;
      }
    };

    if (headerRecId >= 0) {
      return tryRecId(headerRecId);
    }

    // Legacy fallback: header byte not informative — try all recovery ids.
    for (let recId = 0; recId <= 3; recId++) {
      if (tryRecId(recId)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Sign a message using the wallet's HD key at the given derivation path.
 */
export async function signMessageWithWallet(
  message: string,
  derivationPath?: string
): Promise<{ signature: string; address: string }> {
  const hdKey = useWalletHDKeyStore.getState().hdKey;
  if (!hdKey) throw new Error('Wallet not unlocked');

  // Canonical PHICOIN path: m/44'/coinType'/0'/0/0 (coinType=0 for mainnet).
  // Must match receive-address derivation so the signing address is a real
  // wallet receive address (avoids "address mismatch" on verify).
  const path = derivationPath ?? receivePath(getCoinType('mainnet'), 0);
  const derivedKey = hdKey.derive(path);
  const privateKey = derivedKey.privateKey;
  if (!privateKey) throw new Error('No private key at derivation path');

  const publicKey = derivedKey.publicKey;
  if (!publicKey) throw new Error('No public key at derivation path');

  const compressedPub =
    publicKey.length === 33
      ? publicKey
      : new Uint8Array([publicKey[64] & 1 ? 0x03 : 0x02, ...publicKey.slice(1, 33)]);

  const address = publicKeyToAddress(compressedPub);
  const signature = signMessage(message, privateKey);

  return { signature, address };
}

/** Convert compressed public key to P2PKH address */
function publicKeyToAddress(pubKey: Uint8Array): string {
  const h = hash160(pubKey);
  const payload = new Uint8Array(21);
  payload[0] = PUB_KEY_HASH;
  payload.set(h, 1);

  const checksumHash = sha256(sha256(payload));
  const checksum = checksumHash.slice(0, 4);

  const withChecksum = new Uint8Array(25);
  withChecksum.set(payload);
  withChecksum.set(checksum, 21);

  // Use @scure/base base58encode instead of Node Buffer
  return base58.encode(withChecksum);
}
