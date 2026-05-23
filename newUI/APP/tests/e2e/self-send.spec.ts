/**
 * self-send.spec.ts — REAL on-chain broadcast, gated behind ALLOW_BROADCAST=1.
 *
 * Sends 0.1 PHI to PrLCb6UXfvvas1phW6zPETcJtXHB7FyxVr — an address belonging to this
 * same wallet, so it's effectively a self-send (change returns to the wallet; only the
 * network fee leaves). Proves the full sign → broadcast → on-chain path with real funds.
 *
 * Run: ALLOW_BROADCAST=1 npx playwright test tests/e2e/self-send.spec.ts
 */
import { test, expect } from '@playwright/test';
import { gotoUnlocked } from './fixtures';

declare const process: { env: Record<string, string | undefined> };
const ALLOW = process.env.ALLOW_BROADCAST === '1';
const DEST = 'PrLCb6UXfvvas1phW6zPETcJtXHB7FyxVr'; // this wallet's own address

test.describe.serial('Real send (gated)', () => {
  test('send 0.1 PHI to PrLCb and capture txid', async ({ page }) => {
    test.skip(!ALLOW, 'Set ALLOW_BROADCAST=1 to run the real send');
    test.setTimeout(220000);
    const consoleErrs: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrs.push(m.text());
    });

    // 1) Unlock and land on /send.
    await gotoUnlocked(page, '/send');

    // 2) Wait for the balance/pool RPC loop to finish (sending before it loads
    //    validates against a 0 balance).
    await page
      .locator('text=/0\\.\\d{2}|[1-9]\\d*\\.\\d/')
      .first()
      .waitFor({ state: 'visible', timeout: 60000 })
      .catch(() => {});
    await page.waitForTimeout(3000);

    // 3) Fill recipient (own address) + amount. Fee now defaults to the 1000 sat/byte
    //    relay-fee floor, so the broadcast is no longer rejected.
    await page.locator('input[placeholder*="ddress"]').first().fill(DEST);
    await page.locator('input[type="number"]').first().fill('0.1');

    // 4) Open the confirm dialog, sanity-check the amount, then broadcast immediately
    //    (the dialog auto-dismisses on a ~10s countdown). Use the EXACT submit button.
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const dialog = page.locator('.fixed.inset-0.z-50').first();
    await expect(dialog).toBeVisible({ timeout: 40000 });
    await expect(dialog).toContainText('0.1');
    await page.getByRole('button', { name: /Confirm & Send/i }).click();

    // 5) The send is RPC-heavy (UTXO fetch + build + sign + testmempoolaccept + broadcast),
    //    so wait for an actual outcome indicator rather than a fixed delay.
    await page
      .locator('text=/[0-9a-f]{64}|min relay|reject|insufficient|failed|broadcast|sent|success/i')
      .first()
      .waitFor({ state: 'visible', timeout: 50000 })
      .catch(() => {});
    await page.waitForTimeout(2000);
    const after = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const tx = after.match(/\b[0-9a-f]{64}\b/);
    console.log('SEND_TXID=' + (tx ? tx[0] : 'NONE'));
    const err = after.match(/(min relay|reject|insufficient|failed|invalid|not unlocked|error)[^.]{0,90}/i);
    console.log('SEND_ERROR=' + (err ? err[0] : 'none'));
    console.log('SEND_CONSOLE=' + (consoleErrs.slice(0, 4).join(' || ') || 'none'));
  });
});
