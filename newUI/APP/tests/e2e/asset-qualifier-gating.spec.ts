/**
 * asset-qualifier-gating.spec.ts — REAL on-chain proof that a RESTRICTED asset's
 * verifier string actually GATES transfers by qualifier tag, gated behind
 * ALLOW_BROADCAST=1.
 *
 * Scenario (one serial dependent chain inside a single page.evaluate, waiting for a
 * confirmation between dependent steps, PHICOIN block time ~15s):
 *
 *   1. issue a fresh qualifier   #QG<6digits>  (QUALIFIER, qty 1, decimals 0)
 *   2. pick an owner-token base whose $base RESTRICTED asset does NOT yet exist
 *   3. issue $base               (RESTRICTED, qty 100, decimals 0,
 *                                 verifierString = the #QG<...> just created)
 *   4. assignQualifier(#QG, pool[1])                       -> tag pool[1]
 *   5. transferAsset($base, 10, pool[1], '')   EXPECT CONFIRMED  (tagged can receive)
 *   6. transferAsset($base, 10, pool[3], '')   EXPECT REJECTED   (untagged cannot)
 *
 * The negative step (6) succeeds when the daemon REJECTS the broadcast: the throw is
 * caught and recorded; a flag `unexpectedlyAccepted` is set only if it does NOT throw.
 *
 * Run: ALLOW_BROADCAST=1 npx playwright test tests/e2e/asset-qualifier-gating.spec.ts
 */
import { test, expect } from '@playwright/test';
import { gotoUnlocked } from './fixtures';

declare const process: { env: Record<string, string | undefined> };
const ALLOW = process.env.ALLOW_BROADCAST === '1';

type Step = { step: string; txid?: string; confirmed?: boolean; error?: string; [k: string]: unknown };

test.describe.serial('Qualifier gating (real broadcast, gated)', () => {
  test('RESTRICTED verifier gates transfer by qualifier tag', async ({ page }) => {
    test.skip(!ALLOW, 'Set ALLOW_BROADCAST=1');
    test.setTimeout(900000);
    await gotoUnlocked(page, '/');
    const steps = (await page.evaluate(async () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const out: any[] = [];
      const a: any = await import('/src/services/assets.ts');
      const ser: any = await import('/src/services/assetSerialization.ts');
      const w: any = await import('/src/services/wallet.ts');
      const { rpc }: any = await import('/src/services/rpc.ts');
      const svc = a.assetService;
      const pool = (await w.walletService.getDerivedAddressPoolAsync()).map((x: any) => x.address);
      const waitConfirm = async (txid: string, ms = 180000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          try { const tx = await rpc.raw('getrawtransaction', [txid, true]); if (tx && Number(tx.confirmations ?? 0) >= 1) return true; } catch { /* retry */ }
          await new Promise((r) => setTimeout(r, 5000));
        }
        return false;
      };
      const run = async (label: string, fn: () => Promise<string>, expectReject = false) => {
        try {
          const txid = await fn();
          if (expectReject) { out.push({ step: label, txid, unexpectedlyAccepted: true }); return true; }
          const confirmed = await waitConfirm(txid);
          out.push({ step: label, txid, confirmed });
          return confirmed;
        } catch (e: any) {
          out.push({ step: label, error: String(e?.message ?? e), rejected: expectReject });
          return expectReject; // a reject is "success" for the negative step
        }
      };

      // 1. Fresh qualifier — used as the restricted asset's verifier.
      const qual = '#QG' + Date.now().toString().slice(-6);
      out.push({ step: 'pickQualifier', qual });
      if (!(await run('issueQualifier', () => svc.issueAsset({ label: qual, quantity: 1, decimalPlaces: 0, assetType: ser.AssetType.QUALIFIER })))) return out;

      // 2. Pick an owner-token base whose $RESTRICTED version does not yet exist.
      const candidates = ['HHBNB', 'HHGHGH', 'HHBNBB', 'HHFFGFG', 'HHGHGHG', 'HHGHGHG2', 'MTYTOPFK1', 'HHBNBHHBNB', 'PLAYWRIGHT', 'HHBNBNN'];
      let base: string | null = null;
      for (const c of candidates) {
        try { const d = await rpc.raw('getassetdata', ['$' + c]); if (!d) { base = c; break; } } catch { base = c; break; }
      }
      if (!base) { out.push({ step: 'pickBase', error: 'no available $NAME candidate' }); return out; }
      const R = '$' + base;
      out.push({ step: 'pickBase', restricted: R });

      // 3. Issue the restricted asset, verified by the qualifier just created.
      if (!(await run('issueRestricted', () => svc.issueAsset({ label: R, quantity: 100, decimalPlaces: 0, assetType: ser.AssetType.RESTRICTED, verifierString: qual })))) return out;

      // 4. Tag pool[1] with the qualifier so it is allowed to hold the restricted asset.
      if (!(await run('assignTag', () => svc.assignQualifier(qual, pool[1])))) return out;

      // 5. Positive: a tagged address CAN receive the restricted asset.
      if (!(await run('transferTagged', () => svc.transferAsset(R, 10, pool[1], '')))) return out;

      // 6. Negative: an UNtagged address (pool[3]) CANNOT receive — must be rejected.
      await run('transferUntagged', () => svc.transferAsset(R, 10, pool[3], ''), true);
      return out;
      /* eslint-enable @typescript-eslint/no-explicit-any */
    })) as Step[];
    console.log('QUALIFIER_GATING=' + JSON.stringify(steps));
    const get = (s: string) => steps.find((x) => x.step === s);
    expect(get('issueQualifier')?.confirmed, 'issue qualifier').toBe(true);
    expect(get('issueRestricted')?.confirmed, 'issue $restricted with verifier').toBe(true);
    expect(get('assignTag')?.confirmed, 'assign qualifier tag').toBe(true);
    // Positive proof: a tagged address can receive.
    expect(get('transferTagged')?.confirmed, 'transfer to tagged address').toBe(true);
    // Negative proof: an untagged address must be rejected.
    expect(get('transferUntagged')?.unexpectedlyAccepted, 'transfer to untagged should be rejected').not.toBe(true);
  });
});
