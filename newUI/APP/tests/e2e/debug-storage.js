import { chromium } from 'playwright';

const ctx = await chromium.launchPersistentContext('/media/runner/FILES/Phicoin_project/newUI/APP/test-results/wallet/browser-data', { headless: true });
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('http://localhost:3001/', { waitUntil: 'networkidle' });
await new Promise(r => setTimeout(r, 2000));

const result = await page.evaluate(() => {
  return {
    phi_v2_encryptedSeed: localStorage.getItem('phi:v2:encryptedSeed') ? 'EXISTS (' + localStorage.getItem('phi:v2:encryptedSeed').length + ' chars)' : 'NULL',
    phi_v2_salt: localStorage.getItem('phi:v2:salt') ? 'EXISTS' : 'NULL',
    phi_v2_iv: localStorage.getItem('phi:v2:iv') ? 'EXISTS' : 'NULL',
    phi_v2_meta: localStorage.getItem('phi:v2:meta'),
    phi_walletVersion: localStorage.getItem('phi:walletVersion'),
    phi_created: localStorage.getItem('phi:created'),
    phi_salt: localStorage.getItem('phi:salt'),
    phi_sentinel: localStorage.getItem('phi:sentinel'),
    url: window.location.href,
  };
});

console.log(JSON.stringify(result, null, 2));
await ctx.close();
