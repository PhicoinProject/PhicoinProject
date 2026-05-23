/**
 * global-setup.ts
 *
 * Runs ONCE before the entire Playwright suite.
 * Imports the funded test wallet (PBKDF2 1M iters, ~30s), then saves the
 * full browser storageState (localStorage + sessionStorage) to a JSON file
 * that individual tests load via `storageState` in playwright.config.ts.
 *
 * Design notes:
 *  - The wallet import derives a key with 1M PBKDF2 iterations; doing this
 *    once globally saves ~30s × (number of tests) of runtime.
 *  - After reload the AuthGate re-shows the Unlock page because it checks
 *    sessionStorage. The storageState includes both localStorage (wallet data)
 *    AND the session unlock token so the very first page load skips the
 *    unlock screen too.
 *  - Tests that explicitly test the locked/unlock flow call
 *    importEncryptedWallet() directly and do NOT use storageState.
 */

import { chromium } from '@playwright/test';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as fs from 'fs';
import { env } from 'node:process';

const WALLET_PATH =
  env.TEST_WALLET_PATH || '../design/phicoin-wallet-backup-2026-05-15.json';
const WALLET_PASSWORD = env.TEST_WALLET_PASSWORD || '';
const BASE_URL = env.TEST_BASE_URL || 'http://localhost:13001';
export const STORAGE_STATE_PATH = path.resolve('test-results/storageState.json');

async function globalSetup() {
  console.log('\n[global-setup] Importing test wallet (PBKDF2 ~30s) ...');

  // Ensure output dir exists
  const dir = path.dirname(STORAGE_STATE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const walletContent = readFileSync(WALLET_PATH, 'utf-8');

    // Navigate to import page
    await page.goto(`${BASE_URL}/import`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('textarea', { timeout: 10000 });

    // Fill textarea with wallet JSON
    await page.locator('textarea').first().fill(walletContent);

    // Wait for password field (V2 wallet JSON triggers it after parse)
    await page.waitForSelector('#importPassword', { timeout: 10000 });
    await page.fill('#importPassword', WALLET_PASSWORD);

    // Submit import
    await page.click('button:has-text("Import Wallet")');

    // Wait for navigation to dashboard (PBKDF2 may take up to 60s)
    await page.waitForURL(`${BASE_URL}/`, { timeout: 90000 });
    await page.waitForSelector('h1:has-text("Dashboard")', { timeout: 30000 });

    console.log('[global-setup] Wallet imported successfully. Saving storageState...');

    // Save the full storage state
    await context.storageState({ path: STORAGE_STATE_PATH });

    console.log(`[global-setup] storageState saved to: ${STORAGE_STATE_PATH}`);
  } catch (err) {
    console.error('[global-setup] FAILED to import wallet:', err);
    throw err;
  } finally {
    await browser.close();
  }
}

export default globalSetup;
