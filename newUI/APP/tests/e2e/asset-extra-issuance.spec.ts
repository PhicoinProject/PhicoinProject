/**
 * asset-extra-issuance.spec.ts — REAL on-chain verification of the remaining asset
 * issuance/operation types not covered by asset-matrix.spec.ts, gated behind
 * ALLOW_BROADCAST=1.
 *
 *   1. MSGCHANNEL    : issue a message channel  <OWNED_ROOT>~chan<6digits>
 *   2. SUB_QUALIFIER : issue a sub-qualifier    #RQ<6digits>/#SUB<6digits>
 *                      (first issues the root qualifier #RQ<...> it depends on)
 *   3. SET_VERIFIER  : issue a fresh $base2 (verifier 'true'), then re-set its
 *                      verifier string via assetService.setVerifierString(name, verifier)
 *
 * Each test runs its full dependent chain inside one page.evaluate, waiting for a
 * confirmation between dependent steps (PHICOIN block time ~15s), and returns a
 * per-step trace.
 *
 * NOTE: the service support for MSGCHANNEL / SUB_QUALIFIER issuance and a corrected
 * setVerifierString are being implemented in parallel. These tests are written against
 * the documented API (issueAsset with the AssetType enum value; assetService
 * .setVerifierString(name, verifier)) and act as the verification harness — it is fine
 * if they currently fail until that work lands.
 *
 * Run: ALLOW_BROADCAST=1 npx playwright test tests/e2e/asset-extra-issuance.spec.ts
 */
import { test, expect } from '@playwright/test';
import { gotoUnlocked } from './fixtures';

declare const process: { env: Record<string, string | undefined> };
const ALLOW = process.env.ALLOW_BROADCAST === '1';

type Step = { step: string; txid?: string; confirmed?: boolean; error?: string; [k: string]: unknown };

test.describe.serial('Asset extra issuance (real broadcast, gated)', () => {
  test('MSGCHANNEL: issue a message channel under an owned root', async ({ page }) => {
    test.skip(!ALLOW, 'Set ALLOW_BROADCAST=1');
    test.setTimeout(420000);
    await gotoUnlocked(page, '/');
    const steps = (await page.evaluate(async () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const out: any[] = [];
      const a: any = await import('/src/services/assets.ts');
      const ser: any = await import('/src/services/assetSerialization.ts');
      const w: any = await import('/src/services/wallet.ts');
      const { rpc }: any = await import('/src/services/rpc.ts');
      const svc = a.assetService;
      const waitConfirm = async (txid: string, ms = 180000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          try { const tx = await rpc.raw('getrawtransaction', [txid, true]); if (tx && Number(tx.confirmations ?? 0) >= 1) return true; } catch { /* retry */ }
          await new Promise((r) => setTimeout(r, 5000));
        }
        return false;
      };
      // Pick a root whose "!" owner token this wallet ACTUALLY HOLDS. (Owner tokens
      // are not returned by getassetdata, so discover them from wallet holdings.)
      const pool = (await w.walletService.getDerivedAddressPoolAsync()).map((x: any) => x.address);
      const mine = await svc.listMyAssets(pool);
      const ownerToken = (mine as any[]).find(
        (m) => m.isOwner && Number(m.previousAmount) >= 1 && !String(m.assetId).slice(0, -1).includes('/')
      );
      const root: string | null = ownerToken ? String(ownerToken.assetId).slice(0, -1) : null;
      if (!root) { out.push({ step: 'pickRoot', error: 'no owned root owner-token found' }); return out; }
      out.push({ step: 'pickRoot', root });
      const name = root + '~chan' + Date.now().toString().slice(-6);
      try {
        const txid = await svc.issueAsset({ label: name, quantity: 1, decimalPlaces: 0, assetType: ser.AssetType.MSGCHANNEL });
        const confirmed = await waitConfirm(txid);
        out.push({ step: 'issue', name, txid, confirmed });
      } catch (e: any) { out.push({ step: 'issue', name, error: String(e?.message ?? e) }); }
      return out;
      /* eslint-enable @typescript-eslint/no-explicit-any */
    })) as Step[];
    console.log('MSGCHANNEL_ISSUE=' + JSON.stringify(steps));
    for (const s of steps) expect(s.error, `${s.step} failed: ${s.error}`).toBeUndefined();
    expect(steps.find((s) => s.step === 'issue')?.confirmed).toBe(true);
  });

  test('SUB_QUALIFIER: issue a sub-qualifier under a fresh root qualifier', async ({ page }) => {
    test.skip(!ALLOW, 'Set ALLOW_BROADCAST=1');
    test.setTimeout(540000);
    await gotoUnlocked(page, '/');
    const steps = (await page.evaluate(async () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const out: any[] = [];
      const a: any = await import('/src/services/assets.ts');
      const ser: any = await import('/src/services/assetSerialization.ts');
      const { rpc }: any = await import('/src/services/rpc.ts');
      const svc = a.assetService;
      const waitConfirm = async (txid: string, ms = 180000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          try { const tx = await rpc.raw('getrawtransaction', [txid, true]); if (tx && Number(tx.confirmations ?? 0) >= 1) return true; } catch { /* retry */ }
          await new Promise((r) => setTimeout(r, 5000));
        }
        return false;
      };
      // 1. Ensure a root qualifier exists we hold — issue a fresh one.
      const suffix = Date.now().toString().slice(-6);
      const rootQual = '#RQ' + suffix;
      try {
        const txid = await svc.issueAsset({ label: rootQual, quantity: 1, decimalPlaces: 0, assetType: ser.AssetType.QUALIFIER });
        const confirmed = await waitConfirm(txid);
        out.push({ step: 'issueRoot', rootQual, txid, confirmed });
        if (!confirmed) return out;
      } catch (e: any) { out.push({ step: 'issueRoot', rootQual, error: String(e?.message ?? e) }); return out; }
      // 2. Issue the sub-qualifier under it: "#RQ<...>/#SUB<...>".
      const subQual = rootQual + '/#SUB' + suffix;
      try {
        const txid = await svc.issueAsset({ label: subQual, quantity: 1, decimalPlaces: 0, assetType: ser.AssetType.SUB_QUALIFIER });
        const confirmed = await waitConfirm(txid);
        out.push({ step: 'issueSub', subQual, txid, confirmed });
      } catch (e: any) { out.push({ step: 'issueSub', subQual, error: String(e?.message ?? e) }); }
      return out;
      /* eslint-enable @typescript-eslint/no-explicit-any */
    })) as Step[];
    console.log('SUBQUALIFIER_ISSUE=' + JSON.stringify(steps));
    for (const s of steps) expect(s.error, `${s.step} failed: ${s.error}`).toBeUndefined();
    expect(steps.find((s) => s.step === 'issueRoot')?.confirmed).toBe(true);
    expect(steps.find((s) => s.step === 'issueSub')?.confirmed).toBe(true);
  });

  test('SET_VERIFIER: issue a fresh restricted asset then set its verifier string', async ({ page }) => {
    test.skip(!ALLOW, 'Set ALLOW_BROADCAST=1');
    test.setTimeout(540000);
    await gotoUnlocked(page, '/');
    const steps = (await page.evaluate(async () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const out: any[] = [];
      const a: any = await import('/src/services/assets.ts');
      const ser: any = await import('/src/services/assetSerialization.ts');
      const { rpc }: any = await import('/src/services/rpc.ts');
      const svc = a.assetService;
      const waitConfirm = async (txid: string, ms = 180000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          try { const tx = await rpc.raw('getrawtransaction', [txid, true]); if (tx && Number(tx.confirmations ?? 0) >= 1) return true; } catch { /* retry */ }
          await new Promise((r) => setTimeout(r, 5000));
        }
        return false;
      };
      // Pick an owner token whose $RESTRICTED version does not yet exist.
      const candidates = ['HHBNB', 'HHGHGH', 'HHBNBB', 'HHFFGFG', 'HHGHGHG', 'HHGHGHG2', 'MTYTOPFK1', 'HHBNBHHBNB', 'PLAYWRIGHT', 'HHBNBNN'];
      let base: string | null = null;
      for (const c of candidates) {
        try { const d = await rpc.raw('getassetdata', ['$' + c]); if (!d) { base = c; break; } } catch { base = c; break; }
      }
      if (!base) { out.push({ step: 'pick', error: 'no available $NAME candidate' }); return out; }
      const R = '$' + base;
      out.push({ step: 'pick', restricted: R });
      // 1. Issue a fresh REISSUABLE restricted asset with verifier 'true'. A
      //    verifier change is a reissue, so the asset must be reissuable.
      try {
        const txid = await svc.issueAsset({ label: R, quantity: 100, decimalPlaces: 0, isRevokeable: true, assetType: ser.AssetType.RESTRICTED, verifierString: 'true' });
        const confirmed = await waitConfirm(txid);
        out.push({ step: 'issue', name: R, txid, confirmed });
        if (!confirmed) return out;
      } catch (e: any) { out.push({ step: 'issue', name: R, error: String(e?.message ?? e) }); return out; }
      // 2. Re-set the verifier string for the restricted asset.
      try {
        const txid = await svc.setVerifierString(R, 'true');
        const confirmed = await waitConfirm(txid);
        out.push({ step: 'setVerifier', txid, confirmed });
      } catch (e: any) { out.push({ step: 'setVerifier', error: String(e?.message ?? e) }); }
      return out;
      /* eslint-enable @typescript-eslint/no-explicit-any */
    })) as Step[];
    console.log('SET_VERIFIER=' + JSON.stringify(steps));
    for (const s of steps) expect(s.error, `${s.step} failed: ${s.error}`).toBeUndefined();
    expect(steps.find((s) => s.step === 'issue')?.confirmed).toBe(true);
    expect(steps.find((s) => s.step === 'setVerifier')?.confirmed).toBe(true);
  });
});
