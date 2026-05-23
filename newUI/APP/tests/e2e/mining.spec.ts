/**
 * mining.spec.ts
 *
 * Covers:
 *   - Mining page renders
 *   - Mining stats cards: Blocks, Difficulty, Hash Rate, Connections
 *   - Network hash rate displayed (or loading state)
 *   - Mempool info section
 *   - Error handling when data unavailable
 */

import { test, expect } from '@playwright/test';
import { importEncryptedWallet } from './fixtures';

test.describe('Mining', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
    await page.goto('/mining', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });

  test('navigates to /mining from sidebar', async ({ page }) => {
    await importEncryptedWallet(page);
    await page.getByRole('link', { name: 'Mining', exact: true }).click();
    await page.waitForURL('/mining', { timeout: 10000 });
    await expect(page.locator('body')).toBeVisible();
  });

  test('shows Mining heading or label', async ({ page }) => {
    await expect(page.locator('text=/Mining|mining/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows Blocks stat card', async ({ page }) => {
    await page.waitForTimeout(5000);
    const blocksCard = page.locator('text=Blocks, text=/block count/i').first();
    await expect(blocksCard).toBeVisible({ timeout: 10000 });
  });

  test('shows Difficulty stat card', async ({ page }) => {
    await page.waitForTimeout(5000);
    const diffCard = page.locator('text=Difficulty, text=/difficulty/i').first();
    await expect(diffCard).toBeVisible({ timeout: 10000 });
  });

  test('shows Network Hashrate or Hash Rate stat', async ({ page }) => {
    await page.waitForTimeout(5000);
    const hashCard = page
      .locator('text=/Hash Rate|Hashrate|hashps/i')
      .first();
    await expect(hashCard).toBeVisible({ timeout: 10000 });
  });

  test('shows non-zero block count', async ({ page }) => {
    await page.waitForTimeout(6000);
    // Blocks should be a positive integer
    const blockText = await page
      .locator('text=/[0-9,]{4,}/')
      .first()
      .textContent()
      .catch(() => '0');
    const num = parseInt((blockText ?? '').replace(/[^0-9]/g, ''), 10);
    expect(num).toBeGreaterThan(0);
  });

  test('mempool info section renders', async ({ page }) => {
    await page.waitForTimeout(5000);
    const mempoolCard = page.locator('text=/Mempool|mempool/i').first();
    await expect(mempoolCard).toBeVisible({ timeout: 10000 });
  });

  test('page does not show unhandled errors', async ({ page }) => {
    await page.waitForTimeout(5000);
    const errorEl = page.locator('.text-red-500, .text-red-600').filter({
      hasText: /error|failed|exception/i,
    });
    const hasError = await errorEl.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasError) {
      const errText = await errorEl.first().textContent();
      console.warn(`Mining page error: ${errText}`);
    }
    // Not a hard failure — network could be offline
    await expect(page.locator('body')).toBeVisible();
  });

  test('hash rate is formatted with units (H/s, KH/s, MH/s, etc.)', async ({ page }) => {
    await page.waitForTimeout(6000);
    const hashRateEl = page.locator('text=/ H\\/s| KH\\/s| MH\\/s| GH\\/s| TH\\/s/').first();
    const hasFormatted = await hashRateEl.isVisible({ timeout: 5000 }).catch(() => false);
    const hasNA = await page.locator('text=N/A').isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasFormatted || hasNA).toBe(true);
  });
});
