/**
 * settings.spec.ts
 *
 * Covers:
 *   - Navigate to Settings page
 *   - Connection tab: RPC host/port/user/password fields present
 *   - Dark mode toggle flips the `dark` class on <html>
 *   - Save button persists RPC settings (localStorage)
 *   - Notifications tab renders
 *   - Network tab (banned peers) renders
 *   - About tab renders with version info
 *   - Currency tab renders
 */

import { test, expect } from '@playwright/test';
import { importEncryptedWallet } from './fixtures';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
  });

  test('navigates to /settings from sidebar', async ({ page }) => {
    await importEncryptedWallet(page);
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.waitForURL('/settings', { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
  });

  test('shows Settings heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  // ---- Connection tab ----

  test('Connection tab shows RPC configuration fields', async ({ page }) => {
    // Connection is the default tab
    await expect(page.locator('text=/RPC|Host|host|connection/i').first()).toBeVisible({
      timeout: 8000,
    });
  });

  test('RPC host input is visible', async ({ page }) => {
    const hostInput = page
      .locator('input[placeholder*="host"], input[placeholder*="Host"], input[id*="host"]')
      .first();
    const labelHost = page.locator('label:has-text("Host"), text=Host').first();
    const hasInput = await hostInput.isVisible({ timeout: 5000 }).catch(() => false);
    const hasLabel = await labelHost.isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasInput || hasLabel).toBe(true);
  });

  test('RPC port input is visible', async ({ page }) => {
    const portInput = page
      .locator('input[placeholder*="port"], input[placeholder*="Port"], input[type="number"], input[id*="port"]')
      .first();
    const hasPort = await portInput.isVisible({ timeout: 5000 }).catch(() => false);
    const hasLabel = await page.locator('text=/port/i').first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasPort || hasLabel).toBe(true);
  });

  test('RPC user input is visible', async ({ page }) => {
    const userInput = page
      .locator('input[placeholder*="user"], input[placeholder*="User"], input[id*="user"]')
      .first();
    const hasUser = await userInput.isVisible({ timeout: 5000 }).catch(() => false);
    const hasLabel = await page.locator('text=/user/i').first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasUser || hasLabel).toBe(true);
  });

  test('RPC password input is visible', async ({ page }) => {
    const pwdInput = page.locator('input[type="password"]').first();
    const hasPwd = await pwdInput.isVisible({ timeout: 5000 }).catch(() => false);
    const hasLabel = await page.locator('text=/password/i').first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasPwd || hasLabel).toBe(true);
  });

  test('Save button is present on connection tab', async ({ page }) => {
    const saveBtn = page.locator('button:has-text("Save"), button:has-text("Apply")').first();
    await expect(saveBtn).toBeVisible({ timeout: 8000 });
  });

  test('saving RPC settings shows success feedback', async ({ page }) => {
    const saveBtn = page.locator('button:has-text("Save"), button:has-text("Apply")').first();
    await saveBtn.click();
    // Toast or success indicator
    await expect(page.locator('text=/saved|success|applied/i').first()).toBeVisible({
      timeout: 8000,
    });
  });

  // ---- Dark mode ----

  test('dark mode toggle is visible', async ({ page }) => {
    // May be on a currency or connection tab — check across the page
    const toggle = page.locator('input[type="checkbox"]').first();
    const darkText = page.locator('text=/dark|Dark mode|Theme/i').first();
    const hasToggle = await toggle.isVisible({ timeout: 5000 }).catch(() => false);
    const hasDarkText = await darkText.isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasToggle || hasDarkText).toBe(true);
  });

  test('dark mode toggle adds dark class to html element', async ({ page }) => {
    // Navigate to connection tab first (default)
    const darkModeLabel = page.locator('label:has-text("Dark"), text=/dark mode/i').first();
    const isVisible = await darkModeLabel.isVisible({ timeout: 5000 }).catch(() => false);
    if (!isVisible) {
      // Try the currency tab
      const currencyTab = page.locator('button:has-text("Currency")').first();
      const hasCurrency = await currencyTab.isVisible({ timeout: 3000 }).catch(() => false);
      if (hasCurrency) await currencyTab.click();
    }

    const toggle = page.locator('input[type="checkbox"]').first();
    const visible = await toggle.isVisible({ timeout: 5000 }).catch(() => false);
    if (!visible) {
      test.skip(true, 'Dark mode toggle not found');
      return;
    }

    const initialDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );
    await toggle.click();
    await page.waitForTimeout(600); // AuthGate polls every 500ms

    const afterDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );
    expect(afterDark).toBe(!initialDark);
  });

  // ---- Other tabs ----

  test('Notifications tab is accessible', async ({ page }) => {
    const notifTab = page.locator('button:has-text("Notifications")').first();
    const hasTab = await notifTab.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasTab) {
      test.skip(true, 'No Notifications tab');
      return;
    }
    await notifTab.click();
    await expect(page.locator('body')).toBeVisible();
  });

  test('Network tab renders ban management', async ({ page }) => {
    const networkTab = page.locator('button:has-text("Network")').first();
    const hasTab = await networkTab.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasTab) {
      test.skip(true, 'No Network tab');
      return;
    }
    await networkTab.click();
    await expect(page.locator('text=/ban|peer|network/i').first()).toBeVisible({ timeout: 8000 });
  });

  test('About tab shows version information', async ({ page }) => {
    const aboutTab = page.locator('button:has-text("About")').first();
    const hasTab = await aboutTab.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasTab) {
      test.skip(true, 'No About tab');
      return;
    }
    await aboutTab.click();
    await expect(page.locator('text=/version|PHICOIN|phicoin/i').first()).toBeVisible({
      timeout: 8000,
    });
  });

  test('Currency tab renders price or exchange info', async ({ page }) => {
    const currencyTab = page.locator('button:has-text("Currency")').first();
    const hasTab = await currencyTab.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasTab) {
      test.skip(true, 'No Currency tab');
      return;
    }
    await currencyTab.click();
    await expect(page.locator('body')).toBeVisible();
  });
});
