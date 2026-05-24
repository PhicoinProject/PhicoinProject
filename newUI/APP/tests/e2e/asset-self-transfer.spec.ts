/**
 * asset-self-transfer.spec.ts — REAL asset transfer, gated behind ALLOW_BROADCAST=1.
 *
 * Self-transfers 1 HHBNB to an own address by calling the app's real assetService
 * .transferAsset() in the page context (exercises the asset-script pushdata encoding,
 * asset-UTXO discovery on both chains, local signing and broadcast). Asset stays in the
 * wallet (own destination); only the network fee is spent.
 *
 * Run: ALLOW_BROADCAST=1 npx playwright test tests/e2e/asset-self-transfer.spec.ts
 */
import { test } from '@playwright/test';
import { gotoUnlocked } from './fixtures';

declare const process: { env: Record<string, string | undefined> };
const ALLOW = process.env.ALLOW_BROADCAST === '1';
const OWN = 'PrLCb6UXfvvas1phW6zPETcJtXHB7FyxVr'; // this wallet's own address

test.describe.serial('Real asset transfer (gated)', () => {
  test('self-transfer 1 HHBNB and capture txid', async ({ page }) => {
    test.skip(!ALLOW, 'Set ALLOW_BROADCAST=1 to run the real asset transfer');
    test.setTimeout(180000);

    await gotoUnlocked(page, '/'); // unlock → HD key in memory

    const result = await page.evaluate(async (own) => {
      const mod = await import('/src/services/assets.ts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = (mod as any).assetService;
      try {
        const txid = await svc.transferAsset('HHBNB', 1, own, '');
        return { ok: true, txid };
      } catch (e) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { ok: false, error: String((e as any)?.message ?? e) };
      }
    }, OWN);

    console.log('ASSET_TRANSFER=' + JSON.stringify(result));
  });
});
