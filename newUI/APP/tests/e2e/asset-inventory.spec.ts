/**
 * asset-inventory.spec.ts — read-only snapshot of the wallet's spendable balance,
 * every asset held, and which owner tokens (NAME!) are present. No broadcast.
 * Used to plan the asset test matrix and funding needs.
 */
import { test } from '@playwright/test';
import { gotoUnlocked } from './fixtures';

test('inventory: balance + assets + owner tokens + addresses', async ({ page }) => {
  test.setTimeout(150000);
  await gotoUnlocked(page, '/');
  const result = await page.evaluate(async () => {
    const w = await import('/src/services/wallet.ts');
    const a = await import('/src/services/assets.ts');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walletService = (w as any).walletService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assetService = (a as any).assetService;
    const pool = (await walletService.getDerivedAddressPoolAsync()).map((x: { address: string }) => x.address);
    const utxos = await walletService.getUnspent(pool);
    const balanceSat = utxos.reduce((s: number, u: { amount: number }) => s + Math.round(u.amount * 1e8), 0);
    const assets = await assetService.listMyAssets(pool);
    return {
      poolSize: pool.length,
      firstAddrs: pool.slice(0, 3),
      utxoCount: utxos.length,
      balancePHI: balanceSat / 1e8,
      assets: assets.map((x: { assetId: string; previousAmount: number; isOwner: boolean }) => ({
        id: x.assetId,
        amount: x.previousAmount,
        owner: x.isOwner,
      })),
    };
  });
  console.log('INVENTORY=' + JSON.stringify(result, null, 2));
});
