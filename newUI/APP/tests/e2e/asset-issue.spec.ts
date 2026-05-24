/**
 * asset-issue.spec.ts — REAL asset issuance, gated behind ALLOW_BROADCAST=1.
 *
 * Issues a uniquely-named ROOT asset via the app's real assetService.issueAsset()
 * (exercises the burn output, owner-token creation, rvnq issuance script, local signing
 * and broadcast). Costs the 0.1 PHI issuance burn.
 *
 * Run: ALLOW_BROADCAST=1 npx playwright test tests/e2e/asset-issue.spec.ts
 */
import { test } from '@playwright/test';
import { gotoUnlocked } from './fixtures';

declare const process: { env: Record<string, string | undefined> };
const ALLOW = process.env.ALLOW_BROADCAST === '1';

test.describe.serial('Real asset issuance (gated)', () => {
  test('issue a ROOT asset and capture txid', async ({ page }) => {
    test.skip(!ALLOW, 'Set ALLOW_BROADCAST=1 to run the real issuance');
    test.setTimeout(180000);

    await gotoUnlocked(page, '/');

    const result = await page.evaluate(async () => {
      const mod = await import('/src/services/assets.ts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = (mod as any).assetService;
      const name = 'PHIQA' + Date.now().toString().slice(-7); // unique uppercase+digits
      try {
        const txid = await svc.issueAsset({ label: name, quantity: 100, decimalPlaces: 0 });
        return { ok: true, txid, name };
      } catch (e) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { ok: false, error: String((e as any)?.message ?? e) };
      }
    });

    console.log('ASSET_ISSUE=' + JSON.stringify(result));
  });

  test('issue a SUB asset (uses parent owner token)', async ({ page }) => {
    test.skip(!ALLOW, 'Set ALLOW_BROADCAST=1 to run the real issuance');
    test.setTimeout(180000);
    await gotoUnlocked(page, '/');
    const result = await page.evaluate(async () => {
      const mod = await import('/src/services/assets.ts');
      const ser = await import('/src/services/assetSerialization.ts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = (mod as any).assetService;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SUB = (ser as any).AssetType.SUB;
      const name = 'HHBNB/QA' + Date.now().toString().slice(-6);
      try {
        const txid = await svc.issueAsset({ label: name, quantity: 1, decimalPlaces: 0, assetType: SUB });
        return { ok: true, txid, name };
      } catch (e) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { ok: false, error: String((e as any)?.message ?? e) };
      }
    });
    console.log('SUB_ISSUE=' + JSON.stringify(result));
  });
});
