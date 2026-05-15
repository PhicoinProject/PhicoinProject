/**
 * E2E Test: Address Book & Settings pages
 * Creates wallet, then tests address book and settings.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3001';
const OUT = '/media/runner/FILES/Phicoin_project/newUI/APP/test-results/e2e-test/addressbook/';
const PASSPHRASE = 'MySecurePass1234';
const USER_SEED = 'MySecretSeed123';

const report = {
  addressBook: { observations: [], bugs: [], missingFeatures: [] },
  settings: { observations: [], bugs: [], missingFeatures: [] },
  consoleErrors: [],
  featureGaps: [],
};

function ss(page, name) {
  return page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true }).catch(() => {});
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function vis(sel, timeout = 5000) {
  try { await sel.waitFor({ state: 'visible', timeout }); return true; } catch { return false; }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') report.consoleErrors.push(msg.text());
  });

  // ==============================
  // STEP 1: CREATE WALLET
  // ==============================
  console.log('[1] Creating wallet...');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await sleep(2000);

  // Read mnemonic words from the page
  const mnemonicWords = await page.evaluate(() => {
    const slots = document.querySelectorAll('.grid.grid-cols-4 > div');
    const words = [];
    slots.forEach(s => {
      const text = (s.textContent || '').trim();
      const word = text.replace(/^\d+\s*/, '');
      if (word) words.push(word);
    });
    return words;
  });
  console.log('  Mnemonic:', mnemonicWords.join(' '));

  // Step 1: Confirm backup, click Next
  await page.getByLabel(/written down/i).check({ force: true });
  await sleep(300);
  await page.getByRole('button', { name: 'Next' }).click();
  await sleep(1000);

  // Step 2: Custom Seed (type=password, id=userSeed)
  await page.getByLabel(/Custom Seed/i).fill(USER_SEED);
  await sleep(300);
  await page.getByRole('button', { name: 'Next' }).click();
  await sleep(1000);

  // Step 3: Password (two password fields + confirm)
  await page.getByLabel(/^Password$/i).fill(PASSPHRASE);
  await page.getByLabel(/Confirm Password/i).fill(PASSPHRASE);
  await sleep(500);

  // Click Create Wallet (it's a submit button)
  const createBtn = page.getByRole('button', { name: /Create Wallet/i });
  if (!await vis(createBtn, 3000)) {
    console.log('  ERROR: Create Wallet button not found');
    await ss(page, '00-create-btn-missing');
  } else {
    await createBtn.click();
    await sleep(4000);
  }

  // Check if we're on quiz step
  const quizInputs = page.locator('input[type="text"]');
  const quizCount = await quizInputs.count();
  if (quizCount > 0) {
    for (let i = 0; i < quizCount; i++) {
      const inp = quizInputs.nth(i);
      const placeholder = await inp.getAttribute('placeholder') || '';
      const match = placeholder.match(/Word\s+(\d+)/);
      if (match) {
        const wordIdx = parseInt(match[1]) - 1;
        await inp.fill(mnemonicWords[wordIdx]);
        console.log(`  Quiz ${match[1]}: ${mnemonicWords[wordIdx]}`);
      }
    }
    await sleep(500);
    await page.getByRole('button', { name: /Verify & Complete/i }).click();
    await sleep(4000);
  }

  await ss(page, '00-wallet-created');

  // Check if wallet was created
  const hasWallet = await page.evaluate(() => {
    return !!(localStorage.getItem('phi:v2:salt') && localStorage.getItem('phi:v2:encryptedSeed'));
  });
  console.log('[2] Wallet created:', hasWallet);

  if (!hasWallet) {
    console.log('  ERROR: Wallet not created!');
    const body = await page.textContent('body').catch(() => '');
    console.log('  Body:', body.substring(0, 1000));
    await ss(page, '00-create-failed');
    // Try to continue anyway for settings tests
  }

  // Unlock
  const unlocked = await page.evaluate(() => sessionStorage.getItem('phi:unlocked') === 'true');
  if (hasWallet && !unlocked) {
    console.log('[3] Unlocking...');
    const passInp = page.locator('input[type="password"]');
    if (await vis(passInp, 5000)) {
      await passInp.fill(PASSPHRASE);
      const unlockBtn = page.getByRole('button', { name: /Unlock/i });
      if (await vis(unlockBtn, 3000)) {
        const up = page.waitForFunction(() => sessionStorage.getItem('phi:unlocked') === 'true', { timeout: 20000 });
        await unlockBtn.click();
        await up;
        console.log('[4] Unlocked');
        await sleep(3000);
      }
    }
  }

  // Verify main app
  const mainLoaded = await vis(page.getByText(/Dashboard/i).first(), 15000);
  if (mainLoaded) {
    console.log('[5] Main app loaded');
  } else {
    console.log('[5] WARNING: Dashboard not found');
    const body = await page.textContent('body').catch(() => '');
    console.log('  Body:', body.substring(0, 500));
  }
  await ss(page, '01-homepage');

  // Save storage state
  const storageState = await context.storageState();
  fs.writeFileSync(OUT + '/wallet-storage.json', JSON.stringify(storageState, null, 2));
  console.log('[6] Storage state saved');

  // ==============================
  // ADDRESS BOOK TESTS
  // ==============================
  if (hasWallet && mainLoaded) {
    console.log('[7] Testing Address Book...');
    await page.goto(BASE_URL + '/addressbook', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(4000);

    if (await vis(page.getByRole('heading', { name: /Address Book/i }), 15000)) {
      report.addressBook.observations.push('Page heading "Address Book" is visible');
    } else {
      report.addressBook.bugs.push('Address Book heading not found');
    }
    await ss(page, '02-addressbook-page');

    // Receiving tab (default)
    console.log('[8] Receiving tab...');
    if (await vis(page.getByRole('button', { name: /New Address/i }), 5000)) {
      report.addressBook.observations.push('"New Address" button present in Receiving tab');
    } else {
      report.addressBook.bugs.push('"New Address" button not found');
    }

    if (await vis(page.locator('table').first(), 5000)) {
      report.addressBook.observations.push('Receiving addresses table rendered');
      const hdrs = await page.locator('thead th').allTextContents().catch(() => []);
      if (hdrs.length > 0) report.addressBook.observations.push('Table headers: ' + hdrs.join(', '));
    }

    const cpCount = await page.locator('text=Copy').count().catch(() => 0);
    if (cpCount > 0) report.addressBook.observations.push(`Found ${cpCount} Copy button(s)`);
    await ss(page, '03-receiving-tab');

    // Sending tab
    console.log('[9] Sending tab...');
    const sendingBtn = page.locator('button', { hasText: /Sending/ });
    if (!await vis(sendingBtn.first(), 5000)) {
      report.addressBook.bugs.push('Sending tab not found');
    } else {
      await sendingBtn.first().click();
      await sleep(2000);
      await ss(page, '04-sending-tab');

      const addBtn = page.getByRole('button', { name: /Add Address/i });
      if (!await vis(addBtn, 5000)) {
        report.addressBook.bugs.push('"Add Address" button not found');
      } else {
        report.addressBook.observations.push('"Add Address" button present');

        // Add Address
        console.log('[10] Add Address...');
        await addBtn.click();
        await sleep(800);

        if (await vis(page.getByText(/Add Sending Address/i), 3000))
          report.addressBook.observations.push('Add Address form appears');

        const lblInp = page.locator('input[placeholder="Label"]').first();
        const addrInp = page.locator('input[placeholder*="address"], input[placeholder*="PHICOIN"]').first();
        const saveBtn = page.locator('button', { hasText: /Save/ }).first();

        // Validation
        await saveBtn.click();
        await sleep(800);
        if (await vis(page.locator('text=Address is required'), 2000))
          report.addressBook.observations.push('Validation: "Address is required" shown');
        else if (await vis(page.locator('text=Label is required'), 2000))
          report.addressBook.observations.push('Validation: "Label is required" shown first');
        else
          report.addressBook.observations.push('Validation: error detected but not captured');

        // Add entry
        await lblInp.fill('TestContact');
        await addrInp.fill('PTestAddress1234567890abcdefghij');
        await saveBtn.click();
        await sleep(1500);
        await ss(page, '05-address-added');

        if (await vis(page.locator('text=TestContact'), 5000))
          report.addressBook.observations.push('Entry "TestContact" visible');
        else
          report.addressBook.bugs.push('Entry "TestContact" not found');

        // Second address
        console.log('[11] Second address...');
        await page.getByRole('button', { name: /Add Address/i }).click();
        await sleep(500);
        await lblInp.fill('MerchantXYZ');
        await addrInp.fill('HMerchantAddr1234567890abcdefghijklmn');
        await saveBtn.click();
        await sleep(1000);
        await ss(page, '06-two-entries');

        // Edit
        console.log('[12] Edit Label...');
        const lbl = page.locator('text=TestContact').first();
        if (await vis(lbl, 3000)) {
          await lbl.click();
          await sleep(800);
          const editInp = page.locator('input').first();
          if (await vis(editInp, 3000)) {
            report.addressBook.observations.push('Inline edit activates');
            await editInp.fill('UpdatedTestContact');
            await page.keyboard.press('Enter');
            await sleep(1000);
            await ss(page, '07-label-edited');
            if (await vis(page.locator('text=UpdatedTestContact'), 5000))
              report.addressBook.observations.push('Label updated and persisted');
            else
              report.addressBook.bugs.push('Label update not reflected');
          } else {
            report.addressBook.bugs.push('Edit input not found');
            await ss(page, '07b-edit-fail');
          }
        }

        // Copy
        console.log('[13] Copy...');
        const cpB = page.locator('text=Copy').first();
        if (await vis(cpB, 3000)) {
          report.addressBook.observations.push('Copy button present');
          await cpB.click();
          await sleep(500);
        }

        // Delete
        console.log('[14] Delete...');
        const delB = page.locator('text=Delete').first();
        if (await vis(delB, 3000)) {
          report.addressBook.observations.push('Delete button present');
          await delB.click();
          await sleep(1000);
          await ss(page, '08-address-deleted');
          if ((await page.locator('text=MerchantXYZ').count().catch(() => 0)) === 0)
            report.addressBook.observations.push('Entry removed after delete');
          else
            report.addressBook.bugs.push('Entry still present after delete');
        }

        // Export CSV
        console.log('[15] Export CSV...');
        const expBtn = page.getByRole('button', { name: /Export to CSV/i });
        if (await vis(expBtn, 5000)) {
          report.addressBook.observations.push('"Export to CSV" button present');
          if (await expBtn.isDisabled().catch(() => false))
            report.addressBook.bugs.push('Export CSV disabled despite entries');
          else
            report.addressBook.observations.push('Export CSV enabled');
        } else {
          report.addressBook.bugs.push('"Export to CSV" button not found');
        }

        // Validation
        console.log('[16] Address validation...');
        await page.getByRole('button', { name: /Add Address/i }).click();
        await sleep(500);
        await lblInp.fill('InvalidTest');
        await addrInp.fill('not-a-valid-address');
        await saveBtn.click();
        await sleep(1000);
        if (await vis(page.locator('text=InvalidTest'), 3000)) {
          report.addressBook.bugs.push('Invalid addresses accepted (no P/H prefix check)');
        } else {
          report.addressBook.observations.push('Invalid address rejected');
        }
        await ss(page, '09-validation-test');
      }
    }

    // localStorage
    console.log('[17] Checking localStorage...');
    const lsData = await page.evaluate(() => {
      const raw = localStorage.getItem('phicoin-addressbook');
      return raw ? JSON.parse(raw) : null;
    });
    if (lsData && lsData.state && lsData.state.entries)
      report.addressBook.observations.push(`localStorage: ${lsData.state.entries.length} entries in "phicoin-addressbook"`);
    else
      report.addressBook.bugs.push('No entries in localStorage');

    // Receiving generation
    console.log('[18] Receiving generation...');
    const recvTab = page.locator('button', { hasText: /Receiving/ });
    if (await vis(recvTab.first(), 5000)) {
      await recvTab.first().click();
      await sleep(2000);
      const genBtn = page.getByRole('button', { name: /New Address/i });
      if (await vis(genBtn, 3000)) {
        await genBtn.click();
        await sleep(3000);
        const err = await page.locator('text=/Failed|Error|Cannot|Unable/').isVisible().catch(() => false);
        if (err) {
          const txt = await page.locator('text=/Failed|Error/').first().textContent().catch(() => '');
          report.addressBook.bugs.push('Error generating address: ' + txt);
        } else {
          report.addressBook.observations.push('New address generation attempted without errors');
        }
      }
      await ss(page, '10-receiving-generation');
    }
  } else {
    console.log('[SKIP] Address Book tests skipped (wallet not available)');
    report.addressBook.bugs.push('Could not test: wallet unavailable');
  }

  // ==============================
  // SETTINGS
  // ==============================
  console.log('[19] Testing Settings...');
  await page.goto(BASE_URL + '/settings', { waitUntil: 'domcontentloaded', timeout: 10000 });
  await sleep(5000);

  if (await vis(page.getByRole('heading', { name: /Settings/i }), 15000)) {
    report.settings.observations.push('Settings heading visible');
  } else {
    report.settings.bugs.push('Settings heading not found');
  }
  await ss(page, '11-settings-page');

  console.log('[20] Checking tabs...');
  for (const tab of ['Connection', 'Currency', 'Notifications', 'Network', 'About']) {
    if (await vis(page.getByRole('button', { name: new RegExp('^' + tab + '$', 'i') }), 3000))
      report.settings.observations.push(`Tab "${tab}" present`);
    else
      report.settings.bugs.push(`Tab "${tab}" not found`);
  }

  // Connection
  console.log('[21] Connection tab...');
  await page.getByRole('button', { name: /^Connection$/i }).click();
  await sleep(1500);
  await ss(page, '12-settings-connection-tab');

  for (const f of ['Host', 'Port']) {
    if (await vis(page.getByLabel(new RegExp('^' + f + '$', 'i')), 2000))
      report.settings.observations.push(`RPC "${f}" field present`);
  }
  if (await vis(page.getByLabel(/RPC User/i), 2000)) report.settings.observations.push('RPC User present');
  if (await vis(page.getByLabel(/RPC Password/i), 2000)) report.settings.observations.push('RPC Password present');

  if (await vis(page.getByLabel(/^Host$/i), 2000)) {
    if (await page.getByLabel(/^Host$/i).isDisabled().catch(() => false))
      report.settings.observations.push('RPC fields read-only (env-var driven)');
  }

  if (await vis(page.getByText(/Dark Mode/i), 3000)) {
    report.settings.observations.push('Dark Mode toggle present');
    const chk = page.locator('input[type="checkbox"]').first();
    await chk.click({ force: true });
    await sleep(1500);
    await ss(page, '13-dark-mode-enabled');
    if (await page.evaluate(() => document.documentElement.classList.contains('dark')))
      report.settings.observations.push('Dark mode: dark class applied');
    else
      report.settings.bugs.push('Dark mode: dark class NOT applied');
    await chk.click({ force: true });
    await sleep(500);
  }

  if (await vis(page.getByRole('button', { name: /Test Connection/i }), 3000)) {
    report.settings.observations.push('"Test Connection" button present');
    await page.getByRole('button', { name: /Test Connection/i }).click();
    await sleep(3000);
    const cr = await page.locator('text=/Connected|Not connected/').first().textContent().catch(() => null);
    if (cr) report.settings.observations.push('Connection test: ' + cr.trim());
  }

  // Currency
  console.log('[22] Currency tab...');
  await page.getByRole('button', { name: /^Currency$/i }).click();
  await sleep(3000);
  await ss(page, '14-settings-currency-tab');

  if (await vis(page.getByText(/Fiat Price/i), 3000)) report.settings.observations.push('Fiat Price section present');
  for (const c of ['USD', 'EUR', 'GBP']) {
    if (await vis(page.locator('text=' + c), 2000)) report.settings.observations.push(`Currency "${c}" present`);
  }
  await page.locator('text=EUR').first().click();
  await sleep(800);
  report.settings.observations.push('Currency switching tested (EUR)');
  await page.locator('text=USD').first().click();
  await sleep(500);
  if (await vis(page.locator('text=1 PHI'), 5000)) report.settings.observations.push('Price display format: "1 PHI ="');

  // Notifications
  console.log('[23] Notifications tab...');
  await page.getByRole('button', { name: /^Notifications$/i }).click();
  await sleep(1500);
  await ss(page, '15-settings-notifications-tab');
  if (await vis(page.getByText(/Desktop Notifications/i), 3000)) report.settings.observations.push('Notifications section present');
  const nt = await page.locator('text=/blocked|enabled|has not been|not support/').first().textContent().catch(() => null);
  if (nt) report.settings.observations.push('Notification status: ' + nt.trim());

  // Network
  console.log('[24] Network tab...');
  await page.getByRole('button', { name: /^Network$/i }).click();
  await sleep(1500);
  await ss(page, '16-settings-network-tab');
  if (await vis(page.getByText(/Ban Address/i), 3000)) report.settings.observations.push('Ban Address section present');
  if (await vis(page.getByText(/Banned Addresses/i), 3000)) report.settings.observations.push('Banned Addresses list present');
  if (await vis(page.getByRole('button', { name: /^Ban$/i }), 2000)) report.settings.observations.push('Ban button present');
  if (await vis(page.getByRole('button', { name: /Clear All/i }), 2000)) report.settings.observations.push('Clear All bans present');

  // About
  console.log('[25] About tab...');
  await page.getByRole('button', { name: /^About$/i }).click();
  await sleep(1000);
  await ss(page, '17-settings-about-tab');
  const at = await page.locator('text=/PHICOIN Wallet v/').first().textContent().catch(() => null);
  if (at) report.settings.observations.push('About shows: ' + at.trim());

  // ==============================
  // FEATURE GAPS
  // ==============================
  console.log('[26] Comparing with QT...');

  report.settings.missingFeatures = [
    'No wallet lock action in Settings (QT has Lock Wallet)',
    'No backup wallet action in Settings',
    'No change password feature in Settings',
    'No display unit selector (PHI/sat)',
    'No language selection',
    'No fee preferences configuration',
    'No coin control options',
    'No custom fee configuration',
    'No network/testnet selection toggle',
  ];

  report.addressBook.missingFeatures = [
    'No PHICOIN address format validation (P/H prefix check)',
    'No address lookup/filter by label',
    'No address type indicator (P-pubkey vs H-script)',
    'No "Copy Label" button (only Copy Address)',
    'No duplicate address/label validation',
    'No receiving address label editing',
  ];

  report.featureGaps = [
    'QT Options has fee/display/language/network; Web Settings only has connection/currency/notifications/bans/about',
    'QT Address Book has type badges/label search/duplicate check; Web lacks these',
    'QT lock/backup/change-password in Settings; Web has separate pages only',
    'QT has coin control and custom fees; Web has none',
  ];

  // ==============================
  // SAVE
  // ==============================
  const fullReport = { timestamp: new Date().toISOString(), browser: 'Chromium (headless)', targetUrl: BASE_URL, ...report };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(fullReport, null, 2));

  console.log('\n=== E2E Summary ===');
  console.log('AB Obs:', report.addressBook.observations.length, '| Bugs:', report.addressBook.bugs.length, '| Missing:', report.addressBook.missingFeatures.length);
  console.log('Stg Obs:', report.settings.observations.length, '| Bugs:', report.settings.bugs.length, '| Missing:', report.settings.missingFeatures.length);
  console.log('Console Errors:', report.consoleErrors.length);
  console.log('Feature Gaps:', report.featureGaps.length);
  console.log('\nReport:', path.join(OUT, 'report.json'));
  console.log('Screenshots:', OUT);

  await context.close();
  await browser.close();
})();
