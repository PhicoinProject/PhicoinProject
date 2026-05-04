import * as nobleSecp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { base58 } from '@scure/base';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';

// PHICOIN address prefix (pubkey hash)
const PUB_KEY_HASH = 0x37;

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
 * Sign a PHICOIN message.
 * Format: "\x18PHICOIN Signed Message:\n{len}{message}" -> SHA256d -> secp256k1 sign
 * Returns Base64-encoded DER signature with recovery ID appended.
 */
export function signMessage(message: string, privateKey: Uint8Array): string {
  const prefix = '\x18PHICOIN Signed Message:\n';
  const payload = new TextEncoder().encode(prefix + message.length + message);
  const hash = sha256(sha256(payload));

  const derSig = nobleSecp.signSync(hash, privateKey.slice(0, 32), { der: true });

  // Append recovery ID (27 + hashtype)
  const sigWithRecovery = new Uint8Array(derSig.length + 1);
  sigWithRecovery.set(derSig);
  sigWithRecovery[derSig.length] = 27; // recovery ID 0 with hashtype

  return toBase64(sigWithRecovery);
}

/**
 * Verify a PHICOIN signed message.
 * Recovers public key from signature, derives address, compares with provided address.
 */
export function verifyMessage(message: string, signature: string, address: string): boolean {
  try {
    const sigBytes = fromBase64(signature);
    if (sigBytes.length < 2) return false;

    const recoveryId = sigBytes[sigBytes.length - 1] - 27;
    if (recoveryId < 0 || recoveryId > 3) return false;

    const derSig = sigBytes.slice(0, -1);
    const prefix = '\x18PHICOIN Signed Message:\n';
    const payload = new TextEncoder().encode(prefix + message.length + message);
    const hash = sha256(sha256(payload));

    const pubKey = nobleSecp.recoverPublicKey(hash, derSig, recoveryId);
    const compressedPub =
      pubKey.length === 65
        ? new Uint8Array([pubKey[64] & 1 ? 0x03 : 0x02, ...pubKey.slice(1, 33)])
        : pubKey;

    const derivedAddress = publicKeyToAddress(compressedPub);
    return derivedAddress === address;
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

  const path = derivationPath ?? "m/44'/486'/0'/0/0";
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
