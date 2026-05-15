import { chromium } from 'playwright';
import fs from 'fs';

const REPORT_DIR = '/media/runner/FILES/Phicoin_project/newUI/APP/test-results/screenshots';
const MAX_ATTEMPTS = 5;
const INTERVAL_MS = 30000;
const WALLET_PASSPHRASE = 'phi_test_2026';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTest(runNum) {
  const now = new Date().toISOString().replace(/:/g, '-');
  const userDataDir = `/tmp/phi-monitor-${runNum}`;
  const browser = await chromium.launchPersistentContext(userDataDir, { headless: true, viewport: { width: 1280, height: 800 } });
  const page = browser.pages()[0] || await browser.newPage();
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  let status = 'init';

  try {
    await page.goto('http://localhost:3001/', { waitUntil: 'networkidle', timeout: 10000 });
    await sleep(3000);
    const bodyText = await page.textContent('body') || '';

    // Step 1: Create wallet
    if (bodyText.includes('Recovery Phrase') && bodyText.includes('I have written down')) {
      status = 'creating_wallet';
      const words = [];
      const wordElements = await page.$$('div.flex.items-center.gap-2 span.text-sm.font-medium');
      for (const el of wordElements) words.push((await el.textContent()).trim());

      await page.locator('input[type="checkbox"]').first().check();
      await sleep(500);
      await page.getByRole('button', { name: 'Next' }).click();
      await sleep(2000);

      await page.locator('#userSeed').first().fill('12345678');
      await sleep(500);
      await page.getByRole('button', { name: 'Next' }).click();
      await sleep(2000);

      await page.locator('#password').first().fill(WALLET_PASSPHRASE);
      await page.locator('#confirmPassword').first().fill(WALLET_PASSPHRASE);
      const cbs = await page.$$('input[type="checkbox"]');
      for (const cb of cbs) if (!(await cb.isChecked())) await cb.click().catch(()=>{});
      await sleep(500);
      const sb = page.getByRole('button', { name: 'Create Wallet' });
      if (await sb.isEnabled({ timeout: 3000 }).catch(()=>false)) {
        await sb.click();
        await sleep(5000);
      }
      status = 'wallet_submitted';
    }
    await page.screenshot({ path: `${REPORT_DIR}/monitor-r${runNum}-step3.png` });

    // Step 4: Quiz
    const bt2 = await page.textContent('body') || '';
    if (bt2.includes('Verify Recovery Phrase')) {
      status = 'answering_quiz';
      const quizPositions = await page.$$eval('span.rounded.bg-phi-primary', els => els.map(e => parseInt(e.textContent.trim())));
      const quizInputs = await page.$$('div.flex.items-center.gap-3 input[type="text"]');
      for (let i = 0; i < quizInputs.length; i++) {
        const posNum = quizPositions[i];
        const correctWord = words[posNum - 1];
        await quizInputs[i].fill(correctWord);
        await sleep(300);
      }
      await page.getByRole('button', { name: /verify/i }).first().click();
      await sleep(3000);
      status = 'quiz_completed';
    }
    await page.screenshot({ path: `${REPORT_DIR}/monitor-r${runNum}-quiz.png` });

    // Step 5: Continue to Dashboard
    const bt3 = await page.textContent('body') || '';
    if (bt3.includes('Continue to Dashboard')) {
      status = 'continue_dashboard';
      await page.getByRole('button', { name: 'Continue to Dashboard' }).click();
      await sleep(3000);
    }
    await page.screenshot({ path: `${REPORT_DIR}/monitor-r${runNum}-continue.png` });

    // Step 6: Unlock
    const bt4 = await page.textContent('body') || '';
    if (bt4.includes('Unlock') || bt4.includes('Enter your passphrase')) {
      status = 'unlocking';
      await page.locator('#passphrase').first().fill(WALLET_PASSPHRASE);
      await sleep(500);
      const ub = page.getByRole('button', { name: /unlock/i }).first();
      if (await ub.isEnabled({ timeout: 3000 }).catch(()=>false)) {
        await ub.click();
        await sleep(4000);
      }
      status = 'unlocked';
    }
    await page.screenshot({ path: `${REPORT_DIR}/monitor-r${runNum}-unlock.png` });

    // Step 7: Navigate to /create-asset
    const bt5 = await page.textContent('body') || '';
    if (bt5.includes('Balance') || bt5.includes('Dashboard')) {
      status = 'on_dashboard';
      await page.goto('http://localhost:3001/create-asset', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(3000);
      status = 'asset_page_open';
      await page.screenshot({ path: `${REPORT_DIR}/monitor-r${runNum}-asset_page.png` });

      // Click "Create New Asset" button to open modal
      await page.getByRole('button', { name: 'Create New Asset' }).click();
      await sleep(2000);

      // Fill modal form: Asset Label, Quantity
      await page.locator('#create-asset-label').first().fill('MON' + now.slice(-6));
      await sleep(500);
      await page.locator('#create-asset-quantity').first().fill('1000');
      await sleep(500);
      await page.screenshot({ path: `${REPORT_DIR}/monitor-r${runNum}-modal_filled.png` });

      // Click "Issue ROOT Asset" button
      await page.getByRole('button', { name: /issue.*root/i }).first().click();
      await sleep(10000);
      status = 'asset_submitted';
    }

    const finalText = await page.textContent('body') || '';
    await page.screenshot({ path: `${REPORT_DIR}/monitor-r${runNum}-final.png`, fullPage: true });
    if (finalText.toLowerCase().includes('success') || finalText.toLowerCase().includes('broadcast')) status = 'SUCCESS';
    else if (finalText.toLowerCase().includes('no utxo')) status = 'NO_UTXOS';
    else if (finalText.toLowerCase().includes('error') || finalText.toLowerCase().includes('fail') || finalText.toLowerCase().includes('reject')) status = 'FAILED';
    else if (finalText.includes('Balance') || finalText.includes('Dashboard')) status = 'ON_DASHBOARD';
  } catch (err) {
    status = `error: ${err.message.substring(0, 120)}`;
    await page.screenshot({ path: `${REPORT_DIR}/monitor-r${runNum}-error.png` }).catch(()=>{});
  }

  const statusData = { run: runNum, timestamp: now, status,
    consoleErrors: logs.filter(l => /error|fail|reject|malformed/i.test(l)).slice(0, 10),
    pageErrors: pageErrors.slice(0, 5),
    assetLogs: logs.filter(l => /asset|scriptPubKey|CNewAsset|buildAssetScript/i.test(l)).slice(0, 10),
  };
  fs.writeFileSync(`${REPORT_DIR}/monitor-latest.json`, JSON.stringify(statusData, null, 2));
  await browser.close();
  return statusData;
}

async function main() {
  console.log('=== Asset Issuance Monitor ===');
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const r = await runTest(i);
    const icon = r.status === 'SUCCESS' ? '✓' : r.status === 'NO_UTXOS' ? '~' : r.status.includes('error') ? '✗' : r.status === 'FAILED' ? '!' : '○';
    console.log(`  [${i}/${MAX_ATTEMPTS}] ${icon} ${r.status}`);
    if (r.consoleErrors.length) for (const e of r.consoleErrors.slice(0,3)) console.log(`    ⚠ ${e.substring(0,120)}`);
    if (['SUCCESS','NO_UTXOS','FAILED'].includes(r.status)) { console.log(`\n  *** ${r.status} ***\n`); break; }
    if (i < MAX_ATTEMPTS) await sleep(INTERVAL_MS);
  }
  console.log('=== Done ===');
}
main().catch(e => console.error(e));
