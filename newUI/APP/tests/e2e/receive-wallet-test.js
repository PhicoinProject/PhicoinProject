/**
 * E2E test for Receive, Overview/Dashboard, Wallet, and Backup pages.
 * Run with: node tests/e2e/receive-wallet-test.js
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3001';
const BROWSER_DATA = '/media/runner/FILES/Phicoin_project/newUI/APP/test-results/wallet/browser-data';
const OUT_DIR = '/media/runner/FILES/Phicoin_project/newUI/APP/test-results/e2e-test/receive-wallet';
const PASSWORD = 'MySecurePass1234';

const report = {
  pages: {},
  bugs: [],
  consoleErrors: [],
  missingFeatures: [],
  featureGaps: [],
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(OUT_DIR);

function screenshot(page, name) {
  return page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function safeText(locator) {
  try { return (await locator.textContent()) || ''; } catch { return ''; }
}

async function safeVisible(locator) {
  try { return await locator.isVisible({ timeout: 2000 }); } catch { return false; }
}

async function main() {
  console.log('Launching browser with persistent context...');
  const context = await chromium.launchPersistentContext(BROWSER_DATA, {
    headless: true,
    viewport: { width: 1280, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();

  // Collect console messages (deduplicate)
  const errorSet = new Set();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      const key = msg.text().substring(0, 200);
      if (!errorSet.has(key)) {
        errorSet.add(key);
        report.consoleErrors.push({
          type: msg.type(),
          text: msg.text(),
          location: msg.location()?.url || '',
        });
      }
    }
  });

  page.on('pageerror', (err) => {
    report.consoleErrors.push({
      type: 'pageerror',
      text: err.message,
      location: err.stack || '',
    });
  });

  try {
    // --- Navigate & Unlock ---
    console.log('Navigating to app...');
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(3000);

    // Unlock the wallet via the passphrase input
    const passphraseInput = page.locator('#passphrase');
    if (await safeVisible(passphraseInput)) {
      console.log('Unlock screen detected, entering password...');
      await passphraseInput.fill(PASSWORD);
      await page.locator('button[type="submit"]').click();
      await sleep(4000);
      await page.waitForLoadState('networkidle').catch(() => {});
    }

    await sleep(2000);
    const onDashboard = await safeVisible(page.locator('text=/Dashboard/'));
    const onUnlock = await safeVisible(page.locator('#passphrase'));
    const onCreate = await safeVisible(page.locator('text=/Create PHICOIN Wallet/'));
    console.log(`Dashboard: ${onDashboard}, Unlock: ${onUnlock}, CreateWallet: ${onCreate}`);

    if (onUnlock) {
      report.bugs.push({ page: 'Auth', description: 'Unlock failed - still on unlock screen after entering password', steps: '1. Navigate to / 2. Enter password 3. Still on unlock page' });
    }

    // ========================================
    // 1. OVERVIEW / DASHBOARD (/)
    // ========================================
    console.log('\n=== Testing Overview/Dashboard ===');
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 10000 });
    await sleep(3000);
    await screenshot(page, 'overview-dashboard');

    const overview = { observations: [], bugs: [] };
    const hasDashboard = await safeVisible(page.locator('text=/Dashboard/'));
    overview.observations.push(`Dashboard page loaded: ${hasDashboard}`);

    // Balance display
    const balanceVisible = await safeVisible(page.locator('text=/total\s*balance/i'));
    overview.observations.push(`Balance card visible: ${balanceVisible}`);
    if (balanceVisible) {
      const balanceContent = (await safeText(page.locator('text=/total\s*balance/i').locator('..'))).substring(0, 120);
      overview.observations.push(`Balance card content: ${balanceContent}`);
    }

    const hasPhiText = await safeVisible(page.locator('text=/PHI/'));
    overview.observations.push(`PHI denomination visible: ${hasPhiText}`);

    // Balance breakdown
    const hasUnconfirmed = await safeVisible(page.locator('text=/unconfirmed/i'));
    const hasImmature = await safeVisible(page.locator('text=/immature/i'));
    overview.observations.push(`Unconfirmed balance displayed: ${hasUnconfirmed}`);
    overview.observations.push(`Immature balance displayed: ${hasImmature}`);
    if (!hasUnconfirmed) report.missingFeatures.push('Overview: No unconfirmed balance display (QT shows this)');
    if (!hasImmature) report.missingFeatures.push('Overview: No immature balance display (QT shows mining rewards separately)');
    const hasWatchOnly = await safeVisible(page.locator('text=/watch.?only/i'));
    overview.observations.push(`Watch-only balance displayed: ${hasWatchOnly}`);
    if (!hasWatchOnly) report.missingFeatures.push('Overview: No watch-only balance display (QT shows this)');

    // Network info
    overview.observations.push(`Sync/block status: ${await safeVisible(page.locator('text=/sync|block|verification/i'))}`);
    overview.observations.push(`Recent transactions: ${await safeVisible(page.locator('text=/recent\s*transaction/i'))}`);
    overview.observations.push(`Connections stat: ${await safeVisible(page.locator('text=/connections?/i'))}`);
    overview.observations.push(`Version stat: ${await safeVisible(page.locator('text=/version/i'))}`);
    overview.observations.push(`Price display: ${await safeVisible(page.locator('text=/price|usd|fiat/i'))}`);
    if (!await safeVisible(page.locator('text=/price|usd|fiat/i')))
      report.missingFeatures.push('Overview: No price/fiat display (QT shows market price)');

    overview.observations.push(`Asset count: ${await safeVisible(page.locator('text=/assets?/i'))}`);
    overview.observations.push(`Sync progress bar: ${await safeVisible(page.locator('[role="progressbar"], [class*="progress"]'))}`);
    if (!await safeVisible(page.locator('[role="progressbar"], [class*="progress"]')))
      report.featureGaps.push('Overview: No visual sync progress bar (QT has progress bar)');
    overview.observations.push(`Block height: ${await safeVisible(page.locator('text=/block\s*height/i'))}`);
    overview.observations.push(`Protocol version: ${await safeVisible(page.locator('text=/protocol/i'))}`);
    overview.observations.push(`Network name: ${await safeVisible(page.locator('text=/mainnet|testnet|signet/i'))}`);

    report.pages.overview = overview;

    // ========================================
    // 2. RECEIVE PAGE (/receive)
    // ========================================
    console.log('\n=== Testing Receive Page ===');
    await page.goto(`${BASE_URL}/receive`, { waitUntil: 'networkidle', timeout: 10000 });
    await sleep(2000);
    await screenshot(page, 'receive-initial');

    const receive = { observations: [], bugs: [] };
    receive.observations.push(`Page title: ${await safeText(page.locator('h1').first())}`);

    const genBtn = await safeVisible(page.locator('button').filter({ hasText: /generate/i }));
    receive.observations.push(`Generate Address button: ${genBtn}`);
    receive.observations.push(`Label input: ${await safeVisible(page.locator('input[placeholder*="label" i], input[placeholder*="Label" i]'))}`);
    receive.observations.push(`Amount input: ${await safeVisible(page.locator('input[placeholder*="amount" i], input[placeholder*="Amount" i]'))}`);
    if (!await safeVisible(page.locator('input[placeholder*="amount" i], input[placeholder*="Amount" i]')))
      report.missingFeatures.push('Receive: No amount field for payment URI generation (QT supports amount parameter)');
    receive.observations.push(`Message input: ${await safeVisible(page.locator('input[placeholder*="message" i], input[placeholder*="Message" i]'))}`);
    if (!await safeVisible(page.locator('input[placeholder*="message" i], input[placeholder*="Message" i]')))
      report.missingFeatures.push('Receive: No message field for payment URI generation (QT supports message parameter)');

    // Generate first address
    if (genBtn) {
      console.log('  Generating first address...');
      await page.locator('button').filter({ hasText: /generate/i }).first().click();
      await sleep(4000);

      // Get address from the monospaced text element (the actual address display)
      const addrEls = page.locator('p.font-mono, span.font-mono').first();
      const addrVisible = await safeVisible(addrEls);
      receive.observations.push(`Address display element visible: ${addrVisible}`);

      let addrText = '';
      if (addrVisible) {
        addrText = (await safeText(addrEls)).trim();
      }
      // Fallback: extract from page content
      if (!addrText || !/^[PH]/.test(addrText)) {
        const content = await safeText(page.locator('[class*="mono"]'));
        const match = content.match(/([PH][a-km-zA-HJ-NP-Z1-9]{25,})/);
        if (match) addrText = match[1];
      }

      receive.observations.push(`Generated address: ${addrText || 'not found'}`);
      if (addrText && /^[PH][a-km-zA-HJ-NP-Z1-9]+$/.test(addrText)) {
        receive.observations.push(`Address format valid (P/H prefix, base58 chars)`);
      } else if (addrText) {
        receive.bugs.push(`Unexpected address format: ${addrText}`);
      }

      receive.observations.push(`QR code SVG: ${await safeVisible(page.locator('svg'))}`);
      receive.observations.push(`QR code pattern: ${await safeVisible(page.locator('[shape-rendering="crispEdges"]'))}`);
      await screenshot(page, 'receive-with-address');

      const copyBtn = await safeVisible(page.locator('button').filter({ hasText: /copy/i }));
      receive.observations.push(`Copy address button: ${copyBtn}`);
      if (copyBtn) {
        try {
          await page.locator('button').filter({ hasText: /copy/i }).first().click();
          await sleep(500);
          receive.observations.push(`Copy toast: ${await safeVisible(page.locator('text=/copied|success/i'))}`);
        } catch {
          receive.observations.push(`Copy clicked (clipboard denied in headless is expected)`);
        }
      }

      receive.observations.push(`New Address button: ${await safeVisible(page.locator('button').filter({ hasText: /new\s*address/i }))}`);
      receive.observations.push(`Payment URI (phicoin:): ${await safeVisible(page.locator('text=/phicoin:/'))}`);
      if (!await safeVisible(page.locator('text=/phicoin:/')))
        report.missingFeatures.push('Receive: No payment URI display (phicoin:address?amount=X&label=Y&message=Z)');

      // Generate multiple addresses
      console.log('  Generating multiple addresses...');
      const generatedAddresses = [];
      for (let i = 0; i < 5; i++) {
        // Extract address from monospaced text
        const pageText = await page.textContent('p.font-mono').catch(() => '');
        const m = pageText.match(/([PH][a-km-zA-HJ-NP-Z1-9]{25,})/);
        if (m) generatedAddresses.push(m[1]);

        if (await safeVisible(page.locator('button').filter({ hasText: /new\s*address/i })))
          await page.locator('button').filter({ hasText: /new\s*address/i }).first().click();
        else
          await page.locator('button').filter({ hasText: /generate/i }).first().click();
        await sleep(2500);
      }

      const unique = [...new Set(generatedAddresses)];
      receive.observations.push(`Generated ${generatedAddresses.length} addresses, ${unique.length} unique`);
      if (unique.length > 0)
        receive.observations.push(`Samples: ${unique.slice(0, 3).join(' | ')}`);
      if (unique.length === generatedAddresses.length)
        receive.observations.push(`Each generation produces a new unique address (HD sequential)`);
    }

    receive.observations.push(`Recent payment requests: ${await safeVisible(page.locator('text=/recent\s*payment/i'))}`);
    if (!await safeVisible(page.locator('text=/recent\s*payment/i')))
      report.missingFeatures.push('Receive: No recent payment requests section (QT shows payment request history)');
    receive.observations.push(`Save QR button: ${await safeVisible(page.locator('button').filter({ hasText: /save.*qr|download.*qr/i }))}`);
    if (!await safeVisible(page.locator('button').filter({ hasText: /save.*qr|download.*qr/i })))
      report.missingFeatures.push('Receive: No save/download QR code button (QT allows saving QR as file)');

    report.pages.receive = receive;

    // ========================================
    // 3. WALLET PAGE (/wallet)
    // ========================================
    console.log('\n=== Testing Wallet Page ===');
    await page.goto(`${BASE_URL}/wallet`, { waitUntil: 'networkidle', timeout: 10000 });
    await sleep(4000);
    await screenshot(page, 'wallet-page');

    const wallet = { observations: [], bugs: [] };
    wallet.observations.push(`Page title: ${await safeText(page.locator('h1').first())}`);
    wallet.observations.push(`Network status card: ${await safeVisible(page.locator('text=/network\s*status/i'))}`);
    wallet.observations.push(`Chain info: ${await safeVisible(page.locator('text=/network/i'))}`);
    wallet.observations.push(`Blocks info: ${await safeVisible(page.locator('text=/blocks?/i'))}`);
    wallet.observations.push(`Headers info: ${await safeVisible(page.locator('text=/headers?/i'))}`);
    wallet.observations.push(`Verification progress: ${await safeVisible(page.locator('text=/verification\s*progress/i'))}`);
    wallet.observations.push(`Refresh button: ${await safeVisible(page.locator('button').filter({ hasText: /refresh/i }))}`);
    wallet.observations.push(`Backup Wallet button: ${await safeVisible(page.locator('button').filter({ hasText: /backup/i }))}`);
    wallet.observations.push(`Sign Message button: ${await safeVisible(page.locator('button').filter({ hasText: /sign\s*message/i }))}`);
    wallet.observations.push(`Verify Message button: ${await safeVisible(page.locator('button').filter({ hasText: /verify\s*message/i }))}`);

    const signBtn = await safeVisible(page.locator('button').filter({ hasText: /sign\s*message/i }));
    if (signBtn) {
      const disabled = await page.locator('button').filter({ hasText: /sign\s*message/i }).first().isDisabled().catch(() => false);
      wallet.observations.push(`Sign Message disabled: ${disabled}`);
    }

    wallet.observations.push(`Addresses section: ${await safeVisible(page.locator('text=/addresses?/i'))}`);
    wallet.observations.push(`HD Wallet indicator: ${await safeVisible(page.locator('text=/hd\s*wallet/i'))}`);
    wallet.observations.push(`Gap limit setting: ${await safeVisible(page.locator('text=/gap.*limit/i'))}`);
    if (!await safeVisible(page.locator('text=/gap.*limit/i')))
      report.featureGaps.push('Wallet: No gap limit configuration UI (QT allows configuring address gap limit)');

    report.pages.wallet = wallet;

    // ========================================
    // 4. BACKUP PAGE (/backup)
    // ========================================
    console.log('\n=== Testing Backup Page ===');
    await page.goto(`${BASE_URL}/backup`, { waitUntil: 'networkidle', timeout: 10000 });
    await sleep(2000);
    await screenshot(page, 'backup-initial');

    const backup = { observations: [], bugs: [] };
    backup.observations.push(`Page title: ${await safeText(page.locator('h1').first())}`);
    backup.observations.push(`Security warning: ${await safeVisible(page.locator('text=/important|never\s*store|securely/i'))}`);

    const genBackupBtn = await safeVisible(page.locator('button').filter({ hasText: /generate\s*backup/i }));
    backup.observations.push(`Generate Backup button: ${genBackupBtn}`);

    if (genBackupBtn) {
      console.log('  Generating backup...');
      await page.locator('button').filter({ hasText: /generate\s*backup/i }).first().click();
      await sleep(3000);

      const hasBackupData = await safeVisible(page.locator('pre'));
      backup.observations.push(`Backup JSON displayed: ${hasBackupData}`);

      if (hasBackupData) {
        const content = await safeText(page.locator('pre'));
        backup.observations.push(`Backup format preview: ${content.substring(0, 400)}`);
        const hasVer = content.includes('"version"');
        const hasFmt = content.includes('"format"');
        const hasEnc = content.includes('"encrypted"');
        const hasKdf = content.includes('"kdf"');
        backup.observations.push('Has version field: ' + hasVer);
        backup.observations.push('Has format field: ' + hasFmt);
        backup.observations.push('Has encrypted section: ' + hasEnc);
        backup.observations.push('Has KDF info: ' + hasKdf);
        if (hasVer && hasEnc && hasKdf)
          backup.observations.push('Follows v2 encrypted backup format');

        backup.observations.push(`Download File button: ${await safeVisible(page.locator('button').filter({ hasText: /download/i }))}`);
        backup.observations.push(`Copy to clipboard: ${await safeVisible(page.locator('button').filter({ hasText: /copy/i }))}`);
        await screenshot(page, 'backup-generated');
      }

      const err = await safeVisible(page.locator('text=/no wallet found/i'));
      backup.observations.push(`Backup error: ${err}`);
      if (err) {
        backup.bugs.push('Backup fails with "No wallet found" despite wallet existing');
        report.bugs.push({ page: 'Backup', description: 'Backup fails with no wallet error', steps: '1. Go to /backup 2. Click Generate Backup 3. Error appears' });
      }
    }

    const hasMnemonicExport = await safeVisible(page.locator('text=/mnemonic|seed\s*phrase|recovery\s*phrase/i'));
    backup.observations.push(`Mnemonic/seed export: ${hasMnemonicExport}`);
    if (!hasMnemonicExport)
      report.featureGaps.push('Backup: No 24-word mnemonic export (QT shows recovery phrase option)');
    backup.observations.push(`Import wallet link: ${await safeVisible(page.locator('text=/import/i'))}`);

    report.pages.backup = backup;

    // ========================================
    // 5. FINAL SCREENSHOTS
    // ========================================
    console.log('\n=== Final screenshots ===');
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 10000 });
    await sleep(1000);
    await screenshot(page, 'full-layout-with-nav');

  } catch (err) {
    console.error('Test error:', err.message);
    report.bugs.push({ description: `Test execution error: ${err.message}`, stack: err.stack });
  } finally {
    await context.close();
  }

  // ========================================
  // REPORT
  // ========================================
  console.log('\n========================================');
  console.log('E2E TEST REPORT');
  console.log('========================================\n');

  console.log('--- UI Observations ---');
  for (const [name, data] of Object.entries(report.pages)) {
    console.log(`\n[${name.toUpperCase()}]`);
    data.observations.forEach(o => console.log(`  ✓ ${o}`));
    if (data.bugs) data.bugs.forEach(b => console.log(`  ✗ ${b}`));
  }

  console.log('\n--- Bugs Found ---');
  if (report.bugs.length === 0) console.log('  No critical bugs found.');
  else report.bugs.forEach((b, i) => console.log(`  ${i + 1}. ${typeof b === 'string' ? b : b.description}\n     Steps: ${b.steps || 'N/A'}`));

  console.log('\n--- Missing Features vs QT ---');
  report.missingFeatures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));

  console.log('\n--- Feature Gaps ---');
  report.featureGaps.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));

  console.log('\n--- Console Errors ---');
  if (report.consoleErrors.length === 0) console.log('  No console errors detected.');
  else {
    console.log(`  ${report.consoleErrors.length} unique errors:`);
    report.consoleErrors.slice(0, 10).forEach((e, i) => {
      console.log(`  ${i + 1}. [${e.type}] ${e.text.substring(0, 200)}`);
      if (e.location) console.log(`     at ${e.location.substring(0, 200)}`);
    });
    if (report.consoleErrors.length > 10) console.log(`  ... and ${report.consoleErrors.length - 10} more`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'e2e-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nReport: ${path.join(OUT_DIR, 'e2e-report.json')}`);
  console.log(`Screenshots: ${OUT_DIR}/`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
