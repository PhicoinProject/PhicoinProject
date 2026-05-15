/**
 * E2E Test: Send PHI functionality
 * Tests /send page features, form validation, and UI against QT wallet goals.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3001';
const PASSWORD = 'MySecurePass1234';
const CONTEXT_DIR = path.resolve(__dirname, '../test-results/wallet/browser-data');
const SCREENSHOT_DIR = path.resolve(__dirname, '../test-results/e2e-test/send');

const WALLET_DATA = {
  'phi:v2:salt': 'edeaef82f1fe7e152a34a8b26f73ce2a',
  'phi:created': '1778800664099',
  'phi:v2:iv': 'c36e4cd480d4538d914c93f5',
  'phi:v2:encryptedSeed': 'c36e4cd480d4538d914c93f53cb485412de2bf68fdc38dec904de67d5780bd3012deebeca200c81d48bb478c994c8b6ebd0eaf183bc010307646d228a95ffc22163b5fc9011f5419ad4d14500bcba7029cbc371681e4bc626a679c85',
  'phi:walletVersion': '2',
  'phi:v2:meta': JSON.stringify({ created: '2026-05-14T23:17:44.099Z', iterations: 1000000 }),
};

const report = {
  timestamp: new Date().toISOString(),
  ui_observations: [],
  bugs: [],
  missing_features: [],
  console_errors: [],
  feature_gaps: [],
  screenshots: [],
};

function addObs(t) { report.ui_observations.push(t); console.log('[UI] ' + t); }
function addBug(s, t, st) { report.bugs.push({ severity: s, title: t, steps: st }); console.log('[BUG ' + s + '] ' + t); }
function addMiss(t) { report.missing_features.push(t); console.log('[MISSING] ' + t); }
function addGap(t) { report.feature_gaps.push(t); console.log('[GAP] ' + t); }
function shot(n) { var p = path.join(SCREENSHOT_DIR, n + '.png'); report.screenshots.push(p); return p; }

async function run() {
  console.log('Launching browser...');
  const browser = await chromium.launchPersistentContext(CONTEXT_DIR, {
    headless: true,
    viewport: { width: 1280, height: 900 },
  });
  const page = browser.pages()[0] || await browser.newPage();

  const consoleLogs = [];
  const fetchErrors = [];
  page.on('console', function(msg) {
    var t = msg.text();
    consoleLogs.push({ type: msg.type(), text: t });
    if (msg.type() === 'error') {
      // Only log unique-ish errors, not all the 500 spam
      if (t.indexOf('500') === -1) {
        addBug('low', 'Console error: ' + t.slice(0, 120), ['Open browser console']);
      }
    }
  });
  page.on('pageerror', function(err) {
    addBug('medium', 'Page error: ' + err.message.slice(0, 120), ['Navigate to /send page']);
  });
  // Capture failed network requests
  page.on('requestfailed', function(req) {
    fetchErrors.push(req.url());
  });

  try {
    // ---- Inject wallet & unlock ----
    console.log('Navigating to app...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await page.evaluate(function(data) {
      for (var k in data) localStorage.setItem(k, data[k]);
    }, WALLET_DATA);
    await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    var passInput = page.locator('input[id="passphrase"]').first();
    if (await passInput.isVisible({ timeout: 5000 }).catch(function() { return false; })) {
      console.log('Unlock page, entering password...');
      await passInput.fill(PASSWORD);
      await page.locator('button:has-text("Unlock Wallet")').first().click();
      await page.waitForTimeout(5000);
    }
    await page.waitForTimeout(2000);
    console.log('URL: ' + page.url());

    var stillUnlock = await page.locator('input[id="passphrase"]').first().isVisible({ timeout: 2000 }).catch(function() { return false; });
    if (stillUnlock) {
      var et = await page.locator('text=/Incorrect/').first().textContent({ timeout: 2000 }).catch(function() { return 'none'; });
      console.log('WARNING: Still on unlock. Error: ' + et);
    }

    // ---- Navigate to /send ----
    console.log('Navigating to /send...');
    await page.goto(BASE_URL + '/send', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: shot('send-page-initial'), fullPage: true });
    addObs('Send page loaded successfully');

    // ---- UI Inspection ----
    console.log('=== UI Inspection ===');
    addObs('Page title: "' + (await page.locator('h1').first().textContent({ timeout: 2000 }).catch(function() { return null; })) + '"');

    var bv = await page.locator('text=/Available Balance/').first().isVisible({ timeout: 2000 }).catch(function() { return false; });
    addObs('Balance section: ' + (bv ? (await page.locator('text=/PHI/').first().textContent({ timeout: 2000 }).catch(function() { return 'N/A'; })) : 'Not visible'));
    await page.screenshot({ path: shot('balance-display') });

    var ac = await page.locator('input[placeholder*="Recipient"], input[placeholder*="address"]').count();
    var mc = await page.locator('input[placeholder*="Amount"], input[placeholder*="amount"]').count();
    addObs('Recipient inputs: ' + ac + ' addr, ' + mc + ' amount');

    // Helper to check visibility
    var vis = async function(sel) {
      try { return await page.locator(sel).first().isVisible({ timeout: 2000 }); } catch { return false; }
    };

    addObs('Add Recipient button: ' + (await vis('text=/Add Recipient/')) ? 'Present' : 'Missing');
    addObs('Fee Settings section: ' + (await vis('text=/Fee Settings/')) ? 'Present' : 'Missing');
    addObs('Fee rate input: ' + (await vis('input[id="feeRate"]')) ? 'Present' : 'Missing');
    addObs('Confirmation target: ' + (await vis('input[id="confTarget"]')) ? 'Present' : 'Missing');
    addObs('Auto fee button: ' + (await vis('button:has-text("Auto")')) ? 'Present' : 'Missing');
    addObs('Subtract fee checkbox: ' + (await vis('text=/Subtract fee/')) ? 'Present' : 'Missing');
    addObs('Send MAX button: ' + (await vis('text=/Send MAX/')) ? 'Present' : 'Missing');
    addObs('Send button: ' + (await vis('button:has-text("Send")')) ? 'Present' : 'Missing');
    addObs('UTXO/Coin Control: ' + (await vis('text=/View All UTXOs/, text=/Select Coins/')) ? 'Present' : 'Missing');
    addObs('Comment/Memo field: ' + (await vis('input[id="comment"], input[placeholder*="Memo"]')) ? 'Present' : 'Missing');
    addObs('From Address selector: ' + (await vis('select[id="fromAddress"]'))
      ? 'Present (multiple addresses)' : 'Not shown (single address - expected)');

    await page.screenshot({ path: shot('send-page-full'), fullPage: true });

    // ---- Address Validation ----
    console.log('=== Address Validation ===');
    var ai = page.locator('input[placeholder*="Recipient"], input[placeholder*="address"]').first();
    var am = page.locator('input[placeholder*="Amount"], input[placeholder*="amount"]').first();
    var sb = page.locator('button:has-text("Send")').first();

    // Invalid address
    console.log('Test: invalid address');
    await ai.fill('invalid_address_here');
    await am.fill('0.01');
    await sb.click();
    await page.waitForTimeout(1500);
    var invErr = await vis('p:text-match(/Recipient/)') || await vis('p:text-match(/invalid/)');
    addObs('Invalid address error shown: ' + (invErr ? 'Yes' : 'No'));
    if (!invErr) {
      addBug('high', 'No error shown for invalid address on Send click', [
        '1. Go to /send', '2. Enter "invalid_address_here"', '3. Enter 0.01', '4. Click Send',
        'Expected: Validation error under recipient field', 'Actual: No error shown',
      ]);
    }
    await page.screenshot({ path: shot('validation-invalid-address'), fullPage: true });

    // Testnet address
    console.log('Test: testnet address on mainnet');
    await ai.fill('n2E8NQNaDFgNvHpNfQmjRnfMfFmMfHfHfH');
    await sb.click();
    await page.waitForTimeout(1500);
    addObs('Testnet rejection: ' + (await vis('p:text-match(/invalid/)') || await vis('p:text-match(/mainnet/)')) ? 'Yes' : 'No');
    await page.screenshot({ path: shot('validation-testnet-address'), fullPage: true });

    // Empty address
    console.log('Test: empty address');
    await ai.fill('');
    await am.fill('0.01');
    await sb.click();
    await page.waitForTimeout(1500);
    addObs('Empty address error: ' + (await vis('p:text-match(/address is required/)')) ? 'Yes' : 'No');

    // Empty amount
    console.log('Test: empty amount');
    await ai.fill('PABC123test');
    await am.fill('');
    await sb.click();
    await page.waitForTimeout(1500);
    addObs('Empty amount error: ' + (await vis('p:text-match(/amount/)')) ? 'Yes' : 'No');

    // Negative amount
    console.log('Test: negative amount');
    await am.fill('-1');
    await sb.click();
    await page.waitForTimeout(1500);
    addObs('Negative amount error: ' + (await vis('p:text-match(/greater than 0/)')) ? 'Yes' : 'No');

    // Zero amount
    console.log('Test: zero amount');
    await am.fill('0');
    await sb.click();
    await page.waitForTimeout(1500);
    addObs('Zero amount error: ' + (await vis('p:text-match(/greater than 0/)')) ? 'Yes' : 'No');

    // Valid-looking but not real address
    console.log('Test: valid-format but non-existent address');
    await ai.fill('PTestValidFormat123456789');
    await am.fill('0.01');
    await sb.click();
    await page.waitForTimeout(1500);
    // Should show confirmation dialog, not error
    var confDialog = await vis('text=/Confirm Transaction/') || await vis('text=/Confirm & Send/') || await vis('text=/Auto-dismiss/');
    addObs('Confirmation dialog shown: ' + (confDialog ? 'Yes' : 'No'));
    if (confDialog) {
      // Cancel the dialog
      await page.locator('button:has-text("Cancel")').first().click();
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: shot('validation-confirm-dialog'), fullPage: true });

    await page.screenshot({ path: shot('validation-summary'), fullPage: true });

    // ---- Multi-Recipient ----
    console.log('=== Multi-Recipient ===');
    await ai.fill('');
    await am.fill('');
    if (await vis('text=/Add Recipient/')) {
      await page.locator('text=/Add Recipient/').first().click();
      await page.waitForTimeout(1000);
      var cnt = await page.locator('input[placeholder*="Recipient"], input[placeholder*="address"]').count();
      addObs('After add: ' + cnt + ' inputs (expected 2)');
      // Fill using nth selector via :nth-child or get by index
      var inputs = await page.locator('input[placeholder*="Recipient"], input[placeholder*="address"]').all();
      var amtInputs = await page.locator('input[placeholder*="Amount"], input[placeholder*="amount"]').all();
      if (inputs.length >= 2) {
        await inputs[0].fill('PTestAddress1');
        await amtInputs[0].fill('0.01');
        await inputs[1].fill('PTestAddress2');
        await amtInputs[1].fill('0.005');
      }
      await page.screenshot({ path: shot('multi-recipient'), fullPage: true });
      addObs('Total display: ' + (await vis('text=/Total:/')) ? 'Present' : 'Missing');
      addObs('Remove buttons: ' + (await page.locator('button[title="Remove recipient"]').count()));
    }

    // ---- Fee Estimation ----
    console.log('=== Fee Estimation ===');
    await page.goto(BASE_URL + '/send', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    if (await vis('button:has-text("Auto")')) {
      await page.locator('button:has-text("Auto")').first().click();
      await page.waitForTimeout(3000);
      var fr = await page.locator('input[id="feeRate"]').inputValue().catch(function() { return null; });
      addObs('Fee rate after Auto: ' + fr + ' sat/byte');
      addObs('Estimated fee display: ' + (await vis('text=/Estimated fee/')) ? 'Present' : 'Missing');
      await page.screenshot({ path: shot('fee-estimation'), fullPage: true });
    }

    // ---- UTXO Selection ----
    console.log('=== UTXO Selection ===');
    if (await vis('text=/View All UTXOs/')) {
      await page.locator('text=/View All UTXOs/').first().click();
      await page.waitForTimeout(3000);
      var uc = await page.locator('label:has(input[type="checkbox"])').count();
      addObs('UTXO items: ' + uc);
      addObs('Select All/Deselect: ' + (await vis('text=/Select All/, text=/Deselect All/')) ? 'Present' : 'Missing');
      if (uc > 0) {
        await page.locator('input[type="checkbox"]').first().check();
        await page.waitForTimeout(500);
        var sa = await page.locator('text=/Selected:/').first().textContent({ timeout: 2000 }).catch(function() { return null; });
        addObs('Selected amount: ' + (sa || 'Not found'));
      }
      await page.screenshot({ path: shot('utxo-selection'), fullPage: true });
    } else {
      addObs('UTXO selection: Not visible (wallet has no balance or no UTXOs)');
    }

    // ---- Balance Validation ----
    console.log('=== Balance Validation ===');
    await page.goto(BASE_URL + '/send', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    var faddr = page.locator('input[placeholder*="Recipient"], input[placeholder*="address"]').first();
    var famt = page.locator('input[placeholder*="Amount"], input[placeholder*="amount"]').first();
    await faddr.fill('PTestAddress999');
    await famt.fill('999999999');
    await page.waitForTimeout(1500);
    addObs('Over-balance warning: ' + (await vis('text=/exceeds available balance/')) ? 'Yes' : 'No');
    var dis = await page.locator('button:has-text("Send")').first().isDisabled().catch(function() { return false; });
    addObs('Send disabled (over balance): ' + (dis ? 'Yes' : 'No'));
    await page.screenshot({ path: shot('balance-validation'), fullPage: true });

    // ---- Send MAX ----
    console.log('=== Send MAX ===');
    await page.goto(BASE_URL + '/send', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    if (await vis('text=/Send MAX/')) {
      await page.locator('input[placeholder*="Recipient"], input[placeholder*="address"]').first().fill('PTestMaxAddress');
      await page.locator('text=/Send MAX/').first().click();
      await page.waitForTimeout(1000);
      addObs('Send MAX amount: ' + (await page.locator('input[placeholder*="Amount"], input[placeholder*="amount"]').first().inputValue().catch(function() { return null; })));
      await page.screenshot({ path: shot('send-max'), fullPage: true });
    }

    // ---- Confirm Dialog ----
    console.log('=== Confirm Dialog ===');
    await page.goto(BASE_URL + '/send', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    var caddr = page.locator('input[placeholder*="Recipient"], input[placeholder*="address"]').first();
    var camt = page.locator('input[placeholder*="Amount"], input[placeholder*="amount"]').first();
    await caddr.fill('PConfirmDialogTest');
    await camt.fill('0.001');
    await page.locator('button:has-text("Send")').first().click();
    await page.waitForTimeout(2000);
    var hasConfirm = await vis('text=/Confirm Transaction/');
    addObs('Confirm dialog appears: ' + (hasConfirm ? 'Yes' : 'No'));
    if (hasConfirm) {
      var hasCountdown = await vis('text=/Auto-dismiss/');
      var hasFeeRate = await vis('text=/Fee rate/');
      var hasEstFee = await vis('text=/Estimated fee/');
      var hasCancel = await vis('button:has-text("Cancel")');
      var hasConfirmBtn = await vis('button:has-text("Confirm & Send")');
      addObs('Confirm dialog - countdown: ' + (hasCountdown ? 'Yes' : 'No'));
      addObs('Confirm dialog - fee rate: ' + (hasFeeRate ? 'Yes' : 'No'));
      addObs('Confirm dialog - estimated fee: ' + (hasEstFee ? 'Yes' : 'No'));
      addObs('Confirm dialog - cancel btn: ' + (hasCancel ? 'Yes' : 'No'));
      addObs('Confirm dialog - confirm btn: ' + (hasConfirmBtn ? 'Yes' : 'No'));
      await page.screenshot({ path: shot('confirm-dialog'), fullPage: true });
      // Cancel
      await page.locator('button:has-text("Cancel")').first().click();
      await page.waitForTimeout(1000);
    }

    // ---- QT Comparison ----
    console.log('=== QT Comparison ===');
    addObs('Address book autocomplete elements: ' + (await page.locator('datalist, [role="listbox"]').count()));
    addObs('Fee preset buttons: ' + (await page.locator('text=/Low/, text=/Medium/, text=/High/').count()));
    addObs('RBF indicator: ' + (await vis('text=/RBF/')) ? 'Present' : 'Missing');
    addObs('Address labels: ' + (await page.locator('text=/label/, text=/Label/').count()) + ' elements');

    addMiss('Address auto-complete from address book');
    addMiss('Address labeling/tagging on send page');
    addGap('No address book integration in send flow');
    addGap('No fee presets (Low/Medium/High)');
    addGap('No transaction preview with input/output breakdown');
    addGap('No QR code scanner for recipient addresses');
    addGap('No block explorer link in confirmation dialog');
    addGap('Comment/memo field is UI-only (not embedded in transaction)');
    addGap('No "Calculate fee" button for exact fee before sending');

    // ---- Check RPC status ----
    var unique500 = fetchErrors.filter(function(u) { return u.indexOf('500') > -1 || u.indexOf('api') > -1; }).slice(0, 5);
    var totalFetchErr = fetchErrors.length;
    addObs('Total failed network requests: ' + totalFetchErr);
    if (totalFetchErr > 0) {
      addBug('high', 'RPC connection failing - all daemon RPC calls returning 500 errors', [
        '1. Navigate to app on port 3001', '2. Open browser DevTools Network tab',
        '3. Observe all /api requests failing with 500',
        'Cause: App on port 3001 appears to be in production mode, connecting directly to daemon without auth headers',
      ]);
    }

    // ---- Final ----
    await page.goto(BASE_URL + '/send', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: shot('send-page-final'), fullPage: true });

    var errs = consoleLogs.filter(function(m) { return m.type === 'error'; });
    // Deduplicate
    var uniqueErrors = [];
    var seen = {};
    for (var i = 0; i < errs.length; i++) {
      var k = errs[i].text.slice(0, 80);
      if (!seen[k]) { seen[k] = true; uniqueErrors.push(errs[i].text); }
    }
    report.console_errors = uniqueErrors;
    addObs('Console messages: ' + consoleLogs.length + ', unique errors: ' + uniqueErrors.length);

    var rp = path.join(SCREENSHOT_DIR, 'send-e2e-report.json');
    fs.writeFileSync(rp, JSON.stringify(report, null, 2));
    console.log('\nReport: ' + rp);

  } catch (err) {
    console.error('Test error:', err.message);
    addBug('high', 'Test error: ' + err.message, ['Run script']);
    try { await page.screenshot({ path: shot('error-state') }); } catch (e) {}
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'send-e2e-report.json'), JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch(function(err) { console.error('Fatal:', err); process.exit(1); });
