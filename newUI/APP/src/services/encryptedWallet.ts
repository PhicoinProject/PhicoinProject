import {
  deriveWalletKey,
  encryptBinary,
  decryptBinary,
  generateSalt,
  generateIV,
  toHex,
  fromHex,
} from './crypto';
import { WALLET_KDF_ITERATIONS } from '@/utils/constants';

const WALLET_ENCRYPTED_KEY = 'phi:v2:encryptedSeed';
const WALLET_SALT_KEY = 'phi:v2:salt';
const WALLET_IV_KEY = 'phi:v2:iv';
const WALLET_META_KEY = 'phi:v2:meta';
const WALLET_VERSION = 2;

export interface EncryptedWalletData {
  version: number;
  format: 'phicoin-encrypted-wallet';
  encrypted: {
    iv: string;
    cipher: string;
  };
  kdf: {
    type: 'PBKDF2';
    iterations: number;
    salt: string;
  };
  meta: {
    created: string;
  };
}

export interface WalletMetadata {
  created: string;
  iterations?: number;
}

/** Encrypt and store a 512-byte master seed in localStorage */
export async function storeEncryptedSeed(
  masterSeed: Uint8Array,
  password: string,
  iterations = WALLET_KDF_ITERATIONS
): Promise<EncryptedWalletData> {
  const salt = generateSalt();
  const iv = generateIV();
  const key = await deriveWalletKey(password, salt, iterations);
  const encrypted = await encryptBinary(masterSeed, key, iv);

  // Store in localStorage
  localStorage.setItem(WALLET_SALT_KEY, toHex(salt));
  localStorage.setItem(WALLET_IV_KEY, toHex(iv));
  localStorage.setItem(WALLET_ENCRYPTED_KEY, toHex(encrypted));
  localStorage.setItem(
    WALLET_META_KEY,
    JSON.stringify({
      created: new Date().toISOString(),
      iterations,
    })
  );

  // Return structured data for export
  const cipherData = encrypted.slice(12);
  return {
    version: WALLET_VERSION,
    format: 'phicoin-encrypted-wallet',
    encrypted: {
      iv: toHex(iv),
      cipher: toHex(cipherData),
    },
    kdf: {
      type: 'PBKDF2',
      iterations,
      salt: toHex(salt),
    },
    meta: {
      created: new Date().toISOString(),
    },
  };
}

/** Decrypt and retrieve the master seed from localStorage */
export async function retrieveEncryptedSeed(password: string): Promise<Uint8Array> {
  const saltHex = localStorage.getItem(WALLET_SALT_KEY);
  const encryptedHex = localStorage.getItem(WALLET_ENCRYPTED_KEY);

  if (!saltHex || !encryptedHex) {
    throw new Error('No v2 wallet data found');
  }

  const salt = fromHex(saltHex);
  const encrypted = fromHex(encryptedHex);

  let iterations = WALLET_KDF_ITERATIONS;
  try {
    const meta = JSON.parse(localStorage.getItem(WALLET_META_KEY) || '{}') as WalletMetadata;
    if (meta.iterations) iterations = meta.iterations;
  } catch {
    /* use default */
  }

  const key = await deriveWalletKey(password, salt, iterations);
  return decryptBinary(encrypted, key);
}

/** Check if a v2 wallet exists */
export function hasV2Wallet(): boolean {
  return !!(localStorage.getItem(WALLET_SALT_KEY) && localStorage.getItem(WALLET_ENCRYPTED_KEY));
}

/** Import an encrypted wallet from a JSON string */
export function importEncryptedWallet(jsonData: string): void {
  let data: EncryptedWalletData;
  try {
    data = JSON.parse(jsonData) as EncryptedWalletData;
  } catch {
    throw new Error('Invalid JSON format');
  }

  if (data.format !== 'phicoin-encrypted-wallet') {
    throw new Error('Unsupported wallet format');
  }
  if (data.version !== WALLET_VERSION) {
    throw new Error(`Unsupported wallet version: ${data.version}`);
  }
  if (!data.encrypted.iv || !data.encrypted.cipher) {
    throw new Error('Missing encrypted data');
  }
  if (!data.kdf.salt) {
    throw new Error('Missing KDF salt');
  }

  // Reconstruct full encrypted blob: [iv][cipher+tag]
  const ivBytes = fromHex(data.encrypted.iv);
  const cipherBytes = fromHex(data.encrypted.cipher);
  const fullBlob = new Uint8Array(ivBytes.length + cipherBytes.length);
  fullBlob.set(ivBytes, 0);
  fullBlob.set(cipherBytes, ivBytes.length);

  localStorage.setItem(WALLET_SALT_KEY, data.kdf.salt);
  localStorage.setItem(WALLET_IV_KEY, data.encrypted.iv);
  localStorage.setItem(WALLET_ENCRYPTED_KEY, toHex(fullBlob));
  localStorage.setItem(
    WALLET_META_KEY,
    JSON.stringify({
      created: data.meta.created,
      iterations: data.kdf.iterations,
    })
  );
}

/** Clear all v2 wallet data */
export function clearV2Wallet(): void {
  localStorage.removeItem(WALLET_ENCRYPTED_KEY);
  localStorage.removeItem(WALLET_SALT_KEY);
  localStorage.removeItem(WALLET_IV_KEY);
  localStorage.removeItem(WALLET_META_KEY);
}

/** Get v2 wallet metadata */
export function getV2Metadata(): WalletMetadata {
  try {
    return JSON.parse(localStorage.getItem(WALLET_META_KEY) || '{}');
  } catch {
    return { created: '' };
  }
}
