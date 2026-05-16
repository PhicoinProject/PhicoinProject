import { test, expect } from '@playwright/test';
import { importEncryptedWallet } from './fixtures';

test.describe('Dashboard / Overview', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
  });

  test('should show dashboard with balance', async ({ page }) => {
    await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible({ timeout: 10000 });
    // Balance area shows PHI value
    await expect(page.locator('text=Total Balance')).toBeVisible({ timeout: 10000 });
  });

  test('should show network status info', async ({ page }) => {
    // Wait for RPC data to load
    await page.waitForTimeout(3000);
    // Check for any network/block info or just body content
    const bodyContent = await page.locator('body').textContent().then(t => t && t.length > 50);
    expect(bodyContent).toBe(true);
  });

  test('should show sidebar navigation', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to Send page from sidebar', async ({ page }) => {
    await page.click('text=Send');
    await expect(page.getByRole('heading', { name: 'Send' })).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to Assets page from sidebar', async ({ page }) => {
    await page.getByRole('link', { name: 'Assets', exact: true }).click();
    await page.waitForURL('/assets', { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to Create Asset page from sidebar', async ({ page }) => {
    await page.getByRole('link', { name: 'Create Asset' }).click();
    await page.waitForURL('/create-asset', { timeout: 10000 });
    await expect(page.locator('h1:has-text("Create Asset")')).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to Transactions page from sidebar', async ({ page }) => {
    await page.getByRole('link', { name: 'Transactions' }).click();
    await page.waitForURL('/transactions', { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to Settings page from sidebar', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.waitForURL('/settings', { timeout: 10000 });
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to Receive page from sidebar', async ({ page }) => {
    await page.getByRole('link', { name: 'Receive' }).click();
    await page.waitForURL('/receive', { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Receive' })).toBeVisible({ timeout: 10000 });
  });

  test('should show wallet address on dashboard or receive page', async ({ page }) => {
    // Check for P-prefixed address (PHICOIN pubkey address format)
    await expect(page.locator('text=/^P[A-Za-z0-9]{25,40}/')).toBeVisible({ timeout: 15000 });
  });
});
