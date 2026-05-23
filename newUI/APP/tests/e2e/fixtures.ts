/**
 * Shared Playwright test helpers for PHICOIN wallet E2E tests.
 *
 * Key design rules:
 * - Never use `waitUntil: 'networkidle'` — the app polls RPC forever and hangs.
 *   Always use `domcontentloaded` + explicit `expect(locator).toBeVisible()` waits.
 * - After any full page.reload() the AuthGate shows the Unlock screen (auto-unlock
 *   was removed). Use `unlockWallet()` after every reload that requires auth.
 * - global-setup.ts imports the wallet once and saves storageState. Most tests
 *   receive storageState via playwright.config.ts and just need to navigate.
 *   importEncryptedWallet() detects an existing wallet in localStorage and skips
 *   the expensive PBKDF2 import, calling only unlockWallet() if needed.
 */
import { Page, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { env } from 'node:process';

// ---- Constants ----

// Test wallet path + password come from the environment — never hard-code the
// password of a wallet that holds real funds. Set TEST_WALLET_PASSWORD (and
// optionally TEST_WALLET_PATH) before running the suite.
export const WALLET_PATH =
  env.TEST_WALLET_PATH || '../design/phicoin-wallet-backup-2026-05-15.json';
export const WALLET_PASSWORD = env.TEST_WALLET_PASSWORD || '';

/**
 * A valid-format PHICOIN address used ONLY as a generic external send destination.
 * NOTE: this is NOT one of the imported wallet's own/funded addresses (it belongs to a
 * different wallet); the wallet's real funded addresses are derived during import.
 * Never assert the wallet's balance against this address.
 */
export const TEST_ADDRESS = 'Pum3xBGkPWK9pcpvanoMyfGTdWYuzMWmsr';

/**
 * A second valid PHICOIN address (unused/unfunded) for multi-recipient tests.
 * Using a real-format address (P + 33 base58 chars) avoids address-validation rejections.
 */
export const TEST_ADDRESS_2 = 'PkjQxN1CZoFpUmdnm3RUb5RKHbN7QNGj3K';

// ---- Helpers ----

/**
 * Ensure the funded test wallet is loaded and the session is unlocked.
 *
 * Fast path (global-setup already ran):
 *   - If the storageState already contains the wallet (localStorage has phi:wallet*),
 *     just navigate to "/" and unlock if the AuthGate is blocking.
 *
 * Slow path (fresh context without storageState):
 *   - Import the wallet via /import (takes ~30s for PBKDF2).
 *
 * After this call the page is on "/" with the wallet unlocked in-session.
 */
export async function importEncryptedWallet(
  page: Page,
  walletPath: string = WALLET_PATH,
  password: string = WALLET_PASSWORD,
): Promise<void> {
  // Check if wallet data is already in localStorage (set by global-setup storageState).
  // v2 wallet keys: phi:v2:encryptedSeed + phi:v2:salt
  // v1 wallet keys: phi:salt + phi:sentinel
  const hasWallet = await page.evaluate(() => {
    const hasV2 = !!localStorage.getItem('phi:v2:encryptedSeed') && !!localStorage.getItem('phi:v2:salt');
    const hasV1 = !!localStorage.getItem('phi:salt') && !!localStorage.getItem('phi:sentinel');
    return hasV2 || hasV1;
  }).catch(() => false);

  if (hasWallet) {
    // Fast path: wallet already in storage, just navigate and unlock if needed
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Check if dashboard is already visible
    const onDashboard = await page
      .locator('h1:has-text("Dashboard")')
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (onDashboard) return;

    // Unlock screen may be showing
    const needsUnlock = await page
      .locator('#passphrase')
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (needsUnlock) {
      await unlockWallet(page, password);
    } else {
      // Wait a bit more for dashboard
      await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible({ timeout: 15000 });
    }
    return;
  }

  // Slow path: import the wallet fresh (takes ~30s for PBKDF2)
  const walletContent = readFileSync(walletPath, 'utf-8');

  await page.goto('/import', { waitUntil: 'domcontentloaded', timeout: 15000 });

  // Paste JSON into the textarea
  const textarea = page.locator('textarea');
  await textarea.first().fill(walletContent);

  // Wait for password field to appear (V2 wallet triggers it after JSON parse)
  await page.waitForSelector('#importPassword', { timeout: 8000 });
  await page.fill('#importPassword', password);

  // Click import button
  await page.click('button:has-text("Import Wallet")');

  // Wait for navigation to dashboard
  await page.waitForURL('/', { timeout: 90000 }).catch(async () => {
    const url = page.url();
    if (url.includes('/import')) {
      const errorText = await page
        .locator('text=/incorrect|invalid|failed/i')
        .first()
        .textContent()
        .catch(() => '');
      throw new Error(`Import failed on /import. Error: ${errorText || 'Unknown error'}`);
    }
  });

  // Confirm we're on the dashboard
  await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible({ timeout: 30000 });
}

/**
 * Unlock an already-imported wallet after a page reload.
 * After a full reload, the AuthGate shows the Unlock screen.
 * Call this after `page.reload()` or `page.goto(url, {waitUntil:'domcontentloaded'})`.
 */
export async function unlockWallet(
  page: Page,
  password: string = WALLET_PASSWORD,
): Promise<void> {
  // If we're already on the dashboard, nothing to do.
  const onDashboard = await page
    .locator('h1:has-text("Dashboard")')
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (onDashboard) return;

  // Wait for the Unlock form
  await expect(page.locator('#passphrase')).toBeVisible({ timeout: 10000 });
  await page.fill('#passphrase', password);
  await page.click('button[type="submit"]');
  await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible({ timeout: 30000 });
}

/**
 * Navigate to a route AND ensure the wallet is unlocked at that route.
 *
 * IMPORTANT: auto-unlock was removed for security, so a full page load (goto/reload)
 * wipes the in-memory HD key and the AuthGate shows the Unlock screen. We therefore
 * navigate to the target route FIRST, then unlock — unlocking re-renders the
 * originally-requested route in place (the URL is preserved), so callers land on the
 * intended page already unlocked. Use this instead of `importEncryptedWallet()` +
 * `page.goto(path)` (which would unlock on "/" and then re-lock on the next goto).
 */
export async function gotoUnlocked(
  page: Page,
  path: string,
  password: string = WALLET_PASSWORD,
): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const needsUnlock = await page
    .locator('#passphrase')
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  if (needsUnlock) {
    await page.fill('#passphrase', password);
    await page.click('button[type="submit"]');
    // Unlock re-renders the requested route in place; wait for the Unlock form to go away.
    await expect(page.locator('#passphrase')).toBeHidden({ timeout: 30000 });
  }
}

/**
 * Navigate to a route via the sidebar link by its label, waiting for the URL.
 */
export async function navTo(page: Page, label: string, urlPath: string): Promise<void> {
  await page.getByRole('link', { name: label, exact: true }).click();
  await page.waitForURL(urlPath, { timeout: 10000 });
}
