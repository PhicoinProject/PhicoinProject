import { test, expect } from '@playwright/test';
import { importEncryptedWallet, WALLET_PATH } from './fixtures';
import { readFileSync } from 'fs';

test.describe('Wallet Lifecycle', () => {
  test.describe('Import Wallet', () => {
    test('should navigate to import page without auth', async ({ page }) => {
      await page.goto('/import', { waitUntil: 'domcontentloaded', timeout: 10000 });
      await expect(page.locator('h1:has-text("Import Wallet")')).toBeVisible({ timeout: 10000 });
    });

    test('should import encrypted wallet via JSON paste', async ({ page }) => {
      const walletContent = readFileSync(WALLET_PATH, 'utf-8');
      await page.goto('/import', { waitUntil: 'domcontentloaded', timeout: 10000 });

      await page.locator('textarea').first().fill(walletContent);

      // Password field appears for V2 wallets
      await page.waitForSelector('#importPassword', { timeout: 5000 });
      await page.fill('#importPassword', 'Qw11223344??');
      await page.click('button:has-text("Import Wallet")');

      // Should redirect to dashboard
      await page.waitForURL('/', { timeout: 15000 });
      // Dashboard heading is visible
      await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible({ timeout: 15000 });
    });

    test('should show error on wrong password', async ({ page }) => {
      const walletContent = readFileSync(WALLET_PATH, 'utf-8');
      await page.goto('/import', { waitUntil: 'domcontentloaded', timeout: 10000 });

      await page.locator('textarea').first().fill(walletContent);
      await page.waitForSelector('#importPassword', { timeout: 5000 });
      await page.fill('#importPassword', 'wrongpassword123');
      await page.click('button:has-text("Import Wallet")');

      await expect(page.locator('text=/incorrect|wrong password|try again/i')).toBeVisible({ timeout: 10000 });
    });

    test('should show error on invalid JSON', async ({ page }) => {
      await page.goto('/import', { waitUntil: 'domcontentloaded', timeout: 10000 });

      await page.locator('textarea').first().fill('not valid json {{{');
      await page.click('button:has-text("Import Wallet")');

      await expect(page.locator('text=/invalid json|invalid wallet/i')).toBeVisible({ timeout: 10000 });
    });

    test('should show recovery phrase tab', async ({ page }) => {
      await page.goto('/import', { waitUntil: 'domcontentloaded', timeout: 10000 });

      await page.click('button:has-text("Recovery Phrase")');
      await expect(page.locator('text=24-Word Recovery Phrase')).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Wallet Unlock', () => {
    test('should auto-unlock after import and navigate between pages', async ({ page }) => {
      await importEncryptedWallet(page);

      // Navigate to Send page
      await page.click('text=Send');
      await expect(page.locator('text=Send')).toBeVisible({ timeout: 10000 });

      // Navigate back to Dashboard
      await page.click('text=Dashboard');
      await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Wallet Backup', () => {
    test('should show backup page with wallet mnemonic', async ({ page }) => {
      await importEncryptedWallet(page);

      await page.click('text=Backup');
      await expect(page.locator('text=/backup|mnemonic|recovery/i')).toBeVisible({ timeout: 10000 });
    });
  });
});
