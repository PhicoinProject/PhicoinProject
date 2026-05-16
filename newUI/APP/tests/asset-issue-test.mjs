/**
 * Playwright test: Asset issuance E2E
 * Creates wallet, unlocks, then tries to issue an asset
 * Checks console for errors
 */

import { chromium } from 'playwright';

async function run() {
  console.log(`\n=== Asset Issue Test (${new Date().toISOString()}) ===`);

  const browser = await chromium.launchPersistentContext(
    '/tmp/phi-playwright-e2e',
    { headless: true, viewport: { width: 1280, height: 800 } }
  );
  const page = browser.pages()[0] || await browser.newPage();

  const consoleLogs = [];
  const errors = [];

  page.on('console', msg => consoleLogs.push(msg.text()));
  page.on('pageerror', err => errors.push(err.message));

  try {
    // Navigate
    await page.goto('http://localhost:13001/', { waitUntil: 'networkidle', timeout: 10000 });

    // Check if wallet exists
    const hasWallet = await page.evaluate(() => localStorage.getItem('phi:v2wallet'));

    if (!hasWallet) {
      console.log('[1/5] Creating wallet...');
      await page.getByRole('button', { name: /create/i }).click();
      await page.waitForTimeout(1000);

      const passphraseInput = page.locator('#mnemonic-passphrase');
      if (await passphraseInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await passphraseInput.fill('');
      }
      await page.getByRole('button', { name: /create/i }).click();
      await page.waitForTimeout(2000);
    } else {
      console.log('[1/5] Wallet exists, navigating to unlock...');
    }

    // Unlock if needed
    const onDashboard = await page.locator('#dashboard-title').first().isVisible({ timeout: 2000 }).catch(() => false);
    if (!onDashboard) {
      console.log('[2/5] Unlocking wallet...');
      const unlockBtn = page.getByRole('button', { name: /unlock/i });
      if (await unlockBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await unlockBtn.click();
        await page.waitForTimeout(1000);
      }
      // Try to find password input and fill
      const passInput = page.locator('#unlock-password').first();
      if (await passInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await passInput.fill('');
        const submitBtn = page.getByRole('button', { name: /unlock/i });
        await submitBtn.click();
        await page.waitForTimeout(2000);
      }
    } else {
      console.log('[2/5] Already unlocked');
    }

    // Check current page
    const currentUrl = page.url();
    console.log(`[3/5] Current URL: ${currentUrl}`);

    // Try to find asset button
    const assetBtn = page.getByRole('button', { name: /asset/i, exact: false }).first();
    if (await assetBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[4/5] Clicking Create Asset button...');
      await assetBtn.click();
      await page.waitForTimeout(2000);
    }

    // Fill asset form
    const labelInput = page.locator('#asset-label').first();
    if (await labelInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await labelInput.fill('PHTEST' + Date.now().toString(36));
      await page.waitForTimeout(500);

      const qtyInput = page.locator('#asset-quantity').first();
      if (await qtyInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await qtyInput.fill('1000');
      }

      const submitBtn = page.getByRole('button', { name: /issue|create|submit/i }).first();
      await submitBtn.click();
      console.log('[5/5] Submitted asset creation');
      await page.waitForTimeout(5000);

      // Check for success/error
      const success = await page.getByText(/success|issued|broadcast/i).first().isVisible({ timeout: 3000 }).catch(() => false);
      const toastError = await page.getByText(/error|failed|rejected/i).first().isVisible({ timeout: 2000 }).catch(() => false);

      if (success) console.log('  RESULT: SUCCESS!');
      else if (toastError) console.log('  RESULT: FAILED - check errors below');
      else console.log('  RESULT: No clear response yet');

      // Screenshot
      await page.screenshot({ path: '/media/runner/FILES/Phicoin_project/newUI/APP/test-results/screenshots/asset-issue-result.png' });
    } else {
      console.log('[4/5] Asset form not found. Checking page state...');
      await page.screenshot({ path: '/media/runner/FILES/Phicoin_project/newUI/APP/test-results/screenshots/asset-issue-page.png' });
    }

    // Console errors
    const rpcErrors = consoleLogs.filter(l => l.toLowerCase().includes('error') || l.toLowerCase().includes('fail'));
    if (rpcErrors.length) {
      console.log('\n  Console errors:');
      for (const e of rpcErrors.slice(0, 10)) console.log(`    ${e}`);
    }
    if (errors.length) {
      console.log('\n  Page errors:');
      for (const e of errors.slice(0, 10)) console.log(`    ${e}`);
    }

    // Check if serialization is correct
    const assetScriptLogs = consoleLogs.filter(l => l.includes('Asset scriptPubKey') || l.includes('assetScriptHex'));
    if (assetScriptLogs.length) {
      console.log('\n  Asset script logs:');
      for (const l of assetScriptLogs) console.log(`    ${l}`);
    }

  } catch (err) {
    console.log(`Error: ${err.message}`);
  } finally {
    await browser.close();
    console.log('=== Test Complete ===\n');
  }
}

run();
