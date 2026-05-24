/**
 * change-passphrase.spec.ts — verifies change-passphrase end-to-end (no broadcast).
 *
 * Re-encrypts the in-session seed with a new password, confirms the wallet unlocks with
 * the NEW password and rejects the OLD one, then restores the original password. Purely
 * local crypto (localStorage) — the gitignored backup is untouched, so other tests that
 * re-import keep working.
 */
import { test, expect } from '@playwright/test';
import { gotoUnlocked, WALLET_PASSWORD } from './fixtures';

test('change passphrase re-encrypts and unlocks with the new password', async ({ page }) => {
  test.setTimeout(120000);
  await gotoUnlocked(page, '/'); // imported + unlocked with the current password

  const result = await page.evaluate(async (oldPw) => {
    const auth = await import('/src/services/auth.ts');
    const NEW = 'NewQA_Pass_9912';
    try {
      await auth.changeWalletPassword(oldPw, NEW);
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { changed: false, error: String((e as any)?.message ?? e) };
    }
    auth.lockWallet();
    const unlockWithNew = await auth.tryUnlock(NEW);
    auth.lockWallet();
    const unlockWithOld = await auth.tryUnlock(oldPw);
    // Restore the original password so the session matches the backup creds.
    if (unlockWithNew) {
      try {
        await auth.changeWalletPassword(NEW, oldPw);
      } catch {
        /* best-effort restore */
      }
    }
    return { changed: true, unlockWithNew, unlockWithOld };
  }, WALLET_PASSWORD);

  console.log('CHANGE_PW=' + JSON.stringify(result));
  expect(result.changed).toBe(true);
  expect(result.unlockWithNew).toBe(true); // new password works
  expect(result.unlockWithOld).toBe(false); // old password rejected
});
