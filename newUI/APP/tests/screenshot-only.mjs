import { chromium } from 'playwright';
const browser = await chromium.launchPersistentContext('/tmp/phi-playwright-e2e', { headless: true });
const page = browser.pages()[0] || await browser.newPage();
await page.goto('http://localhost:3001/', { waitUntil: 'networkidle', timeout: 10000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: '/media/runner/FILES/Phicoin_project/newUI/APP/test-results/screenshots/page-state.png', fullPage: true });
const text = await page.textContent('body');
console.log(text?.substring(0, 2000));
await browser.close();
