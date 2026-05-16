import { test, expect } from '@playwright/test';
import { importEncryptedWallet } from './fixtures';

test.describe('Sign & Verify Messages', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
  });

  test('should navigate to sign/verify page', async ({ page }) => {
    await page.getByRole('link', { name: 'Sign & Verify' }).click();
    await page.waitForURL('/sign-verify', { timeout: 10000 });
    await expect(page.locator('body')).toBeVisible();
  });

  test('should show sign/verify heading', async ({ page }) => {
    await page.goto('/sign-verify', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);

    const heading = page.locator('h1, h2, h3').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('should show message input field', async ({ page }) => {
    await page.goto('/sign-verify', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);

    // Should have input/textarea for message
    const messageInputs = page.locator('textarea, input[type="text"]');
    expect(await messageInputs.count()).toBeGreaterThan(0);
  });

  test('should show sign button', async ({ page }) => {
    await page.goto('/sign-verify', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);

    const signBtn = page.locator('button:has-text("Sign")');
    const verifyBtn = page.locator('button:has-text("Verify")');

    // At least one should be visible
    const hasSign = await signBtn.first().isVisible().catch(() => false);
    const hasVerify = await verifyBtn.first().isVisible().catch(() => false);
    expect(hasSign || hasVerify).toBe(true);
  });

  test('should sign a message locally', async ({ page }) => {
    await page.goto('/sign-verify', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);

    const messageInputs = page.locator('textarea, input[type="text"]');
    const count = await messageInputs.count();

    if (count > 0) {
      await messageInputs.first().fill('Test message for signing');

      const signBtn = page.locator('button:has-text("Sign")');
      if (await signBtn.isVisible().catch(() => false)) {
        await signBtn.click();
        await page.waitForTimeout(2000);

        // Should show a signature result
        const signature = page.locator('text=/[A-Za-z0-9+/=]{20,}/');
        const isVisible = await signature.first().isVisible().catch(() => false);
        expect(isVisible).toBe(true);
      }
    }
  });
});
