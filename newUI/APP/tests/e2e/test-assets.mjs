import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3001';
const OUTPUT_DIR = '/media/runner/FILES/Phicoin_project/newUI/APP/test-results/e2e-test/assets';
const PASSWORD = 'MySecurePass1234';

const report = {
  ui: {},
  bugs: [],
  missingFeatures: [],
  consoleErrors: [],
  pageErrors: [],
  featureGaps: [],
};

function ensureDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function sleep(ms) { await new Promise(r => setTimeout(r, ms)); }

async function gotoAndUnlock(page, route) {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 15000 });

  // Check if auto-unlock succeeded
  const isUnlockPage = await page.locator('text=Enter your passphrase to unlock').isVisible().catch(() => false);
  if (isUnlockPage) {
    // Auto-unlock didn't work - manually unlock
    await page.locator('#passphrase').fill(PASSWORD);
    await page.locator('button').filter({ hasText: /Unlock Wallet/ }).first().click();
    await page.waitForSelector('text=Enter your passphrase to unlock', { state: 'hidden', timeout: 10000 }).catch(() => {});
    await sleep(2000);
  } else {
    await sleep(1500);
  }
}

(async () => {
  ensureDir();

  const tmpDir = '/tmp/phicoin-e2e-context';
  const { execSync } = await import('child_process');
  try { execSync('rm -rf ' + tmpDir); } catch {}

  const context = await chromium.launchPersistentContext(tmpDir, {
    headless: true,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  let mnemonicWords = [];

  try {
    // ======== STEP 0: Create wallet ========
    console.log('[0] Creating wallet...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(2000);

    // Clear existing wallet if needed
    const hasWallet = await page.evaluate(() => localStorage.getItem('phi:v2:encryptedSeed'));
    if (hasWallet) {
      await page.evaluate(() => {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && key.startsWith('phi:')) localStorage.removeItem(key);
        }
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const key = sessionStorage.key(i);
          if (key && key.startsWith('phi:')) sessionStorage.removeItem(key);
        }
      });
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
      await sleep(2000);
    }

    mnemonicWords = await page.locator('.grid.grid-cols-4 > div > span.text-sm').allTextContents().catch(() => []);
    console.log(`[0] Mnemonic words: ${mnemonicWords.length}`);

    await page.locator('input[type="checkbox"]').first().check({ force: true });
    await sleep(500);
    await page.getByRole('button', { name: 'Next' }).click();
    await sleep(1000);

    await page.locator('#userSeed').fill('E2ETestSeed123');
    await sleep(500);
    await page.getByRole('button', { name: 'Next' }).click();
    await sleep(1000);

    await page.locator('#password').fill(PASSWORD);
    await page.locator('#confirmPassword').fill(PASSWORD);
    await sleep(1000);

    await page.locator('button').filter({ hasText: /Create Wallet/ }).first().click();
    await sleep(3000);

    const isQuizPage = await page.locator('text=Verify Recovery Phrase').isVisible().catch(() => false);
    if (isQuizPage) {
      console.log('[0] Filling verification quiz...');
      const inputs = await page.locator('input[type="text"]').all();
      const badges = await page.locator('span.w-8').allTextContents();
      for (let i = 0; i < inputs.length; i++) {
        const idx = parseInt(badges[i]) - 1;
        await inputs[i].fill(mnemonicWords[idx]?.trim() || '');
      }
      await sleep(500);
      await page.locator('button').filter({ hasText: /Verify & Complete/ }).click();
      await sleep(2000);
    }

    console.log('[0] Wallet created');
    await page.screenshot({ path: path.join(OUTPUT_DIR, '00-wallet-created.png'), fullPage: true });

    // ======== STEP 1: Dashboard ========
    await gotoAndUnlock(page, '/');
    await sleep(2000);

    await page.screenshot({ path: path.join(OUTPUT_DIR, '01-dashboard.png'), fullPage: true });
    console.log('[1] Dashboard screenshot saved');

    await context.storageState({ path: '/tmp/phicoin-e2e-storage.json' });

    // ======== STEP 2: /assets ========
    console.log('[2] Navigating to /assets...');
    await gotoAndUnlock(page, '/assets');
    await sleep(2000);

    const assetsContent = await page.content();
    await page.screenshot({ path: path.join(OUTPUT_DIR, '02-assets-page.png'), fullPage: true });

    report.ui.assets = {
      hasSearchInput: await page.locator('input[placeholder*="Search"]').first().isVisible().catch(() => false),
      hasTitle: await page.locator('h1').filter({ hasText: /Assets/ }).first().isVisible().catch(() => false),
      hasNewAssetButton: await page.locator('button').filter({ hasText: /New Asset/ }).first().isVisible().catch(() => false),
      hasNoAssetsMessage: await page.locator('text=No assets found').first().isVisible().catch(() => false),
      url: page.url(),
    };

    // ======== STEP 3: /create-asset ========
    console.log('[3] Navigating to /create-asset...');
    await gotoAndUnlock(page, '/create-asset');
    await sleep(2000);

    await page.screenshot({ path: path.join(OUTPUT_DIR, '03-create-asset-page.png'), fullPage: true });

    const createContent = await page.content();
    const assetTypes = ['ROOT', 'SUB', 'UNIQUE', 'QUALIFIER', 'RESTRICTED'];
    const presentTypes = [];
    for (const t of assetTypes) {
      const found = await page.locator(`text=${t}`).first().isVisible().catch(() => false);
      if (found) presentTypes.push(t);
    }

    report.ui.createAsset = {
      titleVisible: await page.locator('h1').filter({ hasText: /Create Asset/ }).first().isVisible().catch(() => false),
      newAssetButton: await page.locator('button').filter({ hasText: /New Asset/ }).first().isVisible().catch(() => false),
      assetTypes: presentTypes,
      url: page.url(),
    };

    // Open modal
    console.log('[3a] Opening create asset modal...');
    const newAssetBtn = page.locator('button').filter({ hasText: /New Asset/ }).first();
    if (await newAssetBtn.isVisible().catch(() => false)) {
      await newAssetBtn.click();
      await sleep(2000);

      await page.screenshot({ path: path.join(OUTPUT_DIR, '04-create-asset-modal.png'), fullPage: true });

      report.ui.createAssetModal = {
        labelInput: await page.locator('#create-asset-label').isVisible().catch(() => false),
        quantityInput: await page.locator('#create-asset-quantity').isVisible().catch(() => false),
        decimalsInput: await page.locator('#create-asset-decimals').isVisible().catch(() => false),
        verifierStringInput: await page.locator('#create-asset-verifier').isVisible().catch(() => false),
        ipfsInput: await page.locator('#create-asset-ipfs').isVisible().catch(() => false),
        reissuableCheckbox: await page.locator('text=Reissuable').isVisible().catch(() => false),
        ipfsCheckbox: await page.locator('text=Attach IPFS Hash').isVisible().catch(() => false),
      };

      // --- Validation: empty label ---
      console.log('[3b] Testing validation (empty label)...');
      const issueBtn = page.locator('button').filter({ hasText: /Issue/ }).first();
      if (await issueBtn.isVisible().catch(() => false)) {
        await issueBtn.click();
        await sleep(1000);
        report.ui.validation = {
          emptyLabelError: await page.locator('text=Asset label is required').isVisible().catch(() => false),
        };
        await page.screenshot({ path: path.join(OUTPUT_DIR, '05-create-asset-validation-empty.png'), fullPage: true });
      }

      // --- Validation: long label ---
      console.log('[3c] Testing validation (long label)...');
      const labelInput = page.locator('#create-asset-label');
      if (await labelInput.isVisible().catch(() => false)) {
        await labelInput.fill('A'.repeat(35));
        await sleep(500);
        if (await issueBtn.isVisible().catch(() => false)) {
          await issueBtn.click();
          await sleep(1000);
          report.ui.validation.longLabelError = await page.locator('text=Asset label must be 31 characters').isVisible().catch(() => false);
        }
        await labelInput.fill('');
      }

      // --- Validation: invalid quantity ---
      console.log('[3d] Testing validation (invalid quantity)...');
      const qtyInput = page.locator('#create-asset-quantity');
      if (await labelInput.isVisible().catch(() => false)) {
        await labelInput.fill('TESTTOKEN');
        if (await qtyInput.isVisible().catch(() => false)) {
          await qtyInput.fill('-5');
          await sleep(500);
          if (await issueBtn.isVisible().catch(() => false)) {
            await issueBtn.click();
            await sleep(1000);
            report.ui.validation.invalidQtyError = await page.locator('text=Quantity must be a non-negative').isVisible().catch(() => false);
          }
        }
      }

      // --- Validation: invalid decimals ---
      console.log('[3e] Testing validation (invalid decimals)...');
      const decimalsInput = page.locator('#create-asset-decimals');
      if (await decimalsInput.isVisible().catch(() => false)) {
        await decimalsInput.fill('15');
        await sleep(500);
        if (await issueBtn.isVisible().catch(() => false)) {
          await issueBtn.click();
          await sleep(1000);
          report.ui.validation.invalidDecimalsError = await page.locator('text=Decimal places must be between').isVisible().catch(() => false);
        }
      }

      // Reset fields
      if (await labelInput.isVisible().catch(() => false)) await labelInput.fill('');
      if (await qtyInput.isVisible().catch(() => false)) await qtyInput.fill('0');
      if (await decimalsInput.isVisible().catch(() => false)) await decimalsInput.fill('8');

      // --- Type switching ---
      // Click the type selector buttons INSIDE the modal (grid-cols-5), not the page background
      console.log('[3f] Testing asset type switching...');
      const typeSwitches = {};
      const modalGrid = page.locator('.grid.grid-cols-5');

      if (await modalGrid.isVisible().catch(() => false)) {
        // Switch to RESTRICTED
        const restrictedBtn = modalGrid.locator('button').filter({ hasText: /RESTRICTED/ }).first();
        if (await restrictedBtn.isVisible().catch(() => false)) {
          await restrictedBtn.click({ force: true });
          await sleep(500);
          typeSwitches.restrictedVerifierVisible = await page.locator('#create-asset-verifier').isVisible().catch(() => false);
          await page.screenshot({ path: path.join(OUTPUT_DIR, '04b-create-asset-restricted.png'), fullPage: true });
        }

        // Switch to UNIQUE
        const uniqueBtn = modalGrid.locator('button').filter({ hasText: /UNIQUE/ }).first();
        if (await uniqueBtn.isVisible().catch(() => false)) {
          await uniqueBtn.click({ force: true });
          await sleep(500);
          typeSwitches.uniqueQtyHidden = !(await page.locator('#create-asset-quantity').isVisible().catch(() => false));
          await page.screenshot({ path: path.join(OUTPUT_DIR, '04c-create-asset-unique.png'), fullPage: true });
        }

        // Switch back to ROOT
        const rootBtn = modalGrid.locator('button').filter({ hasText: /ROOT/ }).first();
        if (await rootBtn.isVisible().catch(() => false)) {
          await rootBtn.click({ force: true });
          await sleep(500);
        }
      }

      report.ui.assetTypeSwitching = typeSwitches;

      // --- Try valid issue ---
      console.log('[3g] Attempting valid asset issue...');
      if (await labelInput.isVisible().catch(() => false)) await labelInput.fill('E2ETEST');
      if (await qtyInput.isVisible().catch(() => false)) await qtyInput.fill('1000');

      const finalIssueBtn = page.locator('button').filter({ hasText: /Issue ROOT Asset/ }).first();
      if (await finalIssueBtn.isVisible().catch(() => false)) {
        await finalIssueBtn.click();
        await sleep(8000);

        let errorText = null;
        const failMsg = await page.locator('[class*="red"]').first().isVisible().catch(() => false);
        if (failMsg) errorText = await page.locator('[class*="red"]').first().textContent().catch(() => null);

        report.ui.issueAttempt = {
          success: await page.locator('text=Asset Created Successfully').isVisible().catch(() => false),
          error: failMsg,
          errorText,
        };
        await page.screenshot({ path: path.join(OUTPUT_DIR, '06-create-asset-issue-attempt.png'), fullPage: true });
      }

      // Close modal
      const closeBtn = page.locator('button').filter({ hasText: /Cancel|Done/ }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
        await sleep(500);
      }
    } else {
      report.bugs.push({ description: 'Could not find New Asset button on /create-asset page' });
    }

    // ======== STEP 4: /manage-assets ========
    console.log('[4] Navigating to /manage-assets...');
    await gotoAndUnlock(page, '/manage-assets');
    await sleep(2000);

    await page.screenshot({ path: path.join(OUTPUT_DIR, '07-manage-assets-page.png'), fullPage: true });

    const [myIssuedTab, adminTab] = await Promise.all([
      page.locator('button').filter({ hasText: /My Issued Assets/ }).isVisible().catch(() => false),
      page.locator('button').filter({ hasText: /^Admin$/ }).isVisible().catch(() => false),
    ]);

    report.ui.manageAssets = {
      titleVisible: await page.locator('h1').filter({ hasText: /Manage Assets/ }).first().isVisible().catch(() => false),
      myIssuedTab,
      adminTab,
      url: page.url(),
    };

    if (adminTab) {
      await page.locator('button').filter({ hasText: /^Admin$/ }).click();
      await sleep(1500);
      await page.screenshot({ path: path.join(OUTPUT_DIR, '08-manage-assets-admin.png'), fullPage: true });

      const adminButtons = {
        assignQualifier: await page.locator('button').filter({ hasText: /Assign Qualifier/ }).isVisible().catch(() => false),
        removeQualifier: await page.locator('button').filter({ hasText: /Remove Qualifier/ }).isVisible().catch(() => false),
        freezeAddress: await page.locator('button').filter({ hasText: /Freeze Address/ }).isVisible().catch(() => false),
        unfreezeAddress: await page.locator('button').filter({ hasText: /Unfreeze Address/ }).isVisible().catch(() => false),
        globalFreeze: await page.locator('button').filter({ hasText: /Global Freeze/ }).isVisible().catch(() => false),
        globalUnfreeze: await page.locator('button').filter({ hasText: /Global Unfreeze/ }).isVisible().catch(() => false),
        setVerifier: await page.locator('button').filter({ hasText: /Set Verifier String/ }).isVisible().catch(() => false),
      };
      report.ui.adminOperations = adminButtons;

      // Assign Qualifier modal
      console.log('[4a] Testing Assign Qualifier modal...');
      if (adminButtons.assignQualifier) {
        await page.locator('button').filter({ hasText: /Assign Qualifier/ }).click();
        await sleep(1000);
        await page.screenshot({ path: path.join(OUTPUT_DIR, '09-manage-assign-qualifier-modal.png'), fullPage: true });

        report.ui.qualifierModal = {
          qualifierAsset: await page.locator('#admin-qualifier').isVisible().catch(() => false),
          targetAddress: await page.locator('#admin-target').isVisible().catch(() => false),
          confirmBtn: await page.locator('button').filter({ hasText: /Confirm/ }).isVisible().catch(() => false),
        };

        const confirmBtn = page.locator('button').filter({ hasText: /Confirm/ }).first();
        if (await confirmBtn.isVisible().catch(() => false)) {
          await confirmBtn.click();
          await sleep(1000);
          const modalError = await page.locator('[class*="red"]').first().isVisible().catch(() => false);
          let modalErrorText = null;
          if (modalError) modalErrorText = await page.locator('[class*="red"]').first().textContent().catch(() => null);
          report.ui.qualifierValidation = { errorDisplayed: modalError, errorText: modalErrorText };
          await page.screenshot({ path: path.join(OUTPUT_DIR, '10-manage-qualifier-validation.png'), fullPage: true });
        }

        const closeModal = page.locator('button').filter({ hasText: /Cancel/ }).first();
        if (await closeModal.isVisible().catch(() => false)) await closeModal.click();
        await sleep(500);
      }

      // Global Freeze modal
      console.log('[4b] Testing Global Freeze modal...');
      if (adminButtons.globalFreeze) {
        await page.locator('button').filter({ hasText: /Global Freeze/ }).click();
        await sleep(1000);
        await page.screenshot({ path: path.join(OUTPUT_DIR, '11-manage-global-freeze-modal.png'), fullPage: true });

        report.ui.globalFreezeModal = {
          assetName: await page.locator('#admin-asset-global').isVisible().catch(() => false),
          warningText: await page.locator('text=freeze all transfers').isVisible().catch(() => false),
        };

        const closeGf = page.locator('button').filter({ hasText: /Cancel/ }).first();
        if (await closeGf.isVisible().catch(() => false)) await closeGf.click();
        await sleep(500);
      }

      // Set Verifier String modal
      console.log('[4c] Testing Set Verifier String modal...');
      if (adminButtons.setVerifier) {
        await page.locator('button').filter({ hasText: /Set Verifier String/ }).click();
        await sleep(1000);
        await page.screenshot({ path: path.join(OUTPUT_DIR, '11b-manage-verifier-modal.png'), fullPage: true });

        report.ui.verifierModal = {
          assetName: await page.locator('#admin-asset-verifier').isVisible().catch(() => false),
          verifierString: await page.locator('#admin-verifier').isVisible().catch(() => false),
        };

        const closeV = page.locator('button').filter({ hasText: /Cancel/ }).first();
        if (await closeV.isVisible().catch(() => false)) await closeV.click();
        await sleep(500);
      }
    }

    // ======== STEP 5: /restricted ========
    console.log('[5] Navigating to /restricted...');
    await gotoAndUnlock(page, '/restricted');
    await sleep(2000);

    await page.screenshot({ path: path.join(OUTPUT_DIR, '12-restricted-page.png'), fullPage: true });

    report.ui.restricted = {
      titleVisible: await page.locator('h1').filter({ hasText: /Restricted Assets/ }).first().isVisible().catch(() => false),
      url: page.url(),
    };

    const restrictedTabs = {
      myRestricted: await page.locator('button').filter({ hasText: /My Restricted/ }).isVisible().catch(() => false),
      qualifiers: await page.locator('button').filter({ hasText: /Qualifiers/ }).isVisible().catch(() => false),
      tags: await page.locator('button').filter({ hasText: /Tags/ }).isVisible().catch(() => false),
      restrictions: await page.locator('button').filter({ hasText: /Restrictions/ }).isVisible().catch(() => false),
    };
    report.ui.restrictedTabs = restrictedTabs;

    const tabClicks = [
      { name: 'My-Restricted', text: /My Restricted/i },
      { name: 'Qualifiers', text: /Qualifiers/i },
      { name: 'Tags', text: /Tags/i },
      { name: 'Restrictions', text: /Restrictions/i },
    ];
    for (const tab of tabClicks) {
      const isVisible = await page.locator('button').filter({ hasText: tab.text }).isVisible().catch(() => false);
      if (isVisible) {
        await page.locator('button').filter({ hasText: tab.text }).click();
        await sleep(1000);
        await page.screenshot({ path: path.join(OUTPUT_DIR, `13-restricted-${tab.name}.png`), fullPage: true });
      }
    }

    // ======== FINAL ANALYSIS ========
    report.consoleErrors = consoleErrors.filter(e => !e.includes('Failed to load') && !e.includes('favicon'));
    report.pageErrors = pageErrors;

    // Feature comparison
    if (!createContent.includes('parent') && !createContent.includes('Parent')) {
      report.missingFeatures.push('SUB asset parent selection: UI mentions CLI-only, no parent asset picker in the form');
    }
    if (!assetsContent.includes('qr') && !assetsContent.includes('QR')) {
      report.missingFeatures.push('No QR code generation for asset receive addresses');
    }
    if (!assetsContent.includes('address book') && !assetsContent.includes('Address Book')) {
      report.missingFeatures.push('No address book integration in asset send flow');
    }
    if (!assetsContent.includes('fee') && !assetsContent.includes('Fee')) {
      report.missingFeatures.push('No fee estimation display for asset operations');
    }
    report.missingFeatures.push('No "Max" button for quantity fields in send/reissue forms');
    report.missingFeatures.push('No asset transaction history view per asset');
    report.missingFeatures.push('No asset type filtering on /assets page');
    report.missingFeatures.push('No bulk operations for assets');
    report.missingFeatures.push('RESTRICTED asset verifier string field in form may not be passed to issueAsset RPC call');

    const reportPath = path.join(OUTPUT_DIR, 'e2e-assets-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`\n[6] Report saved to ${reportPath}`);
    console.log('\n=== E2E ASSET PROTOCOL TEST COMPLETE ===');
    console.log(`Screenshots: ${OUTPUT_DIR}/`);
    console.log(`Console errors: ${consoleErrors.length}`);
    console.log(`Page errors: ${pageErrors.length}`);

  } catch (err) {
    console.error('[ERROR]', err.message);
    console.error(err.stack);
    report.bugs.push({ description: 'Test execution error', error: err.message });
    const reportPath = path.join(OUTPUT_DIR, 'e2e-assets-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  } finally {
    await context.close();
  }
})();
