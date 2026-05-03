import { SCRYPT_PARAMS } from '@/utils/constants';

/**
 * Derive a 256-bit key from a passphrase using PBKDF2.
 * Uses iteration count equivalent to scrypt params (n=16384, r=8, p=1).
 * The derived key is suitable for AES-256 encryption.
 * Production should use WASM-based scrypt to match Bitcoin Core exactly.
 */
export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: SCRYPT_PARAMS.n * SCRYPT_PARAMS.r * SCRYPT_PARAMS.p,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Generate a random salt (16 bytes) */
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

/** Generate a random IV (12 bytes for AES-GCM) */
export function generateIV(): Uint8Array {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  return iv;
}

/**
 * Encrypt data with AES-GCM using a derived key.
 * Returns [iv][ciphertext] as Uint8Array.
 */
export async function encryptData(
  plaintext: string,
  key: CryptoKey,
  iv: Uint8Array
): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    encoded
  );

  // Prepend IV to ciphertext for storage: [iv][ciphertext]
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);
  return result;
}

/**
 * Decrypt AES-GCM data.
 * Expects data format: [iv][ciphertext], tries 12-byte IV first (AES-GCM standard),
 * falls back to 16-byte IV for data created with older code.
 */
export async function decryptData(data: Uint8Array, key: CryptoKey): Promise<string> {
  // Try 12-byte IV first (current standard)
  try {
    const iv = data.slice(0, 12);
    const ciphertext = data.slice(12);
    const decoded = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decoded);
  } catch {
    // Fall back to 16-byte IV (legacy data from older code)
    const iv = data.slice(0, 16);
    const ciphertext = data.slice(16);
    const decoded = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decoded);
  }
}

/**
 * Securely zero out a TypedArray (best-effort in JS).
 */
export function secureZero(array: Uint8Array): void {
  array.fill(0);
}

/** Convert Uint8Array to hex string */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Convert hex string to Uint8Array */
export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Hash a string with SHA-256.
 */
export async function sha256(data: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(hash);
}

/**
 * Hash a string with SHA-256 twice (double-SHA256, common in Bitcoin).
 */
export async function sha256d(data: string): Promise<Uint8Array> {
  const first = await sha256(data);
  const second = await crypto.subtle.digest('SHA-256', first.buffer as ArrayBuffer);
  return new Uint8Array(second);
}
