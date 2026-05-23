import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  const userDataDir = '/tmp/phicoin-test-profile';
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch(e) {}

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('Page error:', msg.text().substring(0, 100));
  });

  // Step 1: Import wallet
  await page.goto('http://localhost:13001/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.locator('text=Import existing wallet').click();
  await page.waitForTimeout(2000);

  const walletJson = fs.readFileSync(process.env.TEST_WALLET_PATH, 'utf8');
  await page.locator('textarea').fill(walletJson);
  await page.waitForTimeout(1000);
  await page.locator('input#importPassword').fill(process.env.TEST_WALLET_PASSWORD);
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Import Wallet")').click();
  await page.waitForTimeout(3000);

  console.log('Wallet imported. URL:', page.url());
  const content = await page.locator('#root').innerText();
  console.log('Balance:', content.match(/\d+\.\d+ PHI/)?.[0] ?? content.match(/\d+ PHI/)?.[0] ?? 'unknown');

  // Step 2: Navigate to create-asset and open modal
  console.log('\n=== Creating Asset ===');
  await page.goto('http://localhost:13001/create-asset', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);

  // Click "Create New Asset" button to open modal
  await page.locator('button:has-text("Create New Asset")').click();
  await page.waitForTimeout(2000);

  // Check modal content
  const modal = await page.locator('[role="dialog"]').count();
  console.log('Modal open:', modal > 0);

  // ROOT should be selected by default
  // Fill form fields
  await page.locator('#create-asset-label').fill('PLAYWRIGHT');
  await page.locator('#create-asset-quantity').fill('100');
  await page.locator('#create-asset-decimals').fill('8');
  await page.waitForTimeout(500);

  // Check reissuable
  const checkboxes = await page.locator('[role="dialog"] input[type="checkbox"]').all();
  console.log('Checkboxes in modal:', checkboxes.length);
  for (let i = 0; i < checkboxes.length; i++) {
    const label = await checkboxes[i].locator('xpath=ancestor::label').first().innerText().catch(() => '');
    const checked = await checkboxes[i].isChecked();
    console.log(`  checkbox[${i}]: checked=${checked} label=${label.substring(0, 50)}`);
  }

  // Check the first checkbox (Reissuable)
  if (checkboxes.length > 0) {
    await checkboxes[0].check();
    await page.waitForTimeout(500);
  }

  // Click Issue ROOT Asset
  console.log('\n=== Broadcasting Asset ===');
  const issueBtn = await page.locator('button:has-text("Issue ROOT Asset")');
  console.log('Issue button found:', await issueBtn.count() > 0);

  await issueBtn.click();
  console.log('Clicking Issue button...');

  // Wait for result (could take 15-30s for daemon signing)
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const currentContent = await page.locator('#root').innerText();
    if (currentContent.includes('Created Successfully') || currentContent.includes('txid') || currentContent.includes('Error') || currentContent.includes('error')) {
      console.log('Result detected after', i+1, 'seconds');
      console.log('Full content:', currentContent.substring(0, 1500));
      await page.screenshot({ path: '/tmp/asset-result.png' });
      await browser.close();
      return;
    }
  }

  // If no result yet, show current state
  const finalContent = await page.locator('#root').innerText();
  console.log('Final content:', finalContent.substring(0, 1000));
  await page.screenshot({ path: '/tmp/asset-result.png' });
  await browser.close();
})();
