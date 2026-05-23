/**
 * Shared Playwright test helpers for PHICOIN wallet E2E tests.
 *
 * Key design rules:
 * - Never use `waitUntil: 'networkidle'` — the app polls RPC forever and hangs.
 *   Always use `domcontentloaded` + explicit `expect(locator).toBeVisible()` waits.
 * - After any full page.reload() the AuthGate shows the Unlock screen (auto-unlock
 *   was removed). Use `unlockWallet()` after every reload that requires auth.
 */
import { Page, expect } from '@playwright/test';
import { readFileSync } from 'fs';

// ---- Constants ----

export const WALLET_PATH =
  '/media/runner/FILES/Phicoin_project/newUI/design/phicoin-wallet-backup-2026-05-15.json';
export const WALLET_PASSWORD = 'Qw11223344??';

/**
 * A valid funded test address derived from the test wallet.
 * Holds ~0.95 PHI and appears in ~11 transactions.
 */
export const TEST_ADDRESS = 'Pum3xBGkPWK9pcpvanoMyfGTdWYuzMWmsr';

/**
 * A second valid PHICOIN address (unused/unfunded) for multi-recipient tests.
 * Using a real-format address (P + 33 base58 chars) avoids address-validation rejections.
 */
export const TEST_ADDRESS_2 = 'PkjQxN1CZoFpUmdnm3RUb5RKHbN7QNGj3K';

// ---- Helpers ----

/**
 * Import the encrypted wallet via the /import page and wait for dashboard.
 * After this call the app is on "/" with the wallet unlocked in-session.
 */
export async function importEncryptedWallet(
  page: Page,
  walletPath: string = WALLET_PATH,
  password: string = WALLET_PASSWORD,
): Promise<void> {
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
  await page.waitForURL('/', { timeout: 20000 }).catch(async () => {
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
  await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible({ timeout: 15000 });
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
  await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible({ timeout: 15000 });
}

/**
 * Navigate to a route via the sidebar link by its label, waiting for the URL.
 */
export async function navTo(page: Page, label: string, urlPath: string): Promise<void> {
  await page.getByRole('link', { name: label, exact: true }).click();
  await page.waitForURL(urlPath, { timeout: 10000 });
}
