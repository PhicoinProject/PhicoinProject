import { deriveKey, encryptData, generateSalt, secureZero, toHex, sha256 } from './crypto';
import {
  storeEncryptedSeed,
  retrieveEncryptedSeed,
  hasV2Wallet,
  clearV2Wallet,
} from './encryptedWallet';
import { deriveMasterSeed, seedToHDKey } from './HDWallet';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';

const SALT_KEY = 'phi:salt';
const SENTINEL_KEY = 'phi:sentinel';
const MNEMONIC_HASH_KEY = 'phi:mnemonicHash';
const CREATED_KEY = 'phi:created';
const RATE_LIMIT_KEY = 'phi:rateLimit';
const SENTINEL_PLAINTEXT = 'phi-wallet-verified';
const WALLET_VERSION_KEY = 'phi:walletVersion';

// Rate limiting config
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 30_000; // 30 seconds

/**
 * Check whether the user is currently unlocked (session-only flag).
 * After page refresh sessionStorage survives but in-memory HDKey is lost.
 * Return true only if both flags are set.
 */
export function isUnlocked(): boolean {
  return sessionStorage.getItem('phi:unlocked') === 'true';
}

  /**
   * Safely convert a Uint8Array to an ArrayBuffer that crypto.subtle accepts.
   * Using `.buffer` directly can return a SharedArrayBuffer or a larger-than-needed
   * ArrayBuffer (when the view is a slice of a larger buffer).
   */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.slice(0).buffer;
}

/**
 * Attempt auto-unlock on page refresh using a session key stored in sessionStorage.
 *
 * SECURITY: The session key is a random 256-bit key generated during unlock.
 * It survives page refreshes (sessionStorage) but is cleared when the tab
 * or browser is closed. This is more secure than storing the mnemonic in
 * plaintext or using a deterministic passphrase.
 */
export async function tryAutoUnlock(): Promise<boolean> {
  if (!hasV2Wallet()) return false;

  // If HDKey is already in memory (e.g., post-unlock before refresh), no need to retry.
  if (useWalletHDKeyStore.getState().hdKey) return false;

  // SessionStorage persists across page refreshes.
  // If unlocked is true but HDKey is null, the page was refreshed and we need to recover it.
  // If unlocked is false, no one has unlocked yet — bail out (let the Unlock page handle it).
  if (sessionStorage.getItem('phi:unlocked') !== 'true') return false;

  try {
    const sessionKeyHex = sessionStorage.getItem('phi:sessionKey');
    const sessionEncryptedSeed = sessionStorage.getItem('phi:sessionEncryptedSeed');
    if (!sessionKeyHex || !sessionEncryptedSeed) return false;

    const sessionKeyBytes = hexToBytes(sessionKeyHex);
    const encryptedData = hexToBytes(sessionEncryptedSeed);
    const iv = encryptedData.slice(0, 12);
    const ciphertext = encryptedData.slice(12);

    // Import session key as AES-GCM key
    const key = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(sessionKeyBytes),
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext)
    );

    const masterSeed = new Uint8Array(decrypted);
    const hdKey = seedToHDKey(masterSeed);
    useWalletHDKeyStore.getState().setHDKey(hdKey);
    sessionStorage.setItem('phi:unlocked', 'true');

    // Zeroize session key material from memory
    sessionKeyBytes.fill(0);

    return true;
  } catch {
    return false;
  }
}

/** Check whether wallet data exists in localStorage (v1 or v2). */
export function hasWallet(): boolean {
  const v1 = !!localStorage.getItem(SALT_KEY) && !!localStorage.getItem(SENTINEL_KEY);
  const v2 = hasV2Wallet();
  return v1 || v2;
}

/** Get the wallet version: 'v1' | 'v2' | null */
export function getWalletVersion(): 'v1' | 'v2' | null {
  if (hasV2Wallet()) return 'v2';
  if (localStorage.getItem(SALT_KEY) && localStorage.getItem(SENTINEL_KEY)) return 'v1';
  return null;
}

/**
 * Rate limiter: returns { allowed, remainingAttempts, cooldownMs }
 * After MAX_ATTEMPTS consecutive failures within a window, blocks further
 * attempts for COOLDOWN_MS milliseconds.
 */
export function checkRateLimit(): {
  allowed: boolean;
  remainingAttempts: number;
  cooldownMs: number;
} {
  const data = localStorage.getItem(RATE_LIMIT_KEY);
  if (!data) {
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS, cooldownMs: 0 };
  }
  try {
    const { attempts, lockedUntil } = JSON.parse(data) as { attempts: number; lockedUntil: number };
    const now = Date.now();
    if (lockedUntil && now < lockedUntil) {
      return { allowed: false, remainingAttempts: 0, cooldownMs: lockedUntil - now };
    }
    // Lock expired — reset
    if (lockedUntil && now >= lockedUntil) {
      localStorage.removeItem(RATE_LIMIT_KEY);
      return { allowed: true, remainingAttempts: MAX_ATTEMPTS, cooldownMs: 0 };
    }
    if (attempts >= MAX_ATTEMPTS) {
      return { allowed: false, remainingAttempts: 0, cooldownMs: COOLDOWN_MS };
    }
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS - attempts, cooldownMs: 0 };
  } catch {
    localStorage.removeItem(RATE_LIMIT_KEY);
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS, cooldownMs: 0 };
  }
}

/** Record a failed unlock attempt, applying lockout if threshold is reached. */
export function recordFailedAttempt(): void {
  const data = localStorage.getItem(RATE_LIMIT_KEY);
  let attempts = 0;
  let lockedUntil = 0;
  if (data) {
    try {
      const parsed = JSON.parse(data) as { attempts: number; lockedUntil: number };
      attempts = parsed.attempts ?? 0;
      lockedUntil = parsed.lockedUntil ?? 0;
    } catch {
      /* ignore */
    }
  }
  attempts++;
  if (attempts >= MAX_ATTEMPTS) {
    lockedUntil = Date.now() + COOLDOWN_MS;
  }
  localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify({ attempts, lockedUntil }));
}

/** Reset the rate limiter (e.g., after a successful unlock). */
export function resetRateLimit(): void {
  localStorage.removeItem(RATE_LIMIT_KEY);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Compares two strings character-by-character, always iterating the full length.
 */
function constantTimeCompare(a: string, b: string): boolean {
  const lenA = a.length;
  const lenB = b.length;
  const maxLen = Math.max(lenA, lenB);
  let result = 0;
  for (let i = 0; i < maxLen; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

/**
 * Attempt to unlock the wallet with the given passphrase.
 * Tries v2 (encrypted seed) first, falls back to v1 (sentinel).
 * Returns true on success, false on wrong passphrase.
 * Throws if wallet data is missing or rate-limited.
 */
export async function tryUnlock(passphrase: string): Promise<boolean> {
  const limit = checkRateLimit();
  if (!limit.allowed) {
    throw new Error(
      `Too many failed attempts. Please wait ${Math.ceil(limit.cooldownMs / 1000)} seconds.`
    );
  }

  // Try v2 wallet first
  if (hasV2Wallet()) {
    try {
      const masterSeed = await retrieveEncryptedSeed(passphrase);
      const hdKey = seedToHDKey(masterSeed);
      useWalletHDKeyStore.getState().setHDKey(hdKey);

      // Store session key for auto-unlock on page refresh
      await storeSessionKey(masterSeed);

      resetRateLimit();
      sessionStorage.setItem('phi:unlocked', 'true');
      // Zeroize master seed from memory
      masterSeed.fill(0);
      return true;
    } catch {
      await sleep(200);
      recordFailedAttempt();
      return false;
    }
  }

  // Fall back to v1 sentinel-based unlock
  const saltHex = localStorage.getItem(SALT_KEY);
  if (!saltHex) throw new Error('Wallet data missing');

  const encryptedHex = localStorage.getItem(SENTINEL_KEY);
  if (!encryptedHex) throw new Error('Wallet data corrupted');

  const salt = hexToBytes(saltHex);
  const key = await deriveKey(passphrase, salt);

  const encryptedData = hexToBytes(encryptedHex);
  const iv = encryptedData.slice(0, 12);
  const ciphertext = encryptedData.slice(12);

  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext)
    );
  } catch {
    await sleep(200);
    recordFailedAttempt();
    return false;
  }

  const plaintext = new TextDecoder().decode(decrypted);
  if (!constantTimeCompare(plaintext, SENTINEL_PLAINTEXT)) {
    recordFailedAttempt();
    return false;
  }

  resetRateLimit();
  sessionStorage.setItem('phi:unlocked', 'true');
  sessionStorage.setItem('phi:keySalt', saltHex);
  return true;
}

/** Minimal sleep utility (avoids blocking the main thread). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a v2 wallet with 24-word BIP39 mnemonic, user seed, and password.
 * Derives master seed, encrypts, and stores in localStorage.
 */
export async function createWalletV2(
  mnemonic: string,
  userSeed: string,
  password: string
): Promise<void> {
  const masterSeed = await deriveMasterSeed(mnemonic, userSeed);
  await storeEncryptedSeed(masterSeed, password);
  localStorage.setItem(WALLET_VERSION_KEY, '2');
  localStorage.setItem(CREATED_KEY, Date.now().toString());
  // SECURITY: Never store mnemonic or userSeed in plaintext.
  // The master seed is derived from mnemonic+userSeed via HMAC-SHA512.
  // Storing the encrypted master seed is sufficient; the mnemonic is
  // only needed for user backup/restore, not for app operation.
}

/**
 * Change the wallet passphrase entirely client-side (no RPC).
 *
 * Flow:
 *   1. Verify the old password by decrypting the stored encrypted master seed.
 *      `retrieveEncryptedSeed` throws if the password is wrong (AES-GCM auth tag
 *      mismatch), which we surface as a clear error.
 *   2. Re-encrypt the same master seed under the new password. `storeEncryptedSeed`
 *      generates a fresh random salt and IV and overwrites the v2 localStorage keys.
 *   3. Refresh the in-memory HD key and the auto-unlock session key so the active
 *      session keeps working without a relock.
 *
 * Only supports v2 (encrypted-seed) wallets — v1 sentinel wallets store no seed
 * to re-encrypt.
 *
 * @throws if no v2 wallet exists, the old password is wrong, or the new password
 *         fails basic validation.
 */
export async function changeWalletPassword(
  oldPassword: string,
  newPassword: string
): Promise<void> {
  if (!hasV2Wallet()) {
    throw new Error('Changing the passphrase requires a v2 (encrypted-seed) wallet.');
  }
  if (!newPassword || newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters.');
  }
  if (oldPassword === newPassword) {
    throw new Error('New password must be different from the current password.');
  }

  // 1. Verify old password by decrypting the stored seed.
  let masterSeed: Uint8Array;
  try {
    masterSeed = await retrieveEncryptedSeed(oldPassword);
  } catch {
    throw new Error('Current password is incorrect.');
  }

  try {
    // 2. Re-encrypt the seed under the new password (fresh salt + IV).
    await storeEncryptedSeed(masterSeed, newPassword);

    // 3. Keep the live session consistent: refresh in-memory key + session key.
    const hdKey = seedToHDKey(masterSeed);
    useWalletHDKeyStore.getState().setHDKey(hdKey);
    if (sessionStorage.getItem('phi:unlocked') === 'true') {
      await storeSessionKey(masterSeed);
    }
  } finally {
    // Always zeroize the seed from memory.
    secureZero(masterSeed);
  }
}

/**
 * Create a v1 wallet (legacy, for backward compatibility).
 * Stores salt and encrypted sentinel in localStorage for future unlock.
 */
export async function createWallet(passphrase: string, mnemonic?: string): Promise<void> {
  const salt = generateSalt();
  const key = await deriveKey(passphrase, salt);
  const iv = generateSalt().slice(0, 12);
  const encrypted = await encryptData(SENTINEL_PLAINTEXT, key, iv);

  localStorage.setItem(SALT_KEY, toHex(salt));
  localStorage.setItem(SENTINEL_KEY, toHex(encrypted));

  if (mnemonic) {
    const hash = await sha256(mnemonic);
    localStorage.setItem(MNEMONIC_HASH_KEY, toHex(hash));
  }

  localStorage.setItem(CREATED_KEY, Date.now().toString());
}

/** Clear all wallet data from localStorage (factory reset). */
export function clearWallet(): void {
  localStorage.removeItem(SALT_KEY);
  localStorage.removeItem(SENTINEL_KEY);
  localStorage.removeItem(MNEMONIC_HASH_KEY);
  localStorage.removeItem(CREATED_KEY);
  localStorage.removeItem(WALLET_VERSION_KEY);
  sessionStorage.removeItem('phi:unlocked');
  sessionStorage.removeItem('phi:keySalt');
  sessionStorage.removeItem('phi:sessionKey');
  sessionStorage.removeItem('phi:sessionEncryptedSeed');
  clearV2Wallet();
  useWalletHDKeyStore.getState().clearHDKey();
}

/** Get wallet metadata (creation date, mnemonic hash) without unlocking. */
export function getWalletMetadata(): { created: string | null; mnemonicHash: string | null } {
  return {
    created: localStorage.getItem(CREATED_KEY),
    mnemonicHash: localStorage.getItem(MNEMONIC_HASH_KEY),
  };
}

// -- Helpers --

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Encrypt the master seed with a random session key and store in sessionStorage.
 * This enables auto-unlock after page refresh without exposing the mnemonic
 * or user password in storage.
 */
async function storeSessionKey(masterSeed: Uint8Array): Promise<void> {
  try {
    const sessionKey = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const key = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(sessionKey),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(masterSeed)
    );

    sessionStorage.setItem('phi:sessionKey', toHex(sessionKey));
    sessionStorage.setItem('phi:sessionEncryptedSeed', toHex(new Uint8Array([...iv, ...new Uint8Array(encrypted)])));

    sessionKey.fill(0);
  } catch {
    // Auto-unlock won't work but wallet still functions
  }
}
