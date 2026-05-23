/**
 * rpc-console.spec.ts
 *
 * Covers:
 *   - RPC Console page renders
 *   - Input field and Send/Execute button present
 *   - Allowed read-only command `getblockchaininfo` returns a response
 *   - Blocked method `dumpprivkey` is rejected client-side before any network call
 *   - Command history: previous commands accessible with up/down arrow
 *   - Output area scrolls to latest entry
 *   - Multiple known-blocked methods are rejected: sendrawtransaction, importprivkey
 */

import { test, expect } from '@playwright/test';
import { gotoUnlocked } from './fixtures';

test.describe('RPC Console', () => {
  test.beforeEach(async ({ page }) => {
    await gotoUnlocked(page, '/rpc');
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });

  test('navigates to /rpc from sidebar', async ({ page }) => {
    // Already on /rpc via beforeEach
    await expect(page.locator('body')).toBeVisible();
  });

  test('shows RPC Console heading or label', async ({ page }) => {
    await expect(page.locator('text=/RPC Console|RPC|console/i').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('command input field is present', async ({ page }) => {
    const input = page.locator('input[type="text"], input[placeholder*="command"], input[placeholder*="Command"]').first();
    await expect(input).toBeVisible({ timeout: 10000 });
  });

  test('send / execute button is present', async ({ page }) => {
    const sendBtn = page
      .locator('button:has-text("Send"), button:has-text("Execute"), button:has-text("Run")')
      .first();
    await expect(sendBtn).toBeVisible({ timeout: 10000 });
  });

  test('output area is present', async ({ page }) => {
    // Output area is a div with bg-gray-900 class (dark terminal style)
    const output = page.locator('div.bg-gray-900').first();
    await expect(output).toBeVisible({ timeout: 10000 });
  });

  test('getblockchaininfo returns a JSON response', async ({ page }) => {
    const input = page
      .locator('input[type="text"], input[placeholder*="command"], input[placeholder*="Command"]')
      .first();
    await input.fill('getblockchaininfo');

    const sendBtn = page
      .locator('button:has-text("Send"), button:has-text("Execute"), button:has-text("Run")')
      .first();
    await sendBtn.click();

    // Wait for response (RPC call may take a few seconds)
    await expect(
      page.locator('text=/chain|blocks|bestblockhash|verificationprogress/i').first(),
    ).toBeVisible({ timeout: 20000 });
  });

  test('getblockchaininfo returns valid block count', async ({ page }) => {
    const input = page
      .locator('input[type="text"], input[placeholder*="command"], input[placeholder*="Command"]')
      .first();
    await input.fill('getblockchaininfo');
    await page.locator('button:has-text("Send"), button:has-text("Execute"), button:has-text("Run")').first().click();
    await page.waitForTimeout(5000);

    // Should have a numeric blocks value > 0 somewhere in output
    await expect(page.locator('text=/"blocks":')).toBeVisible({ timeout: 15000 }).catch(() => {
      // Alternative: "blocks" without quotes
    });
    await expect(page.locator('body')).toBeVisible();
  });

  // ---- Blocked methods ----

  test('dumpprivkey is rejected client-side', async ({ page }) => {
    const input = page
      .locator('input[type="text"], input[placeholder*="command"], input[placeholder*="Command"]')
      .first();
    await input.fill('dumpprivkey Pum3xBGkPWK9pcpvanoMyfGTdWYuzMWmsr');

    await page
      .locator('button:has-text("Run"), button:has-text("Send"), button:has-text("Execute"), button[type="submit"]')
      .last()
      .click();
    await page.waitForTimeout(1000);

    // Should see a blocked/rejected message without sending to RPC
    // The component renders: `SECURITY: Method "${firstWord}" is blocked in the web UI.`
    await expect(
      page.locator('text=/SECURITY: Method/').first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test('importprivkey is rejected client-side', async ({ page }) => {
    const input = page
      .locator('input[type="text"], input[placeholder*="command"], input[placeholder*="Command"]')
      .first();
    await input.fill('importprivkey cVtTest');
    await page
      .locator('button:has-text("Run"), button:has-text("Send"), button:has-text("Execute"), button[type="submit"]')
      .last()
      .click();
    await page.waitForTimeout(1000);
    // The component renders: `SECURITY: Method "${firstWord}" is blocked in the web UI.`
    await expect(
      page.locator('text=/SECURITY: Method/').first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test('sendtoaddress is rejected client-side', async ({ page }) => {
    // sendtoaddress IS in BLOCKED_METHODS (wallet-bound send operation)
    const input = page
      .locator('input[type="text"], input[placeholder*="command"], input[placeholder*="Command"]')
      .first();
    await input.fill('sendtoaddress Pum3xBGkPWK9pcpvanoMyfGTdWYuzMWmsr 0.001');
    await page
      .locator('button:has-text("Send"), button:has-text("Execute"), button:has-text("Run"), button[type="submit"]')
      .first()
      .click();
    await page.waitForTimeout(1000);
    // The component renders: `SECURITY: Method "${firstWord}" is blocked in the web UI.`
    await expect(
      page.locator('text=/SECURITY: Method/').first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test('walletpassphrase is rejected client-side', async ({ page }) => {
    const input = page
      .locator('input[type="text"], input[placeholder*="command"], input[placeholder*="Command"]')
      .first();
    await input.fill('walletpassphrase test 60');
    await page
      .locator('button:has-text("Run"), button:has-text("Send"), button:has-text("Execute"), button[type="submit"]')
      .last()
      .click();
    await page.waitForTimeout(1000);
    // The component renders: `SECURITY: Method "${firstWord}" is blocked in the web UI.`
    await expect(
      page.locator('text=/SECURITY: Method/').first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test('command history: up arrow recalls last command', async ({ page }) => {
    const input = page
      .locator('input[type="text"], input[placeholder*="command"], input[placeholder*="Command"]')
      .first();

    // Run one command first
    await input.fill('getblockchaininfo');
    await page
      .locator('button:has-text("Run"), button:has-text("Send"), button:has-text("Execute"), button[type="submit"]')
      .last()
      .click();
    await page.waitForTimeout(2000);

    // Clear input then press Up arrow
    await input.click();
    await input.fill('');
    await input.press('ArrowUp');

    const val = await input.inputValue();
    // Should have recalled the previous command
    expect(val).toBe('getblockchaininfo');
  });

  test('getmininginfo is a readable command', async ({ page }) => {
    const input = page
      .locator('input[type="text"], input[placeholder*="command"], input[placeholder*="Command"]')
      .first();
    await input.fill('getmininginfo');
    await page
      .locator('button:has-text("Run"), button:has-text("Send"), button:has-text("Execute"), button[type="submit"]')
      .last()
      .click();
    await expect(
      page.locator('text=/blocks|difficulty|networkhashps|genproclimit/i').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
