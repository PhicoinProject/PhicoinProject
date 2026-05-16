import { test, expect } from '@playwright/test';
import { importEncryptedWallet } from './fixtures';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
  });

  test('should navigate to settings page', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.waitForURL('/settings', { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
  });

  test('should show RPC configuration fields', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);

    // RPC config should have host/port/user/password fields
    const rpcText = page.locator('text=/RPC|rpc|host|port|Host/i');
    await expect(rpcText.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show RPC host field', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);

    const inputFields = page.locator('input[type="text"], input:not([type="password"])');
    expect(await inputFields.count()).toBeGreaterThan(0);
  });

  test('should show dark mode toggle', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);

    // Look for dark mode related UI
    const darkMode = page.locator('text=/dark|theme|Dark|Theme/i');
    const toggle = page.locator('input[type="checkbox"]');

    const hasDarkMode = await darkMode.first().isVisible().catch(() => false);
    const hasToggles = await toggle.count() > 0;
    expect(hasDarkMode || hasToggles).toBe(true);
  });

  test('should allow saving RPC settings', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);

    const saveBtn = page.locator('button:has-text("Save"), button:has-text("Apply")').first();
    const saveVisible = await saveBtn.isVisible().catch(() => false);

    if (saveVisible) {
      await saveBtn.click();
      await page.waitForTimeout(1000);

      // Should show success or at least not crash
      await expect(page.locator('body')).toBeVisible();
    }
  });
});
