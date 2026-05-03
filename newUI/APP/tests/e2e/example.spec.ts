/**
 * E2E test placeholder using Playwright.
 */
import { test, expect } from '@playwright/test';

test('placeholder', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await expect(page).toHaveTitle(/PHICOIN/i);
});
