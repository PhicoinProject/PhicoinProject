/**
 * asset-matrix.spec.ts — REAL on-chain verification of every asset type & operation,
 * gated behind ALLOW_BROADCAST=1.
 *
 *   1. UNIQUE (NFT)  : issue + transfer
 *   2. QUALIFIER     : issue + assign tag + remove tag
 *   3. RESTRICTED    : issue + transfer + freeze/unfreeze address + global freeze/unfreeze
 *                      (incl. negative proof: transfer rejected while globally frozen)
 *   4. REISSUE       : add supply to a reissuable asset
 *
 * Each test runs its full dependent chain inside one page.evaluate, waiting for a
 * confirmation between steps (PHICOIN block time ~15s), and returns a per-step trace.
 *
 * Run: ALLOW_BROADCAST=1 npx playwright test tests/e2e/asset-matrix.spec.ts
 */
import { test, expect } from '@playwright/test';
import { gotoUnlocked } from './fixtures';

declare const process: { env: Record<string, string | undefined> };
const ALLOW = process.env.ALLOW_BROADCAST === '1';

type Step = { step: string; txid?: string; confirmed?: boolean; error?: string; [k: string]: unknown };

test.describe.serial('Asset matrix (real broadcast, gated)', () => {
  test('UNIQUE: issue NFT + transfer', async ({ page }) => {
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
      const pool = (await w.walletService.getDerivedAddressPoolAsync()).map((x: any) => x.address);
      const waitConfirm = async (txid: string, ms = 180000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          try { const tx = await rpc.raw('getrawtransaction', [txid, true]); if (tx && Number(tx.confirmations ?? 0) >= 1) return true; } catch { /* retry */ }
          await new Promise((r) => setTimeout(r, 5000));
        }
        return false;
      };
      const name = 'PLAYWRIGHT#NFT' + Date.now().toString().slice(-6);
      try {
        const txid = await svc.issueAsset({ label: name, quantity: 1, decimalPlaces: 0, assetType: ser.AssetType.UNIQUE });
        const confirmed = await waitConfirm(txid);
        out.push({ step: 'issue', name, txid, confirmed });
        if (!confirmed) return out;
      } catch (e: any) { out.push({ step: 'issue', name, error: String(e?.message ?? e) }); return out; }
      try {
        const txid = await svc.transferAsset(name, 1, pool[2], '');
        const confirmed = await waitConfirm(txid);
        out.push({ step: 'transfer', txid, confirmed, to: pool[2] });
      } catch (e: any) { out.push({ step: 'transfer', error: String(e?.message ?? e) }); }
      return out;
      /* eslint-enable @typescript-eslint/no-explicit-any */
    })) as Step[];
    console.log('UNIQUE_MATRIX=' + JSON.stringify(steps));
    for (const s of steps) expect(s.error, `${s.step} failed: ${s.error}`).toBeUndefined();
    expect(steps.find((s) => s.step === 'issue')?.confirmed).toBe(true);
    expect(steps.find((s) => s.step === 'transfer')?.confirmed).toBe(true);
  });

  test('QUALIFIER: issue + assign tag + remove tag', async ({ page }) => {
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
      const pool = (await w.walletService.getDerivedAddressPoolAsync()).map((x: any) => x.address);
      const waitConfirm = async (txid: string, ms = 180000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          try { const tx = await rpc.raw('getrawtransaction', [txid, true]); if (tx && Number(tx.confirmations ?? 0) >= 1) return true; } catch { /* retry */ }
          await new Promise((r) => setTimeout(r, 5000));
        }
        return false;
      };
      const qual = '#QA' + Date.now().toString().slice(-6);
      try {
        const txid = await svc.issueAsset({ label: qual, quantity: 1, decimalPlaces: 0, assetType: ser.AssetType.QUALIFIER });
        const confirmed = await waitConfirm(txid);
        out.push({ step: 'issue', qual, txid, confirmed });
        if (!confirmed) return out;
      } catch (e: any) { out.push({ step: 'issue', qual, error: String(e?.message ?? e) }); return out; }
      try {
        const txid = await svc.assignQualifier(qual, pool[1]);
        const confirmed = await waitConfirm(txid);
        out.push({ step: 'assign', txid, confirmed, to: pool[1] });
        if (!confirmed) return out;
      } catch (e: any) { out.push({ step: 'assign', error: String(e?.message ?? e) }); return out; }
      try {
        const txid = await svc.removeQualifier(qual, pool[1]);
        const confirmed = await waitConfirm(txid);
        out.push({ step: 'remove', txid, confirmed });
      } catch (e: any) { out.push({ step: 'remove', error: String(e?.message ?? e) }); }
      return out;
      /* eslint-enable @typescript-eslint/no-explicit-any */
    })) as Step[];
    console.log('QUALIFIER_MATRIX=' + JSON.stringify(steps));
    for (const s of steps) expect(s.error, `${s.step} failed: ${s.error}`).toBeUndefined();
    expect(steps.find((s) => s.step === 'issue')?.confirmed).toBe(true);
    expect(steps.find((s) => s.step === 'assign')?.confirmed).toBe(true);
    expect(steps.find((s) => s.step === 'remove')?.confirmed).toBe(true);
  });

  test('RESTRICTED: issue + transfer + freeze/unfreeze + global lock/unlock', async ({ page }) => {
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
      // Pick an owner token whose $RESTRICTED version does not yet exist.
      const candidates = ['HHBNB', 'HHGHGH', 'HHBNBB', 'HHFFGFG', 'HHGHGHG', 'HHGHGHG2', 'MTYTOPFK1', 'HHBNBHHBNB', 'PLAYWRIGHT', 'HHBNBNN'];
      let base: string | null = null;
      for (const c of candidates) {
        try { const d = await rpc.raw('getassetdata', ['$' + c]); if (!d) { base = c; break; } } catch { base = c; break; }
      }
      if (!base) { out.push({ step: 'pick', error: 'no available $NAME candidate' }); return out; }
      const R = '$' + base;
      out.push({ step: 'pick', restricted: R });
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
      if (!(await run('issue', () => svc.issueAsset({ label: R, quantity: 100, decimalPlaces: 0, assetType: ser.AssetType.RESTRICTED, verifierString: 'true' })))) return out;
      if (!(await run('transfer', () => svc.transferAsset(R, 10, pool[1], '')))) return out;
      if (!(await run('freezeAddress', () => svc.freezeAddress(R, pool[1])))) return out;
      if (!(await run('unfreezeAddress', () => svc.unfreezeAddress(R, pool[1])))) return out;
      if (!(await run('globalFreeze', () => svc.globalFreeze(R)))) return out;
      await run('transfer-while-frozen', () => svc.transferAsset(R, 1, pool[2], ''), true);
      await run('globalUnfreeze', () => svc.globalUnfreeze(R));
      return out;
      /* eslint-enable @typescript-eslint/no-explicit-any */
    })) as Step[];
    console.log('RESTRICTED_MATRIX=' + JSON.stringify(steps));
    const get = (s: string) => steps.find((x) => x.step === s);
    expect(get('issue')?.confirmed, 'issue $restricted').toBe(true);
    expect(get('transfer')?.confirmed, 'transfer restricted').toBe(true);
    expect(get('freezeAddress')?.confirmed, 'freeze address').toBe(true);
    expect(get('unfreezeAddress')?.confirmed, 'unfreeze address').toBe(true);
    expect(get('globalFreeze')?.confirmed, 'global freeze').toBe(true);
    // Negative proof: a transfer must be rejected while globally frozen.
    expect(get('transfer-while-frozen')?.unexpectedlyAccepted, 'transfer should be rejected while frozen').not.toBe(true);
    expect(get('globalUnfreeze')?.confirmed, 'global unfreeze').toBe(true);
  });

  test('REISSUE: add supply to a reissuable asset', async ({ page }) => {
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
      // Issue a fresh reissuable ROOT, then reissue +50 onto it (self-contained).
      const name = 'PHIRE' + Date.now().toString().slice(-6);
      try {
        const txid = await svc.issueAsset({ label: name, quantity: 100, decimalPlaces: 0, isRevokeable: true });
        const confirmed = await waitConfirm(txid);
        out.push({ step: 'issue', name, txid, confirmed });
        if (!confirmed) return out;
      } catch (e: any) { out.push({ step: 'issue', name, error: String(e?.message ?? e) }); return out; }
      try {
        const before = await rpc.raw('getassetdata', [name]);
        const txid = await svc.reissueAsset({ name, quantity: 50, decimalPlaces: 0, reissuable: true });
        const confirmed = await waitConfirm(txid);
        const after = await rpc.raw('getassetdata', [name]);
        out.push({ step: 'reissue', txid, confirmed, beforeAmount: before?.amount, afterAmount: after?.amount });
      } catch (e: any) { out.push({ step: 'reissue', error: String(e?.message ?? e) }); }
      return out;
      /* eslint-enable @typescript-eslint/no-explicit-any */
    })) as Step[];
    console.log('REISSUE_MATRIX=' + JSON.stringify(steps));
    for (const s of steps) expect(s.error, `${s.step} failed: ${s.error}`).toBeUndefined();
    expect(steps.find((s) => s.step === 'issue')?.confirmed).toBe(true);
    const re = steps.find((s) => s.step === 'reissue');
    expect(re?.confirmed).toBe(true);
    expect(Number(re?.afterAmount)).toBe(Number(re?.beforeAmount) + 50);
  });
});
