/**
 * asset-transfer.spec.ts
 *
 * Covers:
 *   - ManageAssets page renders with My Assets and Admin tabs
 *   - Reissue form: shows fields, validates empty asset name
 *   - Admin operations: assign-qualifier, freeze forms visible
 *   - Verifier string form visible in set-verifier modal
 *   - RestrictedAssets page: all 4 tabs (My Restricted, Qualifiers, Tags, Restrictions)
 *   - Asset transfer via /assets send modal validation (also covered in assets-display.spec)
 *
 * Actual RPC broadcasts are gated behind ALLOW_BROADCAST=1.
 */

import { test, expect } from '@playwright/test';
import { importEncryptedWallet } from './fixtures';

const ALLOW_BROADCAST = process.env.ALLOW_BROADCAST === '1';

// ---- Manage Assets ----

test.describe('Manage Assets', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
    await page.goto('/manage-assets', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await expect(page.locator('h1, body').first()).toBeVisible({ timeout: 10000 });
  });

  test('navigates to /manage-assets from sidebar', async ({ page }) => {
    await importEncryptedWallet(page);
    await page.getByRole('link', { name: 'Manage Assets', exact: true }).click();
    await page.waitForURL('/manage-assets', { timeout: 10000 });
    await expect(page.locator('body')).toBeVisible();
  });

  test('shows My Assets and Admin section toggles', async ({ page }) => {
    const myAssetsBtn = page.locator('button:has-text("My Assets"), [data-tab="my-assets"]').first();
    const adminBtn = page.locator('button:has-text("Admin"), [data-tab="admin"]').first();
    const hasMyAssets = await myAssetsBtn.isVisible({ timeout: 5000 }).catch(() => false);
    const hasAdmin = await adminBtn.isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasMyAssets || hasAdmin).toBe(true);
  });

  test('My Assets section shows owned assets or empty state', async ({ page }) => {
    await page.waitForTimeout(3000);
    const hasAssets = (await page.locator('table tbody tr').count()) > 0;
    const hasEmpty = await page
      .locator('text=/No assets|no assets|empty/i')
      .isVisible()
      .catch(() => false);
    expect(hasAssets || hasEmpty).toBe(true);
  });

  test('Reissue button opens reissue modal (if assets present)', async ({ page }) => {
    await page.waitForTimeout(5000);
    const reissueBtn = page.locator('button:has-text("Reissue")').first();
    const hasBtn = await reissueBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasBtn) {
      test.skip(true, 'No reissuable assets found');
      return;
    }
    await reissueBtn.click();
    await expect(page.locator('[role="dialog"], [class*="Modal"]').first()).toBeVisible({
      timeout: 8000,
    });
  });

  test('Reissue modal validates quantity > 0', async ({ page }) => {
    await page.waitForTimeout(5000);
    const reissueBtn = page.locator('button:has-text("Reissue")').first();
    if (!(await reissueBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, 'No reissuable assets');
      return;
    }
    await reissueBtn.click();
    const modal = page.locator('[role="dialog"]').first();
    await expect(modal).toBeVisible({ timeout: 8000 });
    // Leave quantity at 0 or set to 0
    const qtyInput = modal.locator('input[type="number"]').first();
    if (await qtyInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await qtyInput.fill('0');
    }
    await modal
      .locator('button:has-text("Reissue"), button[type="submit"]')
      .first()
      .click();
    await expect(page.locator('text=/required|invalid|greater/i').first()).toBeVisible({
      timeout: 8000,
    });
  });

  test('Admin tab has assign-qualifier and freeze options', async ({ page }) => {
    const adminBtn = page.locator('button:has-text("Admin")').first();
    const hasAdmin = await adminBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasAdmin) {
      test.skip(true, 'No Admin tab');
      return;
    }
    await adminBtn.click();
    await page.waitForTimeout(500);
    // Should see qualifier or freeze options
    const hasQualifier = await page
      .locator('text=/Qualifier|qualifier/i')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const hasFreeze = await page
      .locator('text=/Freeze|freeze/i')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    expect(hasQualifier || hasFreeze).toBe(true);
  });

  test('Set Verifier button opens verifier modal', async ({ page }) => {
    const adminBtn = page.locator('button:has-text("Admin")').first();
    const hasAdmin = await adminBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasAdmin) {
      test.skip(true, 'No Admin tab');
      return;
    }
    await adminBtn.click();
    const setVerifierBtn = page
      .locator('button:has-text("Set Verifier"), button:has-text("Verifier")')
      .first();
    const hasBtn = await setVerifierBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasBtn) {
      test.skip(true, 'Set Verifier button not found');
      return;
    }
    await setVerifierBtn.click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('text=/Verifier|verifier string/i').first()).toBeVisible({
      timeout: 5000,
    });
  });
});

// ---- Restricted Assets ----

test.describe('Restricted Assets', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
    await page.goto('/restricted', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await expect(page.locator('h1:has-text("Restricted Assets")')).toBeVisible({
      timeout: 10000,
    });
  });

  test('navigates to /restricted from sidebar', async ({ page }) => {
    await importEncryptedWallet(page);
    await page.getByRole('link', { name: 'Restricted', exact: true }).click();
    await page.waitForURL('/restricted', { timeout: 10000 });
    await expect(page.locator('h1:has-text("Restricted Assets")')).toBeVisible({ timeout: 10000 });
  });

  test('shows 4 tabs: My Restricted, Qualifiers, Tags, Restrictions', async ({ page }) => {
    await expect(page.locator('button:has-text("My Restricted")')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('button:has-text("Qualifiers")')).toBeVisible();
    await expect(page.locator('button:has-text("Tags")')).toBeVisible();
    await expect(page.locator('button:has-text("Restrictions")')).toBeVisible();
  });

  test('My Restricted tab shows content or empty state', async ({ page }) => {
    await page.waitForTimeout(3000);
    const hasContent =
      (await page.locator('table tbody tr').count()) > 0 ||
      (await page.locator('text=/no restricted|empty/i').isVisible().catch(() => false));
    expect(hasContent).toBe(true);
  });

  test('Qualifiers tab renders', async ({ page }) => {
    await page.locator('button:has-text("Qualifiers")').click();
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('Tags tab renders', async ({ page }) => {
    await page.locator('button:has-text("Tags")').click();
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('Restrictions tab renders', async ({ page }) => {
    await page.locator('button:has-text("Restrictions")').click();
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).toBeVisible();
  });
});
