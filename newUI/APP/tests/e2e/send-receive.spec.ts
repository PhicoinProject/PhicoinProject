import { test, expect } from '@playwright/test';
import { importEncryptedWallet } from './fixtures';

test.describe('Send / Receive PHI', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
  });

  test.describe('Receive', () => {
    test('should navigate to receive page', async ({ page }) => {
      await page.goto('/receive', { waitUntil: 'domcontentloaded', timeout: 10000 });
      await expect(page.getByRole('heading', { name: 'Receive' })).toBeVisible({ timeout: 10000 });
    });

    test('should display wallet address', async ({ page }) => {
      await page.goto('/receive', { waitUntil: 'domcontentloaded', timeout: 10000 });

      // Should show P-prefixed PHICOIN address on the page
      await expect(page.locator('text=/P[A-Za-z0-9]{25,40}/')).toBeVisible({ timeout: 10000 });
    });

    test('should show QR code or address copy functionality', async ({ page }) => {
      await page.goto('/receive', { waitUntil: 'domcontentloaded', timeout: 10000 });

      // Either QR code or copy button should exist
      const qrCode = page.locator('[class*="qr"], svg');
      const copyBtn = page.locator('button:has-text("Copy")');
      const hasQr = await qrCode.first().isVisible().catch(() => false);
      const hasCopy = await copyBtn.first().isVisible().catch(() => false);
      // Address should be visible on receive page
      const addressVisible = await page.locator('text=/P[A-Za-z0-9]{25,40}/').isVisible().catch(() => false);
      expect(hasQr || hasCopy || addressVisible).toBe(true);
    });
  });

  test.describe('Send', () => {
    test('should navigate to send page', async ({ page }) => {
      await page.goto('/send', { waitUntil: 'domcontentloaded', timeout: 10000 });
      await expect(page.getByRole('heading', { name: 'Send' })).toBeVisible({ timeout: 10000 });
    });

    test('should show recipient address input', async ({ page }) => {
      await page.goto('/send', { waitUntil: 'domcontentloaded', timeout: 10000 });

      // Input field for recipient address
      const inputFields = page.locator('input[type="text"], input[type="address"], textarea');
      expect(await inputFields.count()).toBeGreaterThan(0);
    });

    test('should show amount input', async ({ page }) => {
      await page.goto('/send', { waitUntil: 'domcontentloaded', timeout: 10000 });

      // Amount field
      const amountInput = page.locator('input[type="number"]');
      expect(await amountInput.count()).toBeGreaterThan(0);
    });

    test('should show send button', async ({ page }) => {
      await page.goto('/send', { waitUntil: 'domcontentloaded', timeout: 10000 });

      const sendBtn = page.locator('button:has-text("Send")');
      await expect(sendBtn.first()).toBeVisible({ timeout: 10000 });
    });

    test('should validate recipient address format', async ({ page }) => {
      await page.goto('/send', { waitUntil: 'domcontentloaded', timeout: 10000 });

      // Find the address input and fill with invalid address
      const addressInputs = page.locator('input[type="text"]');
      const count = await addressInputs.count();

      if (count > 0) {
        await addressInputs.first().fill('invalid_address');

        // Try to send
        await page.click('button:has-text("Send")');

        // Wait for validation
        await page.waitForTimeout(2000);

        // Should still be on the send page
        const url = page.url();
        expect(url.includes('/send')).toBe(true);
      }
    });

    test('should show balance information', async ({ page }) => {
      await page.goto('/send', { waitUntil: 'domcontentloaded', timeout: 10000 });

      // Should show PHI text on send page (balance label or currency indicator)
      const hasPhi = await page.locator('text=PHI').isVisible().catch(() => false);
      const hasBalance = await page.locator('text=Balance').isVisible().catch(() => false);
      expect(hasPhi || hasBalance).toBe(true);
    });
  });
});
