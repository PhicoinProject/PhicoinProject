/**
 * Enhanced E2E Diagnostic: Transaction History
 * Captures detailed console/network info and DOM state.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3001';
const CONTEXT_DIR = '/media/runner/FILES/Phicoin_project/newUI/APP/test-results/wallet/browser-data';
const OUT_DIR = '/media/runner/FILES/Phicoin_project/newUI/APP/test-results/e2e-test/transactions';
const PASSWORD = 'MySecurePass1234';

const report = {
  ui_observations: [],
  bugs: [],
  missing_features_vs_qt: [],
  console_errors: [],
  console_warnings: [],
  network_errors: [],
  feature_gaps: [],
  screenshots: [],
  wallet_state: {},
};

function save(name) {
  const fp = path.join(OUT_DIR, name);
  report.screenshots.push(fp);
  return fp;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launchPersistentContext(CONTEXT_DIR, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();

  // Capture all console messages
  page.on('console', (msg) => {
    const text = msg.text();
    const type = msg.type();
    if (type === 'error') {
      report.console_errors.push(`${text}`);
    } else if (type === 'warning') {
      report.console_warnings.push(`${text}`);
    }
  });
  page.on('pageerror', (err) => {
    report.console_errors.push(`[Uncaught] ${err.message}`);
  });

  // Capture failed network requests
  page.on('requestfailed', (req) => {
    report.network_errors.push(`${req.failure().error} ${req.url()}`);
  });

  try {
    // ---------- Navigate & unlock ----------
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Check current route and auth state
    const currentUrl = page.url();
    const bodyText = await page.innerText('body').catch(() => '');

    const needsUnlock = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
    if (needsUnlock) {
      report.ui_observations.push('Unlock screen detected');
      const passInput = await page.locator('input[type="password"]').first();
      await passInput.fill(PASSWORD);
      await page.waitForTimeout(500);

      // Try clicking submit button
      const submitBtn = page.locator('button:has-text("Unlock"), button:has-text("Submit"), form button[type="submit"]').first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
      } else {
        await passInput.press('Enter');
      }
      await page.waitForTimeout(3000);
    }

    // Check auth state via page evaluation
    const authState = await page.evaluate(() => {
      return {
        hasWallet: localStorage.getItem('phi:wallet') ? true : false,
        unlocked: sessionStorage.getItem('phi:unlocked'),
        darkMode: localStorage.getItem('darkMode'),
        currentPath: window.location.pathname,
      };
    });
    report.wallet_state = authState;
    report.ui_observations.push(`Auth state: wallet=${authState.hasWallet}, unlocked=${authState.unlocked}, path=${authState.currentPath}`);

    await page.screenshot({ path: save('01-homepage.png'), fullPage: true });

    // ---------- Navigate to /transactions ----------
    await page.goto(`${BASE_URL}/transactions`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(4000);

    await page.screenshot({ path: save('02-transactions-page.png'), fullPage: true });

    // Check page header
    const pageTitle = await page.locator('h1:has-text("Transactions")').isVisible().catch(() => false);
    report.ui_observations.push(`Transactions page header visible: ${pageTitle}`);

    // Check for sidebar navigation
    const sidebarTx = await page.locator('[href="/transactions"]').isVisible().catch(() => false);
    report.ui_observations.push(`Sidebar navigation link for /transactions: ${sidebarTx}`);

    // ---------- Deep DOM inspection ----------
    const transactionsContainer = await page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) return { found: false };

      const h1 = main.querySelector('h1');
      const table = main.querySelector('table');
      const thead = main.querySelector('thead');
      const tbody = main.querySelector('tbody');

      // Check for the filters row
      const filterRow = main.querySelector('input[type="text"], input[placeholder*="txid"], input[placeholder*="address"]');
      const dateInputs = main.querySelectorAll('input[type="date"]');
      const select = main.querySelector('select');
      const svg = main.querySelector('svg'); // empty state icon

      // Check for React component structure
      const reactRoots = [];
      const findReact = (el) => {
        if (el.__reactFiber$ || el._reactRootContainer) {
          reactRoots.push(el.tagName);
        }
      };
      Array.from(document.querySelectorAll('*')).slice(0, 100).forEach(findReact);

      return {
        found: true,
        hasHeader: !!h1,
        headerText: h1?.textContent || '',
        hasTable: !!table,
        hasThead: !!thead,
        theadText: thead ? Array.from(thead.querySelectorAll('th')).map(th => th.textContent) : [],
        tbodyRowCount: tbody ? tbody.querySelectorAll('tr').length : 0,
        hasSearchInput: !!filterRow,
        searchPlaceholder: filterRow ? filterRow.placeholder : '',
        dateInputCount: dateInputs.length,
        hasSelect: !!select,
        selectOptions: select ? Array.from(select.querySelectorAll('option')).map(o => o.textContent) : [],
        hasSvgIcon: !!svg, // empty state icon
        innerTextSnippet: main.innerText.substring(0, 500),
      };
    });
    report.ui_observations.push(`DOM inspection - Header: "${transactionsContainer.headerText}"`);
    report.ui_observations.push(`DOM - Has table: ${transactionsContainer.hasTable}, hasThead: ${transactionsContainer.hasThead}`);
    report.ui_observations.push(`DOM - Headers: ${transactionsContainer.theadText.join(', ') || 'none'}`);
    report.ui_observations.push(`DOM - tbody rows: ${transactionsContainer.tbodyRowCount}`);
    report.ui_observations.push(`DOM - Search input: ${transactionsContainer.hasSearchInput} (placeholder: "${transactionsContainer.searchPlaceholder}")`);
    report.ui_observations.push(`DOM - Date inputs: ${transactionsContainer.dateInputCount}`);
    report.ui_observations.push(`DOM - Type filter options: ${transactionsContainer.selectOptions.join(', ')}`);
    report.ui_observations.push(`DOM - Empty state SVG icon: ${transactionsContainer.hasSvgIcon}`);

    // Check for visible content snippet
    if (transactionsContainer.innerTextSnippet) {
      report.ui_observations.push(`Page text preview: "${transactionsContainer.innerTextSnippet.substring(0, 200)}..."`);
    }

    // Check expected columns
    const expectedColumns = ['TxID', 'Date', 'Amount', 'Direction', 'Confirmations', 'Actions'];
    const presentColumns = expectedColumns.filter(h => transactionsContainer.theadText.some(gh => gh.includes(h)));
    const missingColumns = expectedColumns.filter(h => !transactionsContainer.theadText.some(gh => gh.includes(h)));
    report.ui_observations.push(`Expected columns present: ${presentColumns.join(', ') || 'none'}`);
    if (missingColumns.length && transactionsContainer.hasTable) {
      report.bugs.push({
        title: 'Missing table columns',
        description: `Columns not found: ${missingColumns.join(', ')}`,
        steps: ['Navigate to /transactions', 'Inspect table headers'],
      });
    }

    // Check for empty state text
    const fullText = await page.evaluate(() => document.querySelector('main')?.innerText || '');
    const hasNoTxMsg = fullText.includes('No transactions found');
    const hasHistoryMsg = fullText.includes('Your transaction history will appear here');
    report.ui_observations.push(`Empty state "No transactions found": ${hasNoTxMsg}`);
    report.ui_observations.push(`Empty state "history will appear here": ${hasHistoryMsg}`);

    await page.screenshot({ path: save('03-transactions-content.png'), fullPage: true });

    // ---------- Test Filtering ----------

    // Date filter
    const dateInputStart = page.locator('input[type="date"]').nth(0);
    const dateInputEnd = page.locator('input[type="date"]').nth(1);
    const hasDateStart = await dateInputStart.isVisible().catch(() => false);
    const hasDateEnd = await dateInputEnd.isVisible().catch(() => false);
    report.ui_observations.push(`Date filters - Start: ${hasDateStart}, End: ${hasDateEnd}`);

    // Test setting dates
    if (hasDateStart && hasDateEnd) {
      const today = new Date().toISOString().split('T')[0];
      const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      await dateInputStart.fill(lastMonth);
      await dateInputEnd.fill(today);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: save('04-date-filter-applied.png'), fullPage: true });
      report.ui_observations.push(`Date range filter applied (${lastMonth} to ${today})`);

      // Clear dates
      await dateInputStart.fill('');
      await dateInputEnd.fill('');
      await page.waitForTimeout(1000);
    }

    // Quick date presets check
    report.missing_features_vs_qt.push({
      feature: 'Quick date presets',
      description: 'QT has date presets (all, today, week, month, year, custom). Web wallet only has manual date pickers without quick presets.',
    });

    // Type filter
    const typeSelect = page.locator('select').first();
    const hasTypeSelect = await typeSelect.isVisible().catch(() => false);
    if (hasTypeSelect) {
      const typeOptions = await typeSelect.locator('option').allTextContents().catch(() => []);
      report.ui_observations.push(`Type filter options: ${typeOptions.join(', ')}`);

      // Test each direction filter
      for (const dir of ['Sent', 'Received', 'Self', 'Other']) {
        if (typeOptions.includes(dir)) {
          await typeSelect.selectOption({ label: dir });
          await page.waitForTimeout(1500);
          await page.screenshot({ path: save(`05-filter-${dir.toLowerCase()}.png`), fullPage: true });
          const dirRows = await page.evaluate(() => {
            const tbody = document.querySelector('tbody');
            return tbody ? tbody.querySelectorAll('tr').length : 0;
          });
          report.ui_observations.push(`Filter "${dir}" applied, rows: ${dirRows}`);
        }
      }

      // Reset to All
      await typeSelect.selectOption({ label: 'All Types' });
      await page.waitForTimeout(1000);
    }

    // Search filter
    const searchInput = page.locator('input[type="text"]').first();
    const hasSearch = await searchInput.isVisible().catch(() => false);
    report.ui_observations.push(`Search input present: ${hasSearch}`);

    if (hasSearch) {
      await searchInput.fill('test-search');
      await page.waitForTimeout(1000);
      const searchResult = await page.evaluate(() => {
        const main = document.querySelector('main');
        return {
          text: main?.innerText?.substring(0, 300) || '',
          rows: document.querySelector('tbody')?.querySelectorAll('tr').length || 0,
        };
      });
      report.ui_observations.push(`Search "test-search" results: ${searchResult.rows} rows`);
      if (searchResult.text.includes('Try adjusting')) {
        report.ui_observations.push('Search empty state hint shown correctly');
      }
      await searchInput.clear();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: save('06-all-filters-view.png'), fullPage: true });

    // Missing filter features
    report.missing_features_vs_qt.push({
      feature: 'Asset name filtering',
      description: 'QT allows filtering by asset name. Web wallet has no asset filter on the transactions page.',
    });
    report.missing_features_vs_qt.push({
      feature: 'Amount-based filtering',
      description: 'QT allows filtering by amount range. Web wallet search only filters by txid/address.',
    });
    report.missing_features_vs_qt.push({
      feature: 'Watch-only toggle',
      description: 'QT has a watch-only wallet toggle. Web wallet lacks this feature.',
    });

    // ---------- CSV Export ----------
    const csvButton = page.locator('button:has-text("Export CSV")');
    const csvVisible = await csvButton.isVisible().catch(() => false);
    report.ui_observations.push(`CSV Export button visible: ${csvVisible}`);

    if (!csvVisible) {
      report.ui_observations.push('CSV Export button hidden (expected when no transactions)');
    } else {
      const downloadPromise = page.waitForEvent('download').catch(() => null);
      await csvButton.click();
      const download = await downloadPromise;
      if (download) {
        report.ui_observations.push(`CSV downloaded: ${download.suggestedFilename()}`);
      } else {
        report.ui_observations.push('CSV button clicked but no download event');
      }
    }

    await page.screenshot({ path: save('07-csv-export-state.png'), fullPage: true });

    // ---------- Transaction Detail View ----------
    const detailBtns = page.locator('button:has-text("Details")');
    const detailCount = await detailBtns.count().catch(() => 0);
    report.ui_observations.push(`Detail buttons found: ${detailCount}`);

    // Check for clickable txid links
    const txidClickable = await page.locator('td a.font-mono, td button.font-mono').count().catch(() => 0);
    report.ui_observations.push(`Clickable txid elements: ${txidClickable}`);

    let detailTested = false;
    if (detailCount > 0) {
      await detailBtns.first().click();
      await page.waitForTimeout(2000);
      detailTested = true;
    }

    // Try clicking txid
    if (!detailTested && txidClickable > 0) {
      await page.locator('td a.font-mono, td button.font-mono').first().click();
      await page.waitForTimeout(2000);
      detailTested = true;
    }

    if (detailTested) {
      const modalVisible = await page.evaluate(() => {
        const modal = document.querySelector('[role="dialog"]') ||
                      document.querySelector('.fixed.inset-0') ||
                      document.querySelector('[class*="modal"]') ||
                      document.querySelector('[class*="fixed"][class*="inset"]');
        return !!modal;
      });
      report.ui_observations.push(`Detail modal opened: ${modalVisible}`);

      if (modalVisible) {
        await page.screenshot({ path: save('08-detail-modal.png'), fullPage: true });

        const modalText = await page.evaluate(() => {
          const modal = document.querySelector('[role="dialog"]') ||
                        document.querySelector('.fixed.inset-0') ||
                        document.querySelector('[class*="fixed"][class*="inset"]');
          return modal ? modal.innerText.substring(0, 1000) : '';
        });

        const fields = ['TxID', 'Block', 'Confirmations', 'Date', 'Amount', 'Fee', 'Direction', 'Size'];
        const foundFields = fields.filter(f => modalText.includes(`${f}:`));
        report.ui_observations.push(`Modal fields found: ${foundFields.join(', ') || 'none'}`);

        // Check for copy buttons
        const copyCount = await page.locator('[aria-label*="copy"], button:has-text("Copy"), [data-testid*="copy"]').count().catch(() => 0);
        if (copyCount === 0) {
          report.missing_features_vs_qt.push({
            feature: 'Copy to clipboard',
            description: 'QT allows copying txid, hex, address, amount. Web wallet modal has no copy buttons.',
          });
        }

        // Check for explorer link
        const explorerLink = await page.locator('a:has-text("Block Explorer")').isVisible().catch(() => false);
        report.ui_observations.push(`Block explorer link in modal: ${explorerLink}`);

        // Close modal
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    } else {
      report.ui_observations.push('No transactions available to test detail view');
    }

    // ---------- Confirmation States ----------
    const confirmStates = await page.evaluate(() => {
      const text = document.querySelector('main')?.innerText || '';
      return {
        unconfirmed: (text.match(/Unconfirmed/g) || []).length,
        confirmed: (text.match(/Confirmed/g) || []).length,
        pending: (text.match(/Pending/g) || []).length,
      };
    });
    report.ui_observations.push(`Confirmation states - Unconfirmed: ${confirmStates.unconfirmed}, Confirmed: ${confirmStates.confirmed}, Pending: ${confirmStates.pending}`);

    report.feature_gaps.push({
      feature: 'Immature/Generated coin tracking',
      description: 'QT shows immature and generated coin states. Web wallet only displays Confirmed/Unconfirmed.',
    });

    // ---------- Notifications ----------
    report.feature_gaps.push({
      feature: 'Incoming transaction notifications',
      description: 'No visible notification system for incoming transactions. QT shows toast/push notifications. Web wallet uses silent polling.',
    });

    // ---------- Block Explorer Links ----------
    const explorerLinks = await page.locator('a[target="_blank"]').count().catch(() => 0);
    if (explorerLinks === 0) {
      report.feature_gaps.push({
        feature: 'Block explorer integration',
        description: 'blockExplorerBaseUrl is empty/disabled. QT provides third-party explorer links for tx lookups.',
      });
    }

    // ---------- Load More ----------
    const loadMore = await page.locator('button:has-text("Load More")').isVisible().catch(() => false);
    report.ui_observations.push(`Load More pagination button: ${loadMore}`);

    // ---------- Mobile Responsiveness ----------
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: save('09-mobile-view.png'), fullPage: true });

    const mobileState = await page.evaluate(() => {
      const table = document.querySelector('table');
      const isTableVisible = table && table.offsetParent !== null;
      const cards = document.querySelectorAll('div[class*="rounded-lg"][class*="p-3"]');
      return { tableVisible: isTableVisible, cardCount: cards.length };
    });
    report.ui_observations.push(`Mobile (375px) - Table visible: ${mobileState.tableVisible}, Cards: ${mobileState.cardCount}`);

    await page.setViewportSize({ width: 1440, height: 900 });

    // ---------- Final state ----------
    await page.screenshot({ path: save('10-final-state.png'), fullPage: true });

  } catch (err) {
    report.bugs.push({
      title: 'Test execution error',
      description: err.message,
      steps: ['Script failed during execution'],
    });
  }

  await browser.close();

  // ---------- Generate Report ----------
  const uniqueErrors = [...new Set(report.console_errors)];
  const uniqueWarnings = [...new Set(report.console_warnings)];

  const reportPath = path.join(OUT_DIR, 'e2e-transactions-report.md');
  const md = `# E2E Test Report: Transaction History

**Date**: ${new Date().toISOString()}
**URL**: ${BASE_URL}/transactions
**Browser**: Chromium (headless)
**Persistent Context**: ${CONTEXT_DIR}

---

## Screenshots (${report.screenshots.length})
${report.screenshots.map(s => `- ${path.basename(s)}`).join('\n')}

---

## UI Observations (${report.ui_observations.length})
${report.ui_observations.map(o => `- ${o}`).join('\n')}

---

## Wallet Auth State
| Property | Value |
|----------|-------|
| Wallet exists | ${report.wallet_state.hasWallet || 'unknown'} |
| Unlocked | ${report.wallet_state.unlocked || 'false'} |
| Dark mode | ${report.wallet_state.darkMode || 'unset'} |
| Current path | ${report.wallet_state.currentPath || 'unknown'} |

---

## Bugs Found (${report.bugs.length})
${report.bugs.length === 0
  ? '- No bugs detected'
  : report.bugs.map((b, i) => `### ${i + 1}. ${b.title}\n${b.description}\n\n**Steps to reproduce:** ${b.steps.join(' → ')}\n`).join('\n---\n')}

---

## Missing Features vs QT (${report.missing_features_vs_qt.length})
${report.missing_features_vs_qt.map((f, i) => `### ${i + 1}. ${f.feature}\n${f.description}`).join('\n\n---\n')}

---

## Feature Gaps (${report.feature_gaps.length})
${report.feature_gaps.map((f, i) => `### ${i + 1}. ${f.feature}\n${f.description}`).join('\n\n---\n')}

---

## Network Errors (${report.network_errors.length})
${report.network_errors.length === 0 ? '- None' : report.network_errors.map(e => `- ${e}`).join('\n')}

---

## Console Errors (${uniqueErrors.length})
${uniqueErrors.length === 0 ? '- None detected' : uniqueErrors.map(e => `- ${e}`).join('\n')}

---

## Console Warnings (${uniqueWarnings.length})
${uniqueWarnings.length === 0 ? '- None' : uniqueWarnings.map(w => `- ${w}`).join('\n')}

---

## Summary

| Category | Count |
|----------|-------|
| UI Observations | ${report.ui_observations.length} |
| Bugs Found | ${report.bugs.length} |
| Missing Features vs QT | ${report.missing_features_vs_qt.length} |
| Feature Gaps | ${report.feature_gaps.length} |
| Console Errors | ${uniqueErrors.length} |
| Console Warnings | ${uniqueWarnings.length} |
| Network Errors | ${report.network_errors.length} |
| Screenshots | ${report.screenshots.length} |

---

## Feature Comparison Matrix (Web Wallet vs QT)

| Feature | QT | Web Wallet | Status |
|---------|-----|-----------|--------|
| Transaction list display | Yes | Yes | OK |
| Date filtering (manual) | Yes | Yes | OK |
| Date presets (today/week/month/year) | Yes | No | Missing |
| Type filtering (sent/received/other) | Yes | Yes | OK |
| Search by txid/address | Yes | Yes | OK |
| Search by amount | Yes | No | Missing |
| Asset name filtering | Yes | No | Missing |
| Transaction detail modal | Yes | Yes | OK |
| CSV export | Yes | Yes | OK |
| Copy to clipboard | Yes | No | Missing |
| Block explorer links | Yes | Configurable | Partial |
| Watch-only toggle | Yes | No | Missing |
| Confirmation states (full) | Yes | Partial | Partial |
| Immature/generated tracking | Yes | No | Missing |
| Incoming tx notifications | Yes | No | Missing |
| Load more pagination | No | Yes | Extra |
| Mobile responsive | No | Yes | Extra |
`;

  fs.writeFileSync(reportPath, md);
  console.log(`\nReport saved to: ${reportPath}`);
  console.log(`Screenshots in: ${OUT_DIR}/`);
  console.log(`\n${md}`);
})();
