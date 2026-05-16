import { chromium } from 'playwright';

(async () => {
  const userDataDir = '/tmp/phicoin-test-profile';
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto('http://localhost:13001/create-asset', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(5000);

  // Dump all inputs
  const inputs = await page.locator('input, textarea, select').all();
  console.log('Total inputs:', inputs.length);
  for (let i = 0; i < inputs.length; i++) {
    const tag = await inputs[i].tagName();
    const type = await inputs[i].getAttribute('type');
    const id = await inputs[i].getAttribute('id');
    const name = await inputs[i].getAttribute('name');
    const placeholder = await inputs[i].getAttribute('placeholder') || '';
    const visible = await inputs[i].isVisible();
    console.log('  ' + i + ': <' + tag + '> type=' + type + ' id=' + id + ' name=' + name + ' placeholder=' + placeholder + ' visible=' + visible);
  }

  // Check modals/dialogs
  const modals = await page.locator('[role="dialog"], [class*="modal"], [class*="overlay"]').all();
  console.log('\nModals:', modals.length);
  for (const m of modals) {
    const text = await m.innerText().catch(() => '');
    console.log('  Modal text:', text.substring(0, 200));
  }

  const buttons = await page.locator('button').all();
  console.log('\nButtons:', buttons.length);
  for (const b of buttons) {
    const text = await b.innerText().catch(() => '');
    const visible = await b.isVisible();
    if(visible) console.log('  Button:', text.trim());
  }

  // Check if there's a modal dialog with inputs
  const dialogInputs = await page.locator('[role="dialog"] input, [class*="modal"] input').all();
  console.log('\nDialog inputs:', dialogInputs.length);
  for (let i = 0; i < dialogInputs.length; i++) {
    const type = await dialogInputs[i].getAttribute('type');
    const placeholder = await dialogInputs[i].getAttribute('placeholder') || '';
    console.log('  dialog-input[' + i + ']: type=' + type + ' placeholder=' + placeholder);
  }

  await page.screenshot({ path: '/tmp/create-asset-debug.png' });
  await browser.close();
})();
