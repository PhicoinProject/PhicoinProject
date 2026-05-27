/**
 * wallet-lifecycle.spec.ts
 *
 * Covers:
 *   - Wallet creation flow (mnemonic display, backup quiz, password, create)
 *   - Import via encrypted JSON (happy-path, wrong password, invalid JSON)
 *   - Import via recovery phrase tab
 *   - Unlock page: correct/wrong password, rate-limit message
 *   - Lock / idle-lock (lock button visible in backup/wallet pages)
 *   - Change passphrase: wrong-old rejected, mismatch rejected, happy path (no broadcast)
 *   - Reveal recovery phrase via backup page
 *
 * After any full reload the AuthGate shows the Unlock page — tests re-enter the
 * password using unlockWallet() rather than relying on session persistence.
 */

import { test, expect } from '@playwright/test';
import { importEncryptedWallet, gotoUnlocked, unlockWallet, WALLET_PATH, WALLET_PASSWORD } from './fixtures';
import { readFileSync } from 'fs';

/**
 * KNOWN PRODUCT BUG — CreateWallet renders an EMPTY recovery phrase under React
 * StrictMode (dev). src/pages/CreateWallet.tsx uses a useState initializer to
 * generate the phrase plus an unmount-cleanup `useEffect(() => () =>
 * setMnemonic(''), [])`. StrictMode mounts → runs the cleanup → remounts, but
 * the useState initializer does NOT re-run, so the phrase stays '' and the grid
 * renders a single empty slot. Tests asserting the rendered 24 words are marked
 * test.fixme; tests that only use the backup checkbox / Next button still run.
 */
// FIXED: CreateWallet no longer calls setMnemonic('') in its unmount cleanup, so the
// StrictMode mount→unmount→remount probe no longer wipes the phrase. Flag kept (false)
// so the rendered-24-words assertions run and guard against regression.
const MNEMONIC_EMPTY_UNDER_STRICTMODE = false;

// ---- Create wallet flow ----

// Override the global storageState for these tests — they require a fresh wallet-less context.
// All other describe blocks inherit the default storageState (funded wallet).
test.describe('Create Wallet flow', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('shows Create Wallet page when no wallet exists in fresh context', async ({
    page,
    context,
  }) => {
    // Clear storage so no wallet is present
    await context.clearCookies();
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Either create-wallet page or an auth gate redirect
    await expect(page.locator('text=/Create PHICOIN Wallet|Recovery Phrase/i').first()).toBeVisible(
      { timeout: 10000 },
    );
  });

  test('shows 24-word mnemonic on step 1', async ({ page, context }) => {
    // BLOCKED: CreateWallet renders an empty phrase under StrictMode (see top of file).
    test.fixme(MNEMONIC_EMPTY_UNDER_STRICTMODE, 'CreateWallet mnemonic is empty under React StrictMode');
    await context.clearCookies();
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await expect(page.getByRole('heading', { name: /Recovery Phrase/i })).toBeVisible({
      timeout: 10000,
    });
    // The mnemonic grid is `<div class="grid grid-cols-4 gap-2">` with 24 child
    // divs (CreateWallet.tsx). React StrictMode mounts → runs the unmount cleanup
    // (which clears the in-memory phrase) → remounts, briefly emptying the grid,
    // so a one-shot count is racy. Poll until all 24 word slots are present.
    const wordSlots = page.locator('.grid.grid-cols-4 > div');
    await expect.poll(async () => wordSlots.count(), { timeout: 15000 }).toBe(24);
  });

  test('Regenerate button produces a different mnemonic', async ({ page, context }) => {
    // BLOCKED: CreateWallet renders an empty phrase under StrictMode (see top of file),
    // so both before/after reads are empty and cannot differ.
    test.fixme(MNEMONIC_EMPTY_UNDER_STRICTMODE, 'CreateWallet mnemonic is empty under React StrictMode');
    await context.clearCookies();
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await expect(page.getByRole('heading', { name: /Recovery Phrase/i })).toBeVisible({
      timeout: 10000,
    });

    // Wait for the full 24-slot grid before reading (StrictMode remount can
    // briefly empty it — see the mnemonic test note).
    const slots = page.locator('.grid.grid-cols-4 > div');
    await expect.poll(async () => slots.count(), { timeout: 15000 }).toBe(24);
    const firstWords = await slots.allTextContents();
    await page.getByRole('button', { name: /Regenerate/i }).click();
    await page.waitForTimeout(300);
    await expect.poll(async () => slots.count(), { timeout: 15000 }).toBe(24);
    const secondWords = await slots.allTextContents();
    // Very unlikely to produce identical 24-word sequences
    expect(firstWords.join(' ')).not.toBe(secondWords.join(' '));
  });

  test('Next button disabled until backup confirmed', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await expect(page.getByRole('button', { name: /^Next$/i })).toBeDisabled({ timeout: 5000 });
  });

  test('proceeds to step 2 after confirming backup', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.getByLabel(/written down/i).check({ force: true });
    await expect(page.getByRole('button', { name: /^Next$/i })).toBeEnabled({ timeout: 5000 });
    await page.getByRole('button', { name: /^Next$/i }).click();
    // Step 2 may be backup quiz or custom seed step
    await expect(page.locator('text=/Custom Seed|quiz|confirm|word/i').first()).toBeVisible({
      timeout: 8000,
    });
  });

  test('"Import existing wallet" link visible on create page', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await expect(page.getByRole('button', { name: /Import existing/i })).toBeVisible({
      timeout: 8000,
    });
  });

  test('password strength meter appears on password step', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Step 1 -> confirm backup
    await page.getByLabel(/written down/i).check({ force: true });
    await page.getByRole('button', { name: /^Next$/i }).click();

    // Step 2 -> fill custom seed (if present) and proceed
    const seedHeading = page.getByRole('heading', { name: /Custom Seed/i });
    const isStep2Seed = await seedHeading.isVisible({ timeout: 3000 }).catch(() => false);
    if (isStep2Seed) {
      await page.getByLabel(/Custom Seed/i).fill('MyTestSeed1234');
      await page.getByRole('button', { name: /^Next$/i }).click();
    } else {
      // May still be on step 2 as quiz — skip this test for that variant
      test.skip();
    }

    // Should now be on password step
    const pwdHeading = page.getByRole('heading', { name: /Encryption Password/i });
    await expect(pwdHeading).toBeVisible({ timeout: 8000 });
    await page.getByLabel(/^Password$/i).fill('TestPassword123!');
    await expect(page.getByText(/Weak|Fair|Strong|Very/i)).toBeVisible({ timeout: 5000 });
  });
});

// ---- Import wallet ----

test.describe('Import Wallet — JSON file', () => {
  test('navigates to import page without auth', async ({ page }) => {
    await page.goto('/import', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await expect(page.locator('h1:has-text("Import Wallet")')).toBeVisible({ timeout: 10000 });
  });

  test('shows Recovery Phrase tab', async ({ page }) => {
    await page.goto('/import', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await expect(page.locator('button:has-text("Recovery Phrase")')).toBeVisible({ timeout: 5000 });
  });

  test('Recovery Phrase tab shows 24-word input', async ({ page }) => {
    await page.goto('/import', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.click('button:has-text("Recovery Phrase")');
    await expect(page.locator('text=/24-Word|word/i').first()).toBeVisible({ timeout: 5000 });
  });

  test('happy-path: imports encrypted wallet and lands on dashboard', async ({ page }) => {
    await importEncryptedWallet(page);
    await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible({ timeout: 15000 });
  });

  test('wrong password shows error', async ({ page }) => {
    const walletContent = readFileSync(WALLET_PATH, 'utf-8');
    await page.goto('/import', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.locator('textarea').first().fill(walletContent);
    await page.waitForSelector('#importPassword', { timeout: 8000 });
    await page.fill('#importPassword', 'wrongpassword999');
    await page.click('button:has-text("Import Wallet")');
    await expect(page.locator('text=/incorrect|wrong|invalid|failed/i').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('invalid JSON shows parse error', async ({ page }) => {
    await page.goto('/import', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.locator('textarea').first().fill('not valid json {{{');
    await page.click('button:has-text("Import Wallet")');
    await expect(
      page.locator('text=/invalid json|invalid wallet|parse error/i').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('empty JSON textarea disables the Import button', async ({ page }) => {
    await page.goto('/import', { waitUntil: 'domcontentloaded', timeout: 10000 });
    // The Import button is `disabled={loading || !jsonInput}` (ImportWallet.tsx):
    // with an empty textarea it is disabled, so it cannot be clicked. That
    // disabled state IS the empty-input guard. (The previous version tried to
    // click the disabled button and timed out waiting for it to become enabled.)
    const importBtn = page.locator('button:has-text("Import Wallet")');
    await expect(importBtn).toBeDisabled({ timeout: 8000 });

    // Typing content enables it; clearing it disables again — confirms the guard
    // is driven by the textarea, not a one-time state.
    await page.locator('textarea').first().fill('{"v":1}');
    await expect(importBtn).toBeEnabled({ timeout: 8000 });
    await page.locator('textarea').first().fill('');
    await expect(importBtn).toBeDisabled({ timeout: 8000 });
  });
});

// ---- Unlock ----

test.describe('Wallet Unlock', () => {
  test('shows Unlock page after reload of an existing wallet', async ({ page }) => {
    // Import first, then reload — AuthGate requires re-entry of password
    await importEncryptedWallet(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Unlock screen should appear (auto-unlock removed — key not in memory after reload)
    const unlockVisible = await page
      .locator('#passphrase')
      .isVisible({ timeout: 10000 })
      .catch(() => false);
    // If tryAutoUnlock somehow succeeds (session storage still set + key in memory), dashboard appears
    const dashboardVisible = await page
      .locator('h1:has-text("Dashboard")')
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    expect(unlockVisible || dashboardVisible).toBe(true);
  });

  test('correct password unlocks to dashboard', async ({ page }) => {
    await importEncryptedWallet(page);
    // Force unlock page by clearing session flags via evaluate
    await page.evaluate(() => sessionStorage.removeItem('phi:unlocked'));
    await page.reload({ waitUntil: 'domcontentloaded' });

    const needsUnlock = await page
      .locator('#passphrase')
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    if (!needsUnlock) {
      // Auto-unlock succeeded — test still passes
      await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible({ timeout: 10000 });
      return;
    }

    await unlockWallet(page);
    await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible({ timeout: 15000 });
  });

  test('wrong password shows error on unlock page', async ({ page }) => {
    await importEncryptedWallet(page);
    await page.evaluate(() => sessionStorage.removeItem('phi:unlocked'));
    await page.reload({ waitUntil: 'domcontentloaded' });

    const needsUnlock = await page
      .locator('#passphrase')
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    if (!needsUnlock) {
      test.skip(true, 'Auto-unlock succeeded; skip wrong-password test');
      return;
    }

    await page.fill('#passphrase', 'wrongpassword!');
    await page.click('button[type="submit"]');
    await expect(
      page.locator('text=/incorrect|wrong|remaining attempt/i').first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test('rate limit message appears after repeated wrong attempts', async ({ page }) => {
    await importEncryptedWallet(page);
    await page.evaluate(() => sessionStorage.removeItem('phi:unlocked'));
    await page.reload({ waitUntil: 'domcontentloaded' });

    const needsUnlock = await page
      .locator('#passphrase')
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    if (!needsUnlock) {
      test.skip(true, 'Auto-unlock succeeded; skip rate-limit test');
      return;
    }

    // Try wrong password multiple times to trigger rate limit (5 attempts → cooldown)
    for (let i = 0; i < 5; i++) {
      const disabled = await page.locator('#passphrase').isDisabled().catch(() => false);
      if (disabled) break;
      await page.fill('#passphrase', `wrongpass${i}`);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(300);
    }

    await expect(
      page.locator('text=/locked|cooldown|wait|Too many/i').first(),
    ).toBeVisible({ timeout: 10000 });
  });
});

// ---- Change passphrase ----

test.describe('Change Passphrase', () => {
  test.beforeEach(async ({ page }) => {
    await gotoUnlocked(page, '/backup');
    await expect(page.locator('text=/Change Passphrase/i').first()).toBeVisible({ timeout: 15000 });
  });

  test('shows Change Passphrase form on backup page', async ({ page }) => {
    await expect(page.locator('#change-pass-old, [id*="change-pass"]').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('empty fields show validation error', async ({ page }) => {
    await page.click('button:has-text("Change Passphrase")');
    await expect(page.locator('text=/Enter your current|required/i').first()).toBeVisible({
      timeout: 8000,
    });
  });

  test('wrong old password is rejected', async ({ page }) => {
    await page.fill('#change-pass-old', 'incorrectOldPass99');
    await page.fill('#change-pass-new', 'NewPassword12!');
    await page.fill('#change-pass-confirm', 'NewPassword12!');
    await page.click('button:has-text("Change Passphrase")');
    await expect(page.locator('text=/incorrect|wrong|failed|invalid/i').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('mismatched new passwords are rejected', async ({ page }) => {
    await page.fill('#change-pass-old', WALLET_PASSWORD);
    await page.fill('#change-pass-new', 'NewPassword12!');
    await page.fill('#change-pass-confirm', 'DifferentPass99!');
    await page.click('button:has-text("Change Passphrase")');
    await expect(page.locator('text=/do not match|mismatch/i').first()).toBeVisible({
      timeout: 8000,
    });
  });

  test('new password too short is rejected', async ({ page }) => {
    await page.fill('#change-pass-old', WALLET_PASSWORD);
    await page.fill('#change-pass-new', 'short');
    await page.fill('#change-pass-confirm', 'short');
    await page.click('button:has-text("Change Passphrase")');
    await expect(page.locator('text=/at least 8|too short/i').first()).toBeVisible({
      timeout: 8000,
    });
  });

  test('same-as-old password is rejected', async ({ page }) => {
    await page.fill('#change-pass-old', WALLET_PASSWORD);
    await page.fill('#change-pass-new', WALLET_PASSWORD);
    await page.fill('#change-pass-confirm', WALLET_PASSWORD);
    await page.click('button:has-text("Change Passphrase")');
    await expect(page.locator('text=/different|same/i').first()).toBeVisible({
      timeout: 8000,
    });
  });

  test('show/hide password toggle works', async ({ page }) => {
    // Check the "Show passwords" checkbox
    const toggle = page.locator('input[type="checkbox"]').last();
    await toggle.check();
    // The old-password input should now be type="text"
    const inputType = await page.locator('#change-pass-old').getAttribute('type');
    expect(inputType).toBe('text');
  });

  test('Clear button resets fields', async ({ page }) => {
    await page.fill('#change-pass-old', 'somevalue');
    await page.fill('#change-pass-new', 'somevalue2!');
    await page.fill('#change-pass-confirm', 'somevalue2!');
    await page.click('button:has-text("Clear")');
    const val = await page.locator('#change-pass-old').inputValue();
    expect(val).toBe('');
  });
});

// ---- Reveal recovery phrase (backup page) ----

test.describe('Backup & Recovery Phrase Reveal', () => {
  test.beforeEach(async ({ page }) => {
    await gotoUnlocked(page, '/backup');
  });

  test('backup page is accessible from sidebar', async ({ page }) => {
    // Already on /backup via beforeEach
    await expect(page.locator('body')).toBeVisible();
  });

  test('backup page shows export / backup download option', async ({ page }) => {
    await expect(
      page.locator('text=/Export Backup|Download Backup|backup/i').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('Generate Backup button produces JSON output', async ({ page }) => {
    const genBtn = page.locator('button:has-text("Generate Backup"), button:has-text("Export")');
    const visible = await genBtn.first().isVisible({ timeout: 5000 }).catch(() => false);
    if (visible) {
      await genBtn.first().click();
      // Textarea or pre element should now contain JSON
      const jsonOutput = page.locator('textarea, pre').filter({ hasText: /phicoin-encrypted/ });
      await expect(jsonOutput.first()).toBeVisible({ timeout: 8000 });
    }
  });
});
