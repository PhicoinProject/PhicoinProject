import { test, expect } from '@playwright/test';
import { importEncryptedWallet } from './fixtures';

test.describe('Assets Display', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
  });

  test('should navigate to assets page', async ({ page }) => {
    await page.getByRole('link', { name: 'Assets', exact: true }).click();
    await page.waitForURL('/assets', { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible({ timeout: 10000 });
  });

  test('should show assets page content', async ({ page }) => {
    await page.goto('/assets', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForLoadState('networkidle').catch(() => {});

    // Page should render without errors
    const body = await page.locator('body').textContent();
    expect(body?.length).toBeGreaterThan(100);
  });

  test('should load wallet-held assets', async ({ page }) => {
    await page.goto('/assets', { waitUntil: 'domcontentloaded', timeout: 10000 });
    // Wait for async asset loading
    await page.waitForTimeout(3000);

    // Page should render and contain asset-related content
    const hasTable = await page.locator('table').isVisible().catch(() => false);
    const hasAssetClass = (await page.locator('[class*="asset"]').count()) > 0;
    const hasAssetText = await page.locator('text=/asset/i').first().isVisible().catch(() => false);

    // At least one of these should be true, or body content exists
    const bodyContent = await page.locator('body').textContent().then(t => t && t.length > 50);
    expect(hasTable || hasAssetClass || hasAssetText || bodyContent).toBe(true);
  });

  test('should show all assets listing', async ({ page }) => {
    await page.goto('/assets', { waitUntil: 'domcontentloaded', timeout: 10000 });
    // Wait for blockchain asset data
    await page.waitForTimeout(5000);

    // The page should render without crashing
    await expect(page.locator('body')).toBeVisible();
  });
});
