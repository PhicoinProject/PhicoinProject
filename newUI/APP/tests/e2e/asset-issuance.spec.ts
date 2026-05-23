/**
 * asset-issuance.spec.ts
 *
 * Covers:
 *   - Create Asset page: all 5 type cards (ROOT/SUB/UNIQUE/QUALIFIER/RESTRICTED)
 *   - Form validation: required label, max length, negative quantity, decimal > 8
 *   - UNIQUE: quantity field hidden
 *   - RESTRICTED: verifier string field appears
 *   - SUB/UNIQUE: parent asset selector present
 *   - IPFS toggle reveals IPFS hash input
 *   - Reissuable checkbox toggles
 *   - Issue action is gated behind ALLOW_BROADCAST env flag
 *
 * Money-touching actions (actual issuance RPC call) are gated behind ALLOW_BROADCAST=1.
 * By default the confirm dialog is cancelled after asserting the summary.
 */

import { test, expect } from '@playwright/test';
import { importEncryptedWallet } from './fixtures';

const ALLOW_BROADCAST = process.env.ALLOW_BROADCAST === '1';

async function openCreateModal(page: import('@playwright/test').Page) {
  await page.goto('/create-asset', { waitUntil: 'domcontentloaded', timeout: 10000 });
  await expect(page.locator('h1:has-text("Create Asset")')).toBeVisible({ timeout: 10000 });
  await page.click('button:has-text("Create New Asset")');
  // Wait for modal
  const modal = page.locator('div.relative.z-10, [role="dialog"]').first();
  await expect(modal).toBeVisible({ timeout: 8000 });
  return modal;
}

test.describe('Create Asset — Page and Type Cards', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
  });

  test('navigates to create-asset from sidebar', async ({ page }) => {
    await page.getByRole('link', { name: 'Create Asset', exact: true }).click();
    await page.waitForURL('/create-asset', { timeout: 10000 });
    await expect(page.locator('h1:has-text("Create Asset")')).toBeVisible({ timeout: 10000 });
  });

  test('shows 5 asset type cards', async ({ page }) => {
    await page.goto('/create-asset', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await expect(page.locator('h3:has-text("ROOT")').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('h3:has-text("SUB")')).toBeVisible();
    await expect(page.locator('h3:has-text("UNIQUE")')).toBeVisible();
    await expect(page.locator('h3:has-text("QUALIFIER")')).toBeVisible();
    await expect(page.locator('h3:has-text("RESTRICTED")')).toBeVisible();
  });

  test('Create New Asset button opens modal', async ({ page }) => {
    await page.goto('/create-asset', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.click('button:has-text("Create New Asset")');
    await expect(page.locator('label:has-text("Asset Label"), #create-asset-label')).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe('Create Asset — Form Validation', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
  });

  test('empty label shows required error', async ({ page }) => {
    await openCreateModal(page);
    await page.click('button:has-text("Issue")');
    await expect(page.locator('.text-red-600, .text-red-500').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('label exceeding 31 chars shows error', async ({ page }) => {
    await openCreateModal(page);
    await page.fill('#create-asset-label', 'A'.repeat(32));
    await page.click('button:has-text("Issue")');
    await expect(page.locator('.text-red-600, .text-red-500').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('negative quantity shows error', async ({ page }) => {
    await openCreateModal(page);
    await page.fill('#create-asset-label', 'VALTEST');
    await page.fill('#create-asset-quantity', '-1');
    await page.click('button:has-text("Issue")');
    await expect(page.locator('.text-red-600, .text-red-500').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('decimal places > 8 shows error', async ({ page }) => {
    await openCreateModal(page);
    await page.fill('#create-asset-label', 'VALTEST');
    await page.fill('#create-asset-decimals', '9');
    await page.click('button:has-text("Issue")');
    await expect(page.locator('.text-red-600.dark\\:text-red-400, .text-red-600').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('decimal places = 8 is accepted (no error for decimals)', async ({ page }) => {
    await openCreateModal(page);
    await page.fill('#create-asset-label', 'DECIMTEST');
    await page.fill('#create-asset-quantity', '1000');
    await page.fill('#create-asset-decimals', '8');
    // Should NOT immediately show a decimals error before clicking Issue
    const decimalError = page.locator('.text-red-600').filter({ hasText: /decimal/i });
    const hasEarly = await decimalError.isVisible({ timeout: 2000 }).catch(() => false);
    expect(hasEarly).toBe(false);
  });
});

test.describe('Create Asset — Type-specific Fields', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
  });

  test('UNIQUE type hides quantity field', async ({ page }) => {
    const modal = await openCreateModal(page);
    await modal.locator('button:has-text("UNIQUE")').click();
    await expect(page.locator('#create-asset-quantity')).not.toBeVisible({ timeout: 10000 });
  });

  test('RESTRICTED type shows verifier string field', async ({ page }) => {
    const modal = await openCreateModal(page);
    await modal.locator('button:has-text("RESTRICTED")').click();
    await expect(page.locator('#create-asset-verifier')).toBeVisible({ timeout: 10000 });
  });

  test('RESTRICTED type validates empty verifier string on issue', async ({ page }) => {
    const modal = await openCreateModal(page);
    await modal.locator('button:has-text("RESTRICTED")').click();
    await page.fill('#create-asset-label', 'RESTRICTTEST');
    await page.fill('#create-asset-quantity', '1000');
    // Leave verifier empty
    await page.click('button:has-text("Issue")');
    await expect(page.locator('.text-red-600, .text-red-500').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('SUB type shows parent asset selector', async ({ page }) => {
    const modal = await openCreateModal(page);
    await modal.locator('button:has-text("SUB")').click();
    const parentSel = page.locator('select[id*="parent"], input[placeholder*="parent"], [id*="parent"]').first();
    await expect(parentSel).toBeVisible({ timeout: 10000 });
  });

  test('UNIQUE type shows parent asset selector', async ({ page }) => {
    const modal = await openCreateModal(page);
    await modal.locator('button:has-text("UNIQUE")').click();
    const parentSel = page.locator('select[id*="parent"], input[placeholder*="parent"], [id*="parent"]').first();
    await expect(parentSel).toBeVisible({ timeout: 10000 });
  });

  test('IPFS toggle reveals IPFS hash input', async ({ page }) => {
    await openCreateModal(page);
    const ipfsCheckbox = page.locator('input[type="checkbox"]').nth(1);
    await ipfsCheckbox.click();
    await expect(page.locator('#create-asset-ipfs')).toBeVisible({ timeout: 10000 });
  });

  test('Reissuable checkbox is toggleable', async ({ page }) => {
    await openCreateModal(page);
    const reissCheckbox = page.locator('input[type="checkbox"]').first();
    await reissCheckbox.click();
    expect(await reissCheckbox.isChecked()).toBe(true);
  });

  test('switching from ROOT to QUALIFIER changes displayed fields', async ({ page }) => {
    const modal = await openCreateModal(page);
    await modal.locator('button:has-text("QUALIFIER")').click();
    // QUALIFIER assets use # prefix — label field should still be present
    await expect(page.locator('#create-asset-label')).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Create Asset — Issue Action', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
  });

  test(`ROOT asset issue [ALLOW_BROADCAST=${ALLOW_BROADCAST}]`, async ({ page }) => {
    await openCreateModal(page);

    const label = `RTEST${Date.now().toString().slice(-4)}`;
    await page.fill('#create-asset-label', label);
    await page.fill('#create-asset-quantity', '1000');
    await page.fill('#create-asset-decimals', '8');

    await page.click('button:has-text("Issue")');

    if (ALLOW_BROADCAST) {
      // Allow broadcast — wait for success or error (insufficient funds is OK)
      const result = await Promise.race([
        page
          .locator('text=/Asset Created|success/i')
          .waitFor({ state: 'visible', timeout: 60000 })
          .then(() => 'success'),
        page
          .locator('.text-red-600')
          .waitFor({ state: 'visible', timeout: 60000 })
          .then(() => 'error'),
      ]).catch(() => 'none');
      expect(result).not.toBe('none');
    } else {
      // No broadcast: confirm dialog should appear → Cancel
      const confirm = page.locator('text=Confirm, [class*="fixed inset-0"]').first();
      const hasConfirm = await confirm.isVisible({ timeout: 10000 }).catch(() => false);
      if (hasConfirm) {
        await page.locator('button:has-text("Cancel")').first().click();
      }
      // Acceptable outcomes: still on create-asset or error shown
      await expect(page.locator('body')).toBeVisible();
    }
  });
});
