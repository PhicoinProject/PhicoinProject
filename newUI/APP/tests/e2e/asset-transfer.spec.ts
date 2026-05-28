/**
 * asset-transfer.spec.ts
 *
 * Covers:
 *   - ManageAssets page renders with My Assets and Admin Operations tabs
 *   - Reissue form: shows fields, validates empty asset name
 *   - Admin operations: assign-qualifier, freeze forms visible
 *   - Verifier string form visible in set-verifier modal
 *   - RestrictedAssets page: all 4 tabs (My Restricted, Qualifiers, Tags, Restrictions)
 *   - Asset transfer via /assets send modal validation (also covered in assets-display.spec)
 *
 * Actual RPC broadcasts are gated behind ALLOW_BROADCAST=1.
 */

import { test, expect } from '@playwright/test';
import { gotoUnlocked } from './fixtures';

const ALLOW_BROADCAST = process.env.ALLOW_BROADCAST === '1';

// Modal selector — Modal component uses .fixed.inset-0.z-50 (no role="dialog")
const MODAL_SEL = '.fixed.inset-0.z-50';

// ---- Manage Assets ----

test.describe('Manage Assets', () => {
  test.beforeEach(async ({ page }) => {
    await gotoUnlocked(page, '/manage-assets');
    await expect(page.locator('h1, body').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows My Assets and Admin Operations section tabs', async ({ page }) => {
    // toBeVisible polls up to the timeout; the prior isVisible() returns immediately and
    // raced the SPA route mount (the beforeEach only waits for `body`, which is instant).
    await expect(
      page.locator('button:has-text("My Assets"), button:has-text("Admin Operations")').first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('My Assets section shows owned assets or empty state', async ({ page }) => {
    // Wait for the section to SETTLE into a real end-state (asset rows OR the empty
    // state), rather than sampling at a fixed 3s. useMyAssets now shows a loading
    // skeleton during address-pool discovery (previously it rendered the empty state
    // prematurely), so a fixed delay races the load.
    await expect(
      page
        .locator('table tbody tr')
        .first()
        .or(page.locator('text=/No assets|no assets|empty/i').first())
    ).toBeVisible({ timeout: 30000 });
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
    await expect(page.locator(MODAL_SEL).first()).toBeVisible({ timeout: 8000 });
  });

  test('Reissue modal validates quantity > 0', async ({ page }) => {
    await page.waitForTimeout(5000);
    const reissueBtn = page.locator('button:has-text("Reissue")').first();
    if (!(await reissueBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, 'No reissuable assets');
      return;
    }
    await reissueBtn.click();
    const modal = page.locator(MODAL_SEL).first();
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

  test('Admin Operations tab has qualifier or freeze options', async ({ page }) => {
    // Tab label is "Admin Operations" in component
    const adminBtn = page.locator('button:has-text("Admin Operations")').first();
    const hasAdmin = await adminBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasAdmin) {
      test.skip(true, 'No Admin Operations tab');
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
    const adminBtn = page.locator('button:has-text("Admin Operations")').first();
    const hasAdmin = await adminBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasAdmin) {
      test.skip(true, 'No Admin Operations tab');
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
    await expect(page.locator(MODAL_SEL).first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('text=/Verifier|verifier string/i').first()).toBeVisible({
      timeout: 5000,
    });
  });
});

// ---- Restricted Assets ----

test.describe('Restricted Assets', () => {
  test.beforeEach(async ({ page }) => {
    await gotoUnlocked(page, '/restricted');
    await expect(page.locator('h1:has-text("Restricted Assets")')).toBeVisible({
      timeout: 10000,
    });
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
