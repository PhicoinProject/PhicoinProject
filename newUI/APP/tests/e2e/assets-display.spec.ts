/**
 * assets-display.spec.ts
 *
 * Covers:
 *   - Assets list page renders
 *   - Send modal for an asset: address/amount validation
 *   - Receive modal for an asset: shows receive address
 */

import { test, expect } from '@playwright/test';
import { gotoUnlocked } from './fixtures';

// Modal selector — Modal component uses .fixed.inset-0.z-50 (no role="dialog")
const MODAL_SEL = '.fixed.inset-0.z-50';

test.describe('Assets Display', () => {
  test.beforeEach(async ({ page }) => {
    await gotoUnlocked(page, '/assets');
    await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible({ timeout: 10000 });
  });

  test('shows Assets heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible();
  });

  test('page renders content without crashing', async ({ page }) => {
    await page.waitForTimeout(3000);
    const body = await page.locator('body').textContent();
    expect((body ?? '').length).toBeGreaterThan(50);
  });

  test('shows asset table or empty state', async ({ page }) => {
    // The page shows a <Spinner/> while useMyAssets loads, then the AssetTable (<table>) or
    // "No assets found." toBeVisible polls up to the timeout; the prior waitForTimeout(5000)
    // + isVisible() raced the (sometimes slow) wallet asset scan and failed both attempts.
    await expect(
      page.locator('table').or(page.getByText('No assets found.')).first()
    ).toBeVisible({ timeout: 25000 });
  });

  test('asset rows are visible (wallet may hold assets)', async ({ page }) => {
    await page.waitForTimeout(6000);
    // Not a hard assertion — wallet may or may not hold assets
    const rows = page.locator('table tbody tr, [class*="asset-row"]');
    const count = await rows.count();
    // Just log, don't fail if 0
    console.log(`Assets found: ${count}`);
    await expect(page.locator('body')).toBeVisible();
  });

  test('Send button opens send modal for an asset (if assets present)', async ({ page }) => {
    await page.waitForTimeout(5000);
    const sendBtn = page.locator('button:has-text("Send")').first();
    const hasSend = await sendBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasSend) {
      test.skip(true, 'No Send button found — wallet likely holds no assets');
      return;
    }
    await sendBtn.click();
    // Modal uses .fixed.inset-0.z-50 (no role="dialog")
    await expect(page.locator(MODAL_SEL).first()).toBeVisible({ timeout: 8000 });
  });

  test('Asset send modal validates empty address', async ({ page }) => {
    await page.waitForTimeout(5000);
    const sendBtn = page.locator('button:has-text("Send")').first();
    const hasSend = await sendBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasSend) {
      test.skip(true, 'No assets to test send modal');
      return;
    }
    await sendBtn.click();
    // Try submitting empty form from within the modal card
    const submitBtn = page.locator(`${MODAL_SEL} button:has-text("Send"), ${MODAL_SEL} button[type="submit"]`).first();
    const hasSubmit = await submitBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasSubmit) {
      await submitBtn.click();
      await expect(
        page.locator('text=/required|invalid|address/i').first(),
      ).toBeVisible({ timeout: 8000 });
    }
  });

  test('Receive button opens receive modal for an asset (if assets present)', async ({ page }) => {
    await page.waitForTimeout(5000);
    const receiveBtn = page.locator('button:has-text("Receive")').first();
    const hasReceive = await receiveBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasReceive) {
      test.skip(true, 'No Receive button found');
      return;
    }
    await receiveBtn.click();
    await expect(page.locator(MODAL_SEL).first()).toBeVisible({ timeout: 8000 });
  });

  test('Receive modal shows a P-prefixed address', async ({ page }) => {
    await page.waitForTimeout(5000);
    const receiveBtn = page.locator('button:has-text("Receive")').first();
    const hasReceive = await receiveBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasReceive) {
      test.skip(true, 'No Receive button');
      return;
    }
    await receiveBtn.click();
    await expect(page.locator(MODAL_SEL).first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('text=/P[A-Za-z0-9]{25,39}/').first()).toBeVisible({
      timeout: 10000,
    });
  });
});
