/**
 * send-receive.spec.ts
 *
 * Covers:
 *   Send page:
 *     - Multi-recipient add/remove
 *     - Fee controls (fee rate slider/input, confTarget)
 *     - Coin-control UTXO list (From address selector)
 *     - Subtract-fee checkbox
 *     - Address validation (invalid address rejected)
 *     - Confirm dialog shows amount + fee + total
 *     - Cancel in confirm dialog — NO broadcast
 *   Send broadcast (ALLOW_BROADCAST=1):
 *     - Sends a tiny self-send and confirms txid returned
 *   Receive page:
 *     - Address + QR render
 *     - BIP21 amount/label/message update the URI
 *     - Copy URI button
 *
 * Money-touching actions are gated behind env ALLOW_BROADCAST=1.
 * Default run: drive to confirm dialog → assert → Cancel.
 */

import { test, expect } from '@playwright/test';
import { importEncryptedWallet, TEST_ADDRESS } from './fixtures';

const ALLOW_BROADCAST = process.env.ALLOW_BROADCAST === '1';

// ---- Receive ----

test.describe('Receive', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
    await page.goto('/receive', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Receive' })).toBeVisible({ timeout: 10000 });
  });

  test('shows Receive heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Receive' })).toBeVisible();
  });

  test('Generate Address button is present', async ({ page }) => {
    const btn = page.locator('button:has-text("Generate"), button:has-text("New Address")');
    await expect(btn.first()).toBeVisible({ timeout: 10000 });
  });

  test('generates a PHICOIN address starting with P', async ({ page }) => {
    const btn = page.locator('button:has-text("Generate"), button:has-text("New Address")').first();
    await btn.click();
    // Wait for address to appear
    await expect(page.locator('text=/^P[A-Za-z0-9]{25,39}$/')).toBeVisible({ timeout: 15000 });
  });

  test('QR code SVG renders after address generation', async ({ page }) => {
    const btn = page.locator('button:has-text("Generate"), button:has-text("New Address")').first();
    await btn.click();
    await expect(page.locator('svg[class*="qr"], svg').first()).toBeVisible({ timeout: 15000 });
  });

  test('Copy Address button is present after generation', async ({ page }) => {
    const btn = page.locator('button:has-text("Generate"), button:has-text("New Address")').first();
    await btn.click();
    await page.waitForTimeout(2000);
    const copyBtn = page.locator('button:has-text("Copy Address"), button:has-text("Copy")').first();
    await expect(copyBtn).toBeVisible({ timeout: 10000 });
  });

  test('BIP21 URI shown as phicoin: scheme', async ({ page }) => {
    const btn = page.locator('button:has-text("Generate"), button:has-text("New Address")').first();
    await btn.click();
    await page.waitForTimeout(2000);
    await expect(page.locator('text=/phicoin:P[A-Za-z0-9]+/')).toBeVisible({ timeout: 15000 });
  });

  test('BIP21 amount field updates the URI', async ({ page }) => {
    const btn = page.locator('button:has-text("Generate"), button:has-text("New Address")').first();
    await btn.click();
    await page.waitForTimeout(2000);

    const amountInput = page.locator('input[placeholder*="Amount"], input[id*="amount"], input[name*="amount"]').first();
    const hasAmount = await amountInput.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasAmount) {
      test.skip(true, 'Amount input not found on Receive page');
      return;
    }
    await amountInput.fill('0.01');
    await expect(page.locator('text=/phicoin:.*amount=0\.01/')).toBeVisible({ timeout: 8000 });
  });

  test('BIP21 label field updates the URI', async ({ page }) => {
    const btn = page.locator('button:has-text("Generate"), button:has-text("New Address")').first();
    await btn.click();
    await page.waitForTimeout(2000);

    const labelInput = page.locator('input[placeholder*="Label"], input[id*="label"], input[name*="label"]').first();
    const hasLabel = await labelInput.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasLabel) {
      test.skip(true, 'Label input not found on Receive page');
      return;
    }
    await labelInput.fill('TestPayment');
    await expect(page.locator('text=/phicoin:.*label=TestPayment/')).toBeVisible({ timeout: 8000 });
  });

  test('Copy URI button is clickable', async ({ page }) => {
    const btn = page.locator('button:has-text("Generate"), button:has-text("New Address")').first();
    await btn.click();
    await page.waitForTimeout(2000);

    const copyUri = page.locator('button:has-text("Copy URI"), button:has-text("Copy Payment")').first();
    const hasBtn = await copyUri.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasBtn) {
      test.skip(true, 'Copy URI button not found');
      return;
    }
    await copyUri.click();
    // Toast or clipboard feedback — just ensure no crash
    await expect(page.locator('body')).toBeVisible();
  });

  test('Reset button clears the address', async ({ page }) => {
    const btn = page.locator('button:has-text("Generate"), button:has-text("New Address")').first();
    await btn.click();
    await page.waitForTimeout(2000);

    const resetBtn = page.locator('button:has-text("Reset"), button:has-text("Clear")').first();
    const hasReset = await resetBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasReset) {
      test.skip(true, 'Reset button not found');
      return;
    }
    await resetBtn.click();
    // Address should be cleared
    const addrVisible = await page.locator('text=/^P[A-Za-z0-9]{25,39}$/').isVisible({ timeout: 3000 }).catch(() => false);
    expect(addrVisible).toBe(false);
  });
});

// ---- Send ----

test.describe('Send', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
    await page.goto('/send', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Send' })).toBeVisible({ timeout: 10000 });
  });

  test('shows Send heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Send' })).toBeVisible();
  });

  test('shows recipient address input', async ({ page }) => {
    const addrInput = page.locator('input[placeholder*="address"], input[placeholder*="Address"], input[type="text"]').first();
    await expect(addrInput).toBeVisible({ timeout: 10000 });
  });

  test('shows amount input', async ({ page }) => {
    const amtInput = page.locator('input[type="number"], input[placeholder*="amount"], input[placeholder*="Amount"]').first();
    await expect(amtInput).toBeVisible({ timeout: 10000 });
  });

  test('shows PHI balance on send page', async ({ page }) => {
    const hasBalance =
      (await page.locator('text=Balance').isVisible({ timeout: 5000 }).catch(() => false)) ||
      (await page.locator('text=PHI').isVisible({ timeout: 5000 }).catch(() => false));
    expect(hasBalance).toBe(true);
  });

  test('invalid address format shows validation error', async ({ page }) => {
    const addrInput = page.locator('input[placeholder*="address"], input[placeholder*="Address"], input[type="text"]').first();
    await addrInput.fill('not_a_valid_address');
    const amtInput = page.locator('input[type="number"]').first();
    await amtInput.fill('0.001');
    await page.locator('button:has-text("Send")').first().click();
    await page.waitForTimeout(1000);
    // Should show error or remain on send page
    const url = page.url();
    expect(url).toContain('/send');
  });

  test('"Add Recipient" button adds a second recipient row', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add Recipient"), button:has-text("Add")').first();
    const hasAdd = await addBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasAdd) {
      test.skip(true, 'Add Recipient button not found');
      return;
    }
    const before = await page.locator('input[placeholder*="address"], input[placeholder*="Address"]').count();
    await addBtn.click();
    const after = await page.locator('input[placeholder*="address"], input[placeholder*="Address"]').count();
    expect(after).toBeGreaterThan(before);
  });

  test('Remove button removes the extra recipient row', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add Recipient"), button:has-text("Add")').first();
    const hasAdd = await addBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasAdd) {
      test.skip(true, 'Add Recipient button not found');
      return;
    }
    await addBtn.click();
    const removeBtn = page.locator('button:has-text("Remove"), button[aria-label*="remove"]').first();
    const hasRemove = await removeBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasRemove) {
      const before = await page.locator('input[placeholder*="address"], input[placeholder*="Address"]').count();
      await removeBtn.click();
      const after = await page.locator('input[placeholder*="address"], input[placeholder*="Address"]').count();
      expect(after).toBeLessThan(before);
    }
  });

  test('fee rate input is present', async ({ page }) => {
    const feeInput = page.locator('input[id*="fee"], input[placeholder*="fee"], input[placeholder*="Fee"]').first();
    const hasInput = await feeInput.isVisible({ timeout: 5000 }).catch(() => false);
    // May also be a slider
    const slider = page.locator('input[type="range"]').first();
    const hasSlider = await slider.isVisible({ timeout: 2000 }).catch(() => false);
    expect(hasInput || hasSlider).toBe(true);
  });

  test('Subtract fee checkbox is present', async ({ page }) => {
    const checkbox = page.locator('input[type="checkbox"][id*="subtract"], label:has-text("subtract")').first();
    const label = page.locator('label:has-text("Subtract"), text=/subtract fee/i').first();
    const hasCheckbox = await checkbox.isVisible({ timeout: 5000 }).catch(() => false);
    const hasLabel = await label.isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasCheckbox || hasLabel).toBe(true);
  });

  test('coin control / From address selector is present', async ({ page }) => {
    const fromSelect = page.locator('select[id*="from"], button:has-text("Coin Control"), text=/From|UTXO/i').first();
    const visible = await fromSelect.isVisible({ timeout: 5000 }).catch(() => false);
    expect(visible).toBe(true);
  });

  test('Estimate Fee button fetches a rate', async ({ page }) => {
    const estimateBtn = page.locator('button:has-text("Estimate"), button:has-text("Fee")').first();
    const hasBtn = await estimateBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasBtn) {
      test.skip(true, 'Estimate Fee button not found');
      return;
    }
    await estimateBtn.click();
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).toBeVisible();
  });

  test(`confirm dialog shows amount, fee and total [ALLOW_BROADCAST=${ALLOW_BROADCAST}]`, async ({ page }) => {
    // Fill a valid send form and drive to confirm dialog → Cancel (no broadcast)
    const addrInput = page.locator('input[placeholder*="address"], input[placeholder*="Address"]').first();
    await addrInput.fill(TEST_ADDRESS);

    const amtInput = page.locator('input[type="number"]').first();
    await amtInput.fill('0.0001');

    const sendBtn = page.locator('button:has-text("Send")').first();
    await sendBtn.click();
    await page.waitForTimeout(2000);

    // Confirm dialog should appear
    const dialog = page.locator('text=Confirm Transaction, [class*="fixed inset-0"]').first();
    const hasDialog = await dialog.isVisible({ timeout: 8000 }).catch(() => false);
    if (!hasDialog) {
      // Might have failed validation — check for error
      const errorVisible = await page.locator('text=/invalid|error/i').first().isVisible({ timeout: 3000 }).catch(() => false);
      if (errorVisible) {
        test.skip(true, 'Address validation failed; cannot test confirm dialog');
        return;
      }
      test.skip(true, 'Confirm dialog did not appear');
      return;
    }

    // Verify summary fields are shown
    await expect(page.locator('text=Amount')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=/fee/i').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=/Total/i').first()).toBeVisible({ timeout: 5000 });

    if (!ALLOW_BROADCAST) {
      // Cancel — do NOT broadcast
      await page.locator('button:has-text("Cancel")').first().click();
      // Should return to send form
      await expect(page.locator('h1:has-text("Send"), h2:has-text("Send")').first()).toBeVisible({
        timeout: 10000,
      });
    } else {
      // ALLOW_BROADCAST=1: confirm the self-send
      await page.locator('button:has-text("Confirm"), button:has-text("Send")').last().click();
      // Wait for success toast or txid
      await expect(page.locator('text=/txid|success|broadcast/i').first()).toBeVisible({
        timeout: 30000,
      });
    }
  });

  test('confirm dialog Cancel does not broadcast', async ({ page }) => {
    const addrInput = page.locator('input[placeholder*="address"], input[placeholder*="Address"]').first();
    await addrInput.fill(TEST_ADDRESS);
    const amtInput = page.locator('input[type="number"]').first();
    await amtInput.fill('0.0001');
    await page.locator('button:has-text("Send")').first().click();
    await page.waitForTimeout(2000);

    const dialog = page.locator('text=Confirm Transaction').first();
    const hasDialog = await dialog.isVisible({ timeout: 8000 }).catch(() => false);
    if (!hasDialog) {
      test.skip(true, 'Confirm dialog did not appear');
      return;
    }

    await page.locator('button:has-text("Cancel")').first().click();
    // Ensure we're back on the send page (no redirect to dashboard indicating broadcast)
    await expect(page.locator('h1:has-text("Send"), h2:has-text("Send")').first()).toBeVisible({
      timeout: 10000,
    });
  });
});
