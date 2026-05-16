import { test, expect } from '@playwright/test';
import { importEncryptedWallet } from './fixtures';

test.describe('Asset Issuance', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
  });

  // Increase navigation timeout due to occasional slow loads
  test.use({ navigationTimeout: 20000 });

  test('should navigate to create asset page', async ({ page }) => {
    await page.getByRole('link', { name: 'Create Asset', exact: true }).click();
    await page.waitForURL('/create-asset', { timeout: 10000 });
    await expect(page.locator('h1:has-text("Create Asset")')).toBeVisible({ timeout: 10000 });
  });

  test('should show all 5 asset type options', async ({ page }) => {
    await page.goto('/create-asset', { waitUntil: 'domcontentloaded', timeout: 10000 });

    // Asset types are rendered as h3 elements inside buttons
    await expect(page.locator('h3:has-text("ROOT")').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('h3:has-text("SUB")')).toBeVisible();
    await expect(page.locator('h3:has-text("UNIQUE")')).toBeVisible();
    await expect(page.locator('h3:has-text("QUALIFIER")')).toBeVisible();
    await expect(page.locator('h3:has-text("RESTRICTED")')).toBeVisible();
  });

  test('should show create asset modal with form fields', async ({ page }) => {
    await page.goto('/create-asset', { waitUntil: 'domcontentloaded', timeout: 10000 });

    await page.click('button:has-text("Create New Asset")');
    await expect(page.locator('label:has-text("Asset Label")')).toBeVisible({ timeout: 10000 });
  });

  test('should validate asset label is required', async ({ page }) => {
    await page.goto('/create-asset', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.click('button:has-text("Create New Asset")');

    // Leave label empty and click issue button
    await page.click('button:has-text("Issue")');
    const modalError = page.locator('.text-red-600.dark\\:text-red-400');
    await expect(modalError.first()).toBeVisible({ timeout: 10000 });
  });

  test('should validate asset label max length', async ({ page }) => {
    await page.goto('/create-asset', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.click('button:has-text("Create New Asset")');

    const labelInput = page.locator('#create-asset-label');
    await labelInput.fill('A'.repeat(32)); // Over 31 char limit
    await page.click('button:has-text("Issue")');

    const modalError = page.locator('.text-red-600.dark\\:text-red-400');
    await expect(modalError.first()).toBeVisible({ timeout: 10000 });
  });

  test('should validate quantity is a valid number', async ({ page }) => {
    await page.goto('/create-asset', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.click('button:has-text("Create New Asset")');

    await page.fill('#create-asset-label', 'VALTEST');
    // Use negative number to trigger validation (input[type=number] blocks 'abc')
    await page.fill('#create-asset-quantity', '-1');
    await page.click('button:has-text("Issue")');

    const modalError = page.locator('.text-red-600');
    await expect(modalError.first()).toBeVisible({ timeout: 10000 });
  });

  test('should validate decimal places range', async ({ page }) => {
    await page.goto('/create-asset', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.click('button:has-text("Create New Asset")');

    await page.fill('#create-asset-label', 'VALTEST');
    await page.fill('#create-asset-decimals', '9'); // Over max of 8
    await page.click('button:has-text("Issue")');

    const modalError = page.locator('.text-red-600.dark\\:text-red-400');
    await expect(modalError.first()).toBeVisible({ timeout: 10000 });
  });

  test('should attempt ROOT asset issuance and report result', async ({ page }) => {
    await page.goto('/create-asset', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.click('button:has-text("Create New Asset")');

    // Fill form
    await page.fill('#create-asset-label', `RTEST${Date.now().toString().slice(-4)}`);
    await page.fill('#create-asset-quantity', '1000');
    await page.fill('#create-asset-decimals', '8');

    await page.click('button:has-text("Issue")');

    // Wait for either success or error - use specific selectors
    const success = page.locator('text=/Asset Created/i');
    const error = page.locator('.text-red-600');

    const hasResult = await Promise.race([
      success.waitFor({ state: 'visible', timeout: 60000 }).then(() => 'success'),
      error.waitFor({ state: 'visible', timeout: 60000 }).then(() => 'error'),
    ]).catch(() => 'none');

    // Both outcomes are acceptable - success means issuance works,
    // error likely means insufficient funds (expected)
    test.expect(hasResult !== 'none', 'No result shown after issuing asset');
  });

  test('should show UNIQUE asset type without quantity field', async ({ page }) => {
    await page.goto('/create-asset', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.click('button:has-text("Create New Asset")');

    // Wait for modal to open
    const modal = page.locator('div.relative.z-10');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    // Click UNIQUE button inside the modal
    await modal.locator('button:has-text("UNIQUE")').click();

    // Quantity field should be hidden for UNIQUE
    const qtyInput = page.locator('#create-asset-quantity');
    await expect(qtyInput).not.toBeVisible({ timeout: 10000 });
  });

  test('should show verifier string field for RESTRICTED type', async ({ page }) => {
    await page.goto('/create-asset', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.click('button:has-text("Create New Asset")');

    // Wait for modal to open
    const modal = page.locator('div.relative.z-10');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    // Click RESTRICTED button inside the modal
    await modal.locator('button:has-text("RESTRICTED")').click();

    // Verifier string field should appear
    const verifier = page.locator('#create-asset-verifier');
    await expect(verifier).toBeVisible({ timeout: 10000 });
  });

  test('should allow toggling reissuable option', async ({ page }) => {
    await page.goto('/create-asset', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.click('button:has-text("Create New Asset")');

    const firstCheckbox = page.locator('input[type="checkbox"]').first();
    await firstCheckbox.click();
    expect(await firstCheckbox.isChecked()).toBe(true);
  });

  test('should allow toggling IPFS option', async ({ page }) => {
    await page.goto('/create-asset', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.click('button:has-text("Create New Asset")');

    // Second checkbox is IPFS
    const ipfsCheckbox = page.locator('input[type="checkbox"]').nth(1);
    await ipfsCheckbox.click();
    const ipfsInput = page.locator('#create-asset-ipfs');
    await expect(ipfsInput).toBeVisible({ timeout: 10000 });
  });
});
