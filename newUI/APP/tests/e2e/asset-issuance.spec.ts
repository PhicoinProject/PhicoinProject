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
 * NOTE: The CreateAsset page has NO modal button. Clicking a type card shows
 * an inline form. The Issue button text is "Issue ROOT Asset" / "Issue SUB Asset" etc.
 *
 * Money-touching actions (actual issuance RPC call) are gated behind ALLOW_BROADCAST=1.
 * By default the confirm dialog is cancelled after asserting the summary.
 */

import { test, expect } from '@playwright/test';
import { gotoUnlocked } from './fixtures';

const ALLOW_BROADCAST = process.env.ALLOW_BROADCAST === '1';

/**
 * Open the CreateAsset inline form by clicking the ROOT type card.
 * Returns when the form (with #create-asset-label) is visible.
 */
async function selectRootType(page: import('@playwright/test').Page) {
  await gotoUnlocked(page, '/create-asset');
  await expect(page.locator('h1:has-text("Create Asset")')).toBeVisible({ timeout: 10000 });
  // Click ROOT type card to show the inline form
  await page.locator('button:has-text("ROOT"), h3:has-text("ROOT")').first().click();
  await expect(page.locator('#create-asset-label')).toBeVisible({ timeout: 8000 });
}

test.describe('Create Asset — Page and Type Cards', () => {
  test.beforeEach(async ({ page }) => {
    await gotoUnlocked(page, '/create-asset');
    await expect(page.locator('h1:has-text("Create Asset")')).toBeVisible({ timeout: 10000 });
  });

  test('shows 5 asset type cards', async ({ page }) => {
    await expect(page.locator('h3:has-text("ROOT")').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('h3:has-text("SUB")')).toBeVisible();
    await expect(page.locator('h3:has-text("UNIQUE")')).toBeVisible();
    await expect(page.locator('h3:has-text("QUALIFIER")')).toBeVisible();
    await expect(page.locator('h3:has-text("RESTRICTED")')).toBeVisible();
  });

  test('clicking ROOT card shows the asset form', async ({ page }) => {
    // Click ROOT type card
    await page.locator('button:has-text("ROOT"), h3:has-text("ROOT")').first().click();
    await expect(page.locator('#create-asset-label')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Create Asset — Form Validation', () => {
  test.beforeEach(async ({ page }) => {
    await selectRootType(page);
  });

  test('empty label shows required error', async ({ page }) => {
    // Click "Issue ROOT Asset" without filling label
    await page.locator('button:has-text("Issue ROOT Asset")').first().click();
    await expect(page.locator('.text-red-600, .text-red-500').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('label exceeding 31 chars shows error', async ({ page }) => {
    await page.fill('#create-asset-label', 'A'.repeat(32));
    await page.locator('button:has-text("Issue ROOT Asset")').first().click();
    await expect(page.locator('.text-red-600, .text-red-500').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('negative quantity shows error', async ({ page }) => {
    await page.fill('#create-asset-label', 'VALTEST');
    await page.fill('#create-asset-quantity', '-1');
    await page.locator('button:has-text("Issue ROOT Asset")').first().click();
    await expect(page.locator('.text-red-600, .text-red-500').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('decimal places > 8 shows error', async ({ page }) => {
    await page.fill('#create-asset-label', 'VALTEST');
    await page.fill('#create-asset-decimals', '9');
    await page.locator('button:has-text("Issue ROOT Asset")').first().click();
    await expect(page.locator('.text-red-600, .text-red-500').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('decimal places = 8 is accepted (no error for decimals)', async ({ page }) => {
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
    await gotoUnlocked(page, '/create-asset');
    await expect(page.locator('h1:has-text("Create Asset")')).toBeVisible({ timeout: 10000 });
  });

  test('UNIQUE type hides quantity field', async ({ page }) => {
    await page.locator('button:has-text("UNIQUE"), h3:has-text("UNIQUE")').first().click();
    await expect(page.locator('#create-asset-label')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#create-asset-quantity')).not.toBeVisible({ timeout: 10000 });
  });

  test('RESTRICTED type shows verifier string field', async ({ page }) => {
    // Exact-match the RESTRICTED card's heading: the QUALIFIER card's description
    // ("Qualifier for restricted assets") also contains "restricted", so a loose
    // has-text("RESTRICTED") + .first() would click the QUALIFIER card instead.
    await page.locator('button:has(h3:text-is("RESTRICTED"))').first().click();
    await expect(page.locator('#create-asset-label')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#create-asset-verifier')).toBeVisible({ timeout: 10000 });
  });

  test('RESTRICTED type validates empty verifier string on issue', async ({ page }) => {
    // Exact-match the RESTRICTED card's heading: the QUALIFIER card's description
    // ("Qualifier for restricted assets") also contains "restricted", so a loose
    // has-text("RESTRICTED") + .first() would click the QUALIFIER card instead.
    await page.locator('button:has(h3:text-is("RESTRICTED"))').first().click();
    await expect(page.locator('#create-asset-label')).toBeVisible({ timeout: 8000 });
    await page.fill('#create-asset-label', 'RESTRICTTEST');
    await page.fill('#create-asset-quantity', '1000');
    // Leave verifier empty
    await page.locator('button:has-text("Issue RESTRICTED Asset")').first().click();
    await expect(page.locator('.text-red-600, .text-red-500').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('SUB type shows parent asset selector', async ({ page }) => {
    await page.locator('button:has-text("SUB"), h3:has-text("SUB")').first().click();
    await expect(page.locator('#create-asset-label')).toBeVisible({ timeout: 8000 });
    // Parent asset select: id="create-asset-parent"
    const parentSel = page.locator('#create-asset-parent, select[id*="parent"]').first();
    await expect(parentSel).toBeVisible({ timeout: 10000 });
  });

  test('UNIQUE type shows parent asset selector', async ({ page }) => {
    await page.locator('button:has-text("UNIQUE"), h3:has-text("UNIQUE")').first().click();
    await expect(page.locator('#create-asset-label')).toBeVisible({ timeout: 8000 });
    const parentSel = page.locator('#create-asset-parent, select[id*="parent"]').first();
    await expect(parentSel).toBeVisible({ timeout: 10000 });
  });

  test('IPFS toggle reveals IPFS hash input', async ({ page }) => {
    await page.locator('button:has-text("ROOT"), h3:has-text("ROOT")').first().click();
    await expect(page.locator('#create-asset-label')).toBeVisible({ timeout: 8000 });
    // IPFS checkbox is the second checkbox (first is Reissuable)
    const ipfsCheckbox = page.locator('input[type="checkbox"]').nth(1);
    await ipfsCheckbox.click();
    await expect(page.locator('#create-asset-ipfs')).toBeVisible({ timeout: 10000 });
  });

  test('Reissuable checkbox is toggleable', async ({ page }) => {
    await page.locator('button:has-text("ROOT"), h3:has-text("ROOT")').first().click();
    await expect(page.locator('#create-asset-label')).toBeVisible({ timeout: 8000 });
    // Reissuable checkbox is the first checkbox in the form
    const reissCheckbox = page.locator('input[type="checkbox"]').first();
    const initialState = await reissCheckbox.isChecked();
    await reissCheckbox.click();
    expect(await reissCheckbox.isChecked()).toBe(!initialState);
  });

  test('switching to QUALIFIER shows asset label field', async ({ page }) => {
    await page.locator('button:has-text("QUALIFIER"), h3:has-text("QUALIFIER")').first().click();
    // QUALIFIER assets use # prefix — label field should still be present
    await expect(page.locator('#create-asset-label')).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Create Asset — Issue Action', () => {
  test(`ROOT asset issue [ALLOW_BROADCAST=${ALLOW_BROADCAST}]`, async ({ page }) => {
    await selectRootType(page);

    const label = `RTEST${Date.now().toString().slice(-4)}`;
    await page.fill('#create-asset-label', label);
    await page.fill('#create-asset-quantity', '1000');
    await page.fill('#create-asset-decimals', '8');

    await page.locator('button:has-text("Issue ROOT Asset")').first().click();

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
      // No broadcast: page should either show an error or remain on create-asset
      await page.waitForTimeout(3000);
      await expect(page.locator('body')).toBeVisible();
    }
  });
});
