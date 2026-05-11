import { SCRYPT_PARAMS, WALLET_KDF_ITERATIONS } from '@/utils/constants';

// TypeScript 5+ Uint8Array<ArrayBufferLike> is incompatible with Web Crypto BufferSource.
// This helper creates a fresh Uint8Array backed by ArrayBuffer for Web Crypto API calls.
function toCryptoBuffer(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(data.length);
  const view = new Uint8Array(ab);
  view.set(data);
  return view;
}

/** @deprecated Use deriveWalletKey */
export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const bufferSalt = toCryptoBuffer(salt);
  return deriveWalletKey(
    passphrase,
    bufferSalt,
    SCRYPT_PARAMS.n * SCRYPT_PARAMS.r * SCRYPT_PARAMS.p
  );
}

export async function deriveWalletKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = WALLET_KDF_ITERATIONS
): Promise<CryptoKey> {
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
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

export function generateIV(): Uint8Array {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  return iv;
}

export async function encryptData(
  plaintext: string,
  key: CryptoKey,
  iv: Uint8Array
): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toCryptoBuffer(iv) },
    key,
    toCryptoBuffer(encoded)
  );

  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);
  return result;
}

export async function decryptData(data: Uint8Array, key: CryptoKey): Promise<string> {
  try {
    const iv = data.slice(0, 12);
    const ciphertext = data.slice(12);
    const decoded = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toCryptoBuffer(iv) },
      key,
      toCryptoBuffer(ciphertext)
    );
    return new TextDecoder().decode(decoded);
  } catch {
    const iv = data.slice(0, 16);
    const ciphertext = data.slice(16);
    const decoded = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toCryptoBuffer(iv) },
      key,
      toCryptoBuffer(ciphertext)
    );
    return new TextDecoder().decode(decoded);
  }
}

export function secureZero(array: Uint8Array): void {
  array.fill(0);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function sha256(data: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest('SHA-256', toCryptoBuffer(encoded));
  return new Uint8Array(hash);
}

export async function sha256d(data: string): Promise<Uint8Array> {
  const first = await sha256(data);
  const second = await crypto.subtle.digest('SHA-256', toCryptoBuffer(first).buffer);
  return new Uint8Array(second);
}

export async function encryptBinary(
  data: Uint8Array,
  key: CryptoKey,
  iv: Uint8Array
): Promise<Uint8Array> {
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toCryptoBuffer(iv) },
    key,
    toCryptoBuffer(data)
  );

  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);
  return result;
}

export async function decryptBinary(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const decoded = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toCryptoBuffer(iv) },
    key,
    toCryptoBuffer(ciphertext)
  );
  return new Uint8Array(decoded);
}

export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', toCryptoBuffer(data));
  return new Uint8Array(hash);
}
