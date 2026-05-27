import {
  createWalletV2,
  tryUnlock,
  hasWallet,
  getWalletVersion,
  clearWallet,
  isUnlocked,
  resetRateLimit,
} from '@/services/auth';
import {
  storeEncryptedSeed,
  importEncryptedWallet,
  clearV2Wallet,
  hasV2Wallet,
} from '@/services/encryptedWallet';
import { deriveMasterSeed, seedToHDKey, isValidMnemonic } from '@/services/HDWallet';
import { deriveReceiveAddress } from '@/services/addressDerivation';
import { useWalletHDKeyStore } from '@/stores/hdKeyStore';

// Deterministic BIP39 test vector (Trezor vector) so derived addresses are stable.
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const USER_SEED = 'test-user-seed-passphrase';
const PASSWORD = 'correct-horse-battery-staple';

/** Fully reset wallet + session + in-memory key between tests. */
function fullReset(): void {
  clearWallet();
  clearV2Wallet();
  resetRateLimit();
  localStorage.clear();
  sessionStorage.clear();
  useWalletHDKeyStore.getState().clearHDKey();
}

describe('Wallet create / import / unlock (v2)', () => {
  beforeEach(() => {
    fullReset();
  });
  afterEach(() => {
    fullReset();
  });

  it('uses a valid 12-word BIP39 test vector', () => {
    expect(isValidMnemonic(TEST_MNEMONIC)).toBe(true);
  });

  describe('createWalletV2 → unlock', () => {
    it('creates a v2 wallet detectable by hasWallet/getWalletVersion', async () => {
      expect(hasWallet()).toBe(false);

      await createWalletV2(TEST_MNEMONIC, USER_SEED, PASSWORD);

      expect(hasWallet()).toBe(true);
      expect(hasV2Wallet()).toBe(true);
      expect(getWalletVersion()).toBe('v2');
    });

    it('unlocks with the correct password and loads the HD key', async () => {
      await createWalletV2(TEST_MNEMONIC, USER_SEED, PASSWORD);
      expect(useWalletHDKeyStore.getState().hdKey).toBeNull();

      const ok = await tryUnlock(PASSWORD);

      expect(ok).toBe(true);
      expect(isUnlocked()).toBe(true);
      expect(useWalletHDKeyStore.getState().hdKey).not.toBeNull();
    });

    it('rejects an incorrect password and leaves the wallet locked', async () => {
      await createWalletV2(TEST_MNEMONIC, USER_SEED, PASSWORD);

      const ok = await tryUnlock('this-is-the-wrong-password');

      expect(ok).toBe(false);
      expect(useWalletHDKeyStore.getState().hdKey).toBeNull();
      expect(isUnlocked()).toBe(false);
    });

    it('derives a deterministic, stable receive address after unlock', async () => {
      await createWalletV2(TEST_MNEMONIC, USER_SEED, PASSWORD);
      await tryUnlock(PASSWORD);

      const hdKey = useWalletHDKeyStore.getState().hdKey;
      expect(hdKey).not.toBeNull();

      // Address derived from the unlocked store key must equal the address
      // derived directly from mnemonic+seed (same canonical m/44'/0'/0'/0/0 path).
      const fromStore = deriveReceiveAddress(hdKey!, 'mainnet', 0).address;
      const expectedSeed = await deriveMasterSeed(TEST_MNEMONIC, USER_SEED);
      const expectedKey = seedToHDKey(expectedSeed);
      const expectedAddr = deriveReceiveAddress(expectedKey, 'mainnet', 0).address;

      expect(fromStore).toBe(expectedAddr);
      // PHICOIN mainnet P2PKH addresses start with 'P'.
      expect(fromStore.startsWith('P')).toBe(true);
      // Path used must be the canonical one.
      expect(deriveReceiveAddress(hdKey!, 'mainnet', 0).path).toBe("m/44'/0'/0'/0/0");
    });

    it('unlocks consistently across repeated lock/unlock cycles (same address)', async () => {
      await createWalletV2(TEST_MNEMONIC, USER_SEED, PASSWORD);

      await tryUnlock(PASSWORD);
      const addr1 = deriveReceiveAddress(
        useWalletHDKeyStore.getState().hdKey!,
        'mainnet',
        0
      ).address;

      // Relock (clear in-memory key, keep encrypted storage) and unlock again.
      useWalletHDKeyStore.getState().clearHDKey();
      sessionStorage.removeItem('phi:unlocked');

      await tryUnlock(PASSWORD);
      const addr2 = deriveReceiveAddress(
        useWalletHDKeyStore.getState().hdKey!,
        'mainnet',
        0
      ).address;

      expect(addr2).toBe(addr1);
    });
  });

  describe('import-from-backup → unlock', () => {
    it('imports an exported encrypted backup and unlocks with its password', async () => {
      // Build a backup blob deterministically from a known master seed.
      const masterSeed = await deriveMasterSeed(TEST_MNEMONIC, USER_SEED);
      const exportData = await storeEncryptedSeed(masterSeed, PASSWORD);

      // Simulate a fresh device: wipe everything, then import the backup JSON.
      fullReset();
      expect(hasV2Wallet()).toBe(false);

      importEncryptedWallet(JSON.stringify(exportData));
      expect(hasV2Wallet()).toBe(true);
      expect(getWalletVersion()).toBe('v2');

      const ok = await tryUnlock(PASSWORD);
      expect(ok).toBe(true);

      const hdKey = useWalletHDKeyStore.getState().hdKey;
      expect(hdKey).not.toBeNull();

      // The imported wallet must derive the same address as the original seed.
      const expectedAddr = deriveReceiveAddress(seedToHDKey(masterSeed), 'mainnet', 0).address;
      expect(deriveReceiveAddress(hdKey!, 'mainnet', 0).address).toBe(expectedAddr);
    });

    it('fails to unlock an imported backup with the wrong password', async () => {
      const masterSeed = await deriveMasterSeed(TEST_MNEMONIC, USER_SEED);
      const exportData = await storeEncryptedSeed(masterSeed, PASSWORD);

      fullReset();
      importEncryptedWallet(JSON.stringify(exportData));

      const ok = await tryUnlock('definitely-not-the-password');
      expect(ok).toBe(false);
      expect(useWalletHDKeyStore.getState().hdKey).toBeNull();
    });
  });

  describe('clearWallet', () => {
    it('removes wallet data and clears the in-memory key', async () => {
      await createWalletV2(TEST_MNEMONIC, USER_SEED, PASSWORD);
      await tryUnlock(PASSWORD);
      expect(useWalletHDKeyStore.getState().hdKey).not.toBeNull();

      clearWallet();

      expect(hasWallet()).toBe(false);
      expect(getWalletVersion()).toBeNull();
      expect(useWalletHDKeyStore.getState().hdKey).toBeNull();
      expect(isUnlocked()).toBe(false);
    });
  });
});
