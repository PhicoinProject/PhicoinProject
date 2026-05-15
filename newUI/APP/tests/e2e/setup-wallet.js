/**
 * Setup: Create wallet in localStorage, then save state.
 * Run with: node tests/e2e/setup-wallet.js
 */

import { chromium } from 'playwright';
import fs from 'fs';

const BASE_URL = 'http://localhost:3001';
const BROWSER_DATA = '/media/runner/FILES/Phicoin_project/newUI/APP/test-results/wallet/browser-data';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function removeRecursive(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = `${dir}/${entry.name}`;
    if (entry.isDirectory()) removeRecursive(fullPath);
    else fs.unlinkSync(fullPath);
  }
  fs.rmdirSync(dir);
}

async function main() {
  // Clear old data
  if (fs.existsSync(BROWSER_DATA)) {
    removeRecursive(BROWSER_DATA);
  }

  console.log('Launching browser...');
  const context = await chromium.launchPersistentContext(BROWSER_DATA, {
    headless: true,
    viewport: { width: 1280, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
  await sleep(2000);

  // Create wallet via the app's modules
  console.log('Creating wallet via eval...');
  const result = await page.evaluate(async () => {
    try {
      const { createWalletV2 } = await import('/src/services/auth.ts');
      const { generateMnemonicWords } = await import('/src/services/HDWallet.ts');
      const mnemonic = generateMnemonicWords();
      await createWalletV2(mnemonic, 'customseed', 'MySecurePass1234');
      localStorage.setItem('phi:walletVersion', '2');
      return { success: true, mnemonic, hasV2: !!localStorage.getItem('phi:v2:encryptedSeed') };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  console.log('Result:', JSON.stringify(result, null, 2));

  // Verify data was written
  const verify = await page.evaluate(() => {
    return {
      hasSalt: !!localStorage.getItem('phi:v2:salt'),
      hasEncrypted: !!localStorage.getItem('phi:v2:encryptedSeed'),
      hasMeta: !!localStorage.getItem('phi:v2:meta'),
      hasVersion: localStorage.getItem('phi:walletVersion'),
    };
  });
  console.log('Verify:', JSON.stringify(verify, null, 2));

  // Wait for LevelDB to flush to disk, then close gracefully
  await sleep(2000);
  await context.close();
  console.log('Browser closed. Waiting for LevelDB flush...');

  // Wait for filesystem sync
  await sleep(3000);

  // Verify data persisted to disk
  const logFile = `${BROWSER_DATA}/Default/Local Storage/leveldb/000003.log`;
  if (fs.existsSync(logFile)) {
    const content = fs.readFileSync(logFile, 'utf-8');
    const hasPhiData = content.includes('phi:v2:');
    console.log(`LevelDB has phi data: ${hasPhiData}`);
    if (!hasPhiData) {
      console.log('LevelDB content:', content.substring(0, 200));
    }
  } else {
    console.log('WARNING: LevelDB log file not found');
  }
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
