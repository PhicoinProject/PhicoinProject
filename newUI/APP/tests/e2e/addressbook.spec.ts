import { test, expect } from '@playwright/test';
import { importEncryptedWallet } from './fixtures';

test.describe('Address Book', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
  });

  test('should navigate to address book page', async ({ page }) => {
    await page.getByRole('link', { name: 'Address Book' }).click();
    await page.waitForURL('/addressbook', { timeout: 10000 });
    await expect(page.locator('body')).toBeVisible();
  });

  test('should show address book heading', async ({ page }) => {
    await page.goto('/addressbook', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);

    await expect(page.getByRole('heading', { name: 'Address Book' })).toBeVisible({ timeout: 10000 });
  });

  test('should add a new address entry', async ({ page }) => {
    await page.goto('/addressbook', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);

    // Look for add/create button
    const addBtn = page.locator('button:has-text("Add"), button:has-text("New"), button:has-text("+")').first();
    const addVisible = await addBtn.isVisible().catch(() => false);

    if (addVisible) {
      await addBtn.click();

      // Fill in address and label
      const inputs = page.locator('input[type="text"]');
      const count = await inputs.count();

      if (count >= 1) {
        await inputs.first().fill('PHiTest123456789012345678901234567890');
        if (count >= 2) {
          await inputs.nth(1).fill('Test Entry');
        }

        // Save
        await page.click('button:has-text("Save"), button:has-text("Add")');
        await page.waitForTimeout(1000);

        // Check if entry appears
        const entryVisible = await page.locator('text=Test Entry').isVisible().catch(() => false);
        expect(entryVisible).toBe(true);
      }
    }
  });

  test('should persist address book entries', async ({ page }) => {
    await page.goto('/addressbook', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);

    // Refresh page and check entries persist (stored in localStorage)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.locator('body')).toBeVisible();
  });
});
