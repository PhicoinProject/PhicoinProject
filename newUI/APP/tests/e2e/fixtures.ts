/**
 * Shared Playwright test helpers for PHICOIN wallet E2E tests.
 */
import { Page } from '@playwright/test';
import { readFileSync } from 'fs';

export const WALLET_PATH = '/media/runner/FILES/Phicoin_project/newUI/design/phicoin-wallet-backup-2026-05-15.json';
export const WALLET_PASSWORD = 'Qw11223344??';
export const TEST_ADDRESS = 'Pum3xBGkPWK9pcpvanoMyfGTdWYuzMWmsr';

/**
 * Import the encrypted wallet via the /import page and wait for dashboard.
 */
export async function importEncryptedWallet(
  page: Page,
  walletPath: string = WALLET_PATH,
  password: string = WALLET_PASSWORD,
) {
  const walletContent = readFileSync(walletPath, 'utf-8');

  await page.goto('/import', { waitUntil: 'domcontentloaded', timeout: 15000 });

  // Paste JSON into the textarea
  const textarea = page.locator('textarea');
  await textarea.first().fill(walletContent);

  // Wait for password field to appear (V2 wallet triggers it after JSON parse)
  await page.waitForSelector('#importPassword', { timeout: 5000 });
  await page.fill('#importPassword', password);

  // Click import button
  await page.click('button:has-text("Import Wallet")');

  // Wait for navigation to dashboard
  await page.waitForURL('/', { timeout: 15000 }).catch(async () => {
    const url = page.url();
    if (url.includes('/import')) {
      const errorText = await page.locator('text=/incorrect|invalid|failed/i').first().textContent().catch(() => '');
      throw new Error(`Import failed on /import. Error: ${errorText || 'Unknown error'}`);
    }
  });
}
