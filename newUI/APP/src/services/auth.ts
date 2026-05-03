import { deriveKey, encryptData, generateSalt, toHex, sha256 } from './crypto';

const SALT_KEY = 'phi:salt';
const SENTINEL_KEY = 'phi:sentinel';
const MNEMONIC_HASH_KEY = 'phi:mnemonicHash';
const CREATED_KEY = 'phi:created';
const RATE_LIMIT_KEY = 'phi:rateLimit';
const SENTINEL_PLAINTEXT = 'phi-wallet-verified';

// Rate limiting config
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 30_000; // 30 seconds

/** Check whether the user is currently unlocked (session-only flag). */
export function isUnlocked(): boolean {
  return sessionStorage.getItem('phi:unlocked') === 'true';
}

/** Check whether wallet data exists in localStorage. */
export function hasWallet(): boolean {
  return !!localStorage.getItem(SALT_KEY) && !!localStorage.getItem(SENTINEL_KEY);
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
 * Derives a key from the stored salt and verifies against the sentinel value.
 * Returns true on success, false on wrong passphrase.
 * Throws if wallet data is missing or corrupted.
 */
export async function tryUnlock(passphrase: string): Promise<boolean> {
  // Check rate limit first
  const limit = checkRateLimit();
  if (!limit.allowed) {
    throw new Error(
      `Too many failed attempts. Please wait ${Math.ceil(limit.cooldownMs / 1000)} seconds.`
    );
  }

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
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext
    );
  } catch {
    // Decryption failure = wrong passphrase. Always perform a small delay
    // to mitigate timing attacks on the decrypt step.
    await sleep(200);
    recordFailedAttempt();
    return false;
  }

  const plaintext = new TextDecoder().decode(decrypted);
  if (!constantTimeCompare(plaintext, SENTINEL_PLAINTEXT)) {
    recordFailedAttempt();
    return false;
  }

  // Successful unlock — reset rate limit
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
 * Create a new wallet.
 * Stores salt and encrypted sentinel in localStorage for future unlock.
 * Optionally stores an encrypted mnemonic if provided.
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
  sessionStorage.removeItem('phi:unlocked');
  sessionStorage.removeItem('phi:keySalt');
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
