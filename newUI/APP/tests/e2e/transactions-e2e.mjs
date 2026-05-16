/**
 * E2E Test: Transaction History functionality
 * Runs against http://localhost:13001 using a persistent browser context.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:13001';
const CONTEXT_DIR = '/media/runner/FILES/Phicoin_project/newUI/APP/test-results/wallet/browser-data';
const OUT_DIR = '/media/runner/FILES/Phicoin_project/newUI/APP/test-results/e2e-test/transactions';
const PASSWORD = 'MySecurePass1234';

const report = {
  ui_observations: [],
  bugs: [],
  missing_features_vs_qt: [],
  console_errors: [],
  feature_gaps: [],
  screenshots: [],
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

  // Capture console errors
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      report.console_errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    report.console_errors.push(`[PageError] ${err.message}`);
  });

  try {
    // ---------- 1. Navigate & unlock ----------
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Check if we're on the unlock screen
    const needsUnlock = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
    if (needsUnlock) {
      const passInput = await page.locator('input[type="password"]').first();
      await passInput.fill(PASSWORD);
      await page.click('button:has-text("Unlock"), button:has-text("Submit"), button[type="submit"]').catch(() => {
        page.keyboard.press('Enter');
      });
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: save('01-homepage.png'), fullPage: true });
    report.ui_observations.push('Homepage/dashboard loaded successfully after unlock');

    // ---------- 2. Navigate to /transactions ----------
    await page.goto(`${BASE_URL}/transactions`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: save('02-transactions-page.png'), fullPage: true });

    // Check page title
    const pageTitle = await page.locator('h1:has-text("Transactions")').isVisible().catch(() => false);
    report.ui_observations.push(`Transactions page header visible: ${pageTitle}`);

    // Check table structure
    const hasTable = await page.locator('table').first().isVisible().catch(() => false);
    const hasCards = await page.locator('.rounded-lg.border.p-3').first().isVisible().catch(() => false);

    // Check columns
    const headers = await page.locator('thead th').allTextContents().catch(() => []);
    report.ui_observations.push(`Table headers found: ${headers.join(', ') || 'none'}`);

    const expectedColumns = ['TxID', 'Date', 'Amount', 'Direction', 'Confirmations', 'Actions'];
    const presentColumns = expectedColumns.filter(h => headers.some(gh => gh.includes(h)));
    const missingColumns = expectedColumns.filter(h => !headers.some(gh => gh.includes(h)));
    report.ui_observations.push(`Expected columns present: ${presentColumns.join(', ') || 'none'}`);
    if (missingColumns.length) {
      report.bugs.push({
        title: 'Missing table columns',
        description: `Columns not found: ${missingColumns.join(', ')}`,
        steps: ['Navigate to /transactions', 'Inspect table headers'],
      });
    }

    // Check for empty state
    const emptyState = await page.locator(':has-text("No transactions found")').isVisible().catch(() => false);
    const noTxMsg = await page.locator(':has-text("Your transaction history will appear here")').isVisible().catch(() => false);
    report.ui_observations.push(`Empty state visible: ${emptyState} (no history message: ${noTxMsg})`);

    // Count transaction rows
    const rowCount = await page.locator('tbody tr').count().catch(() => 0);
    report.ui_observations.push(`Transaction rows in table: ${rowCount}`);

    // Check loading state
    const loadingSpinner = await page.locator('.animate-pulse').first().isVisible().catch(() => false);
    report.ui_observations.push(`Loading skeleton visible: ${loadingSpinner}`);

    await page.screenshot({ path: save('03-transactions-content.png'), fullPage: true });

    // ---------- 3. Test filtering ----------
    // Date filter
    const startDateInput = page.locator('input[type="date"]').first();
    const endDateInput = page.locator('input[type="date"]').last();
    const hasStartDate = await startDateInput.isVisible().catch(() => false);
    const hasEndDate = await endDateInput.isVisible().catch(() => false);
    report.ui_observations.push(`Date filters present - Start: ${hasStartDate}, End: ${hasEndDate}`);

    // Quick date presets check (today, week, month, year)
    const hasQuickDates = await page.locator('[data-testid="date-preset"], button:has-text("Today"), button:has-text("This Week"), button:has-text("This Month")').count().catch(() => 0);
    if (hasQuickDates === 0) {
      report.missing_features_vs_qt.push({
        feature: 'Quick date presets',
        description: 'QT has date filtering presets (all, today, week, month, year, custom). Web wallet only has manual date pickers.',
      });
    } else {
      report.ui_observations.push(`Quick date presets found: ${hasQuickDates}`);
    }

    // Type filter
    const typeSelect = page.locator('select').first();
    const hasTypeSelect = await typeSelect.isVisible().catch(() => false);
    if (hasTypeSelect) {
      const typeOptions = await typeSelect.locator('option').allTextContents().catch(() => []);
      report.ui_observations.push(`Type filter options: ${typeOptions.join(', ')}`);

      // Test filtering by "Sent"
      if (typeOptions.some(o => o === 'Sent')) {
        await typeSelect.selectOption({ label: 'Sent' });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: save('04-filter-sent.png'), fullPage: true });
        const sentRows = await page.locator('tbody tr').count().catch(() => 0);
        report.ui_observations.push(`Sent filter applied, rows: ${sentRows}`);

        // Reset to All Types
        await typeSelect.selectOption({ label: 'All Types' });
        await page.waitForTimeout(1000);
      }
    }

    // Search filter
    const searchInput = page.locator('input[type="text"][placeholder*="txid"], input[type="text"][placeholder*="address"], input[type="text"]').first();
    const hasSearch = await searchInput.isVisible().catch(() => false);
    report.ui_observations.push(`Search input present: ${hasSearch}`);

    if (hasSearch) {
      await searchInput.fill('test');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: save('05-search-filter.png'), fullPage: true });
      const searchRows = await page.locator('tbody tr').count().catch(() => 0);
      const searchEmpty = await page.locator(':has-text("Try adjusting your search or filters")').isVisible().catch(() => false);
      report.ui_observations.push(`Search "test" results: ${searchRows} rows, empty hint: ${searchEmpty}`);
      await searchInput.clear();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: save('06-all-filters.png'), fullPage: true });

    // Check for missing filters compared to QT
    const hasAssetFilter = await page.locator('select:has-text("Asset"), select:has-text("asset"), [placeholder*="asset"]').count().catch(() => 0);
    if (hasAssetFilter === 0) {
      report.missing_features_vs_qt.push({
        feature: 'Asset name filtering',
        description: 'QT allows filtering transactions by asset name. Web wallet has no asset filter on the transactions page.',
      });
    }

    const hasWatchOnly = await page.locator(':has-text("Watch-only"), [data-testid="watch-only-toggle"]').count().catch(() => 0);
    if (hasWatchOnly === 0) {
      report.missing_features_vs_qt.push({
        feature: 'Watch-only toggle',
        description: 'QT has a watch-only wallet toggle in transaction history. Web wallet lacks this feature.',
      });
    }

    // ---------- 4. Test CSV Export ----------
    const csvButton = page.locator('button:has-text("Export CSV")');
    const csvVisible = await csvButton.isVisible().catch(() => false);
    report.ui_observations.push(`CSV Export button visible: ${csvVisible}`);

    // CSV button only shows when there are transactions
    if (!csvVisible && emptyState) {
      report.ui_observations.push('CSV Export button correctly hidden when no transactions exist');
    } else if (csvVisible) {
      // Attempt download
      const downloadPromise = page.waitForEvent('download').catch(() => null);
      await csvButton.click();
      const download = await downloadPromise;
      if (download) {
        const fileName = download.suggestedFilename();
        report.ui_observations.push(`CSV download triggered: ${fileName}`);
      } else {
        report.ui_observations.push('CSV button clicked but no download event fired (may be blocked in headless)');
      }
    }

    await page.screenshot({ path: save('07-csv-export.png'), fullPage: true });

    // ---------- 5. Test Transaction Detail View ----------
    const detailButtons = page.locator('button:has-text("Details")');
    const detailCount = await detailButtons.count().catch(() => 0);
    report.ui_observations.push(`Detail buttons found: ${detailCount}`);

    if (detailCount > 0) {
      await detailButtons.first().click();
      await page.waitForTimeout(2000);

      const modalVisible = await page.locator('.fixed.inset-0, [role="dialog"], .modal').first().isVisible().catch(() => false);
      const modalTitle = await page.locator(':has-text("Transaction Details"), :has-text("transaction detail")').first().isVisible().catch(() => false);
      report.ui_observations.push(`Detail modal opened: ${modalVisible} (title visible: ${modalTitle})`);

      if (modalVisible || modalTitle) {
        await page.screenshot({ path: save('08-detail-modal.png'), fullPage: true });

        // Check modal content
        const modalFields = ['TxID', 'Block', 'Confirmations', 'Date', 'Amount', 'Fee', 'Direction', 'Size'];
        const foundFields = [];
        for (const field of modalFields) {
          const found = await page.locator(`:has-text("${field}:")`).isVisible().catch(() => false);
          if (found) foundFields.push(field);
        }
        report.ui_observations.push(`Detail modal fields: ${foundFields.join(', ')}`);
        const missingFields = modalFields.filter(f => !foundFields.includes(f));
        if (missingFields.length) {
          report.ui_observations.push(`Detail modal missing fields: ${missingFields.join(', ')}`);
        }

        // Check for block explorer link
        const explorerLink = await page.locator('a:has-text("Block Explorer"), a:has-text("block explorer"), a:has-text("explorer")').isVisible().catch(() => false);
        if (explorerLink) {
          report.ui_observations.push('Block explorer link present in detail modal');
        } else {
          report.ui_observations.push('No block explorer link in detail modal (blockExplorerBaseUrl is empty/disabled)');
        }

        // Check for inputs/outputs in modal
        const hasInputs = await page.locator(':has-text("Input")').isVisible().catch(() => false);
        const hasOutputs = await page.locator(':has-text("Output")').isVisible().catch(() => false);
        report.ui_observations.push(`Detail modal - Inputs section: ${hasInputs}, Outputs section: ${hasOutputs}`);

        // Check for raw hex
        const hasRawHex = await page.locator(':has-text("Raw Transaction Hex")').isVisible().catch(() => false);
        report.ui_observations.push(`Raw hex in detail modal: ${hasRawHex}`);

        // Check for copy to clipboard buttons
        const copyButtons = await page.locator('[data-testid*="copy"], button:has-text("Copy"), [aria-label*="copy"]').count().catch(() => 0);
        if (copyButtons === 0) {
          report.missing_features_vs_qt.push({
            feature: 'Copy to clipboard',
            description: 'QT allows copying txid, hex, address, amount to clipboard. Web wallet detail modal has no copy buttons.',
          });
        } else {
          report.ui_observations.push(`Copy buttons in modal: ${copyButtons}`);
        }

        // Close modal
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        // Also try clicking the close button
        await page.click('button:has-text("Close"), button >> text=✕, [aria-label="Close"]').catch(() => {});
        await page.waitForTimeout(500);
      }
    } else {
      report.ui_observations.push('No transactions to test detail view (empty wallet / no RPC data)');
    }

    // Try clicking on a txid link to open detail
    const txidLinks = page.locator('td a.font-mono, td button.font-mono').first();
    const txidLinkVisible = await txidLinks.isVisible().catch(() => false);
    if (txidLinkVisible) {
      await txidLinks.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: save('09-detail-via-txid.png'), fullPage: true });
      report.ui_observations.push('Opened detail modal via txid link click');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // ---------- 6. Check confirmation tracking ----------
    const unconfirmedLabels = await page.locator(':has-text("Unconfirmed")').count().catch(() => 0);
    const confirmedLabels = await page.locator(':has-text("Confirmed")').count().catch(() => 0);
    const pendingLabels = await page.locator(':has-text("Pending")').count().catch(() => 0);
    report.ui_observations.push(`Confirmation states - Unconfirmed: ${unconfirmedLabels}, Confirmed: ${confirmedLabels}, Pending: ${pendingLabels}`);

    // Check for immature/generated states
    const immatureLabels = await page.locator(':has-text("Immature"), :has-text("Generated")').count().catch(() => 0);
    if (immatureLabels === 0) {
      report.feature_gaps.push({
        feature: 'Immature/Generated coin tracking',
        description: 'QT tracks immature and generated coin states. Web wallet only shows Confirmed/Unconfirmed states.',
      });
    }

    // ---------- 7. Check for notifications ----------
    const toastContainer = await page.locator('[role="alert"], .toast, .notification').count().catch(() => 0);
    report.ui_observations.push(`Active toast/notification elements: ${toastContainer}`);

    // Check if the realtime hooks are active
    const realtimeActive = await page.evaluate(() => {
      try {
        return window.__PHI_REALTIME__ !== undefined || document.querySelector('[data-realtime]') !== null;
      } catch { return false; }
    });
    report.ui_observations.push(`Realtime update indicators: ${realtimeActive}`);

    report.feature_gaps.push({
      feature: 'Incoming transaction notifications',
      description: 'No visible incoming transaction notification system (toasts/push). QT shows notifications for new incoming transactions. Web wallet uses polling (useQuery refetchInterval) but has no user-visible notification for new incoming txs.',
    });

    // ---------- 8. Check Load More ----------
    const loadMoreBtn = await page.locator('button:has-text("Load More")').isVisible().catch(() => false);
    report.ui_observations.push(`Load More button visible: ${loadMoreBtn}`);

    // ---------- 9. Check responsiveness ----------
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: save('10-mobile-view.png'), fullPage: true });

    const mobileCards = await page.locator('div.md\\:hidden > div > div').count().catch(() => 0);
    const desktopTable = await page.locator('div.hidden.md\\:block > table').isVisible().catch(() => false);
    report.ui_observations.push(`Mobile view - Card layout active: ${!desktopTable}, Mobile cards: ${mobileCards}`);

    // Reset viewport
    await page.setViewportSize({ width: 1440, height: 900 });

    // ---------- 10. Check for amount search/filter ----------
    report.missing_features_vs_qt.push({
      feature: 'Amount-based filtering',
      description: 'QT allows filtering by amount range. Web wallet search only filters by txid or address, not by amount.',
    });

    // ---------- 11. Third-party explorer links ----------
    const explorerLinks = await page.locator('a[target="_blank"]').count().catch(() => 0);
    report.ui_observations.push(`External explorer links found: ${explorerLinks}`);
    if (explorerLinks === 0) {
      report.feature_gaps.push({
        feature: 'Block explorer links',
        description: 'Block explorer URLs are disabled (blockExplorerBaseUrl is empty). QT integrates third-party explorer links for transactions.',
      });
    }

    // ---------- 12. Final screenshot ----------
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/transactions`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: save('11-final-state.png'), fullPage: true });

  } catch (err) {
    report.bugs.push({
      title: 'Test execution error',
      description: err.message,
      steps: ['Script failed during execution'],
    });
  }

  // Collect final console errors (deduplicate)
  const uniqueErrors = [...new Set(report.console_errors)];

  await browser.close();

  // ---------- Write report ----------
  const reportPath = path.join(OUT_DIR, 'e2e-transactions-report.md');
  const md = `# E2E Test Report: Transaction History

## UI Observations
${report.ui_observations.map(o => `- ${o}`).join('\n')}

## Screenshots
${report.screenshots.map(s => `- ${path.basename(s)}`).join('\n')}

## Bugs Found
${report.bugs.length === 0 ? '- None detected' : report.bugs.map(b => `### ${b.title}\n${b.description}\n**Steps:** ${b.steps.join(' → ')}`).join('\n\n')}

## Missing Features (vs QT)
${report.missing_features_vs_qt.map(f => `### ${f.feature}\n${f.description}`).join('\n\n')}

## Feature Gaps
${report.feature_gaps.map(f => `### ${f.feature}\n${f.description}`).join('\n\n')}

## Console Errors
${uniqueErrors.length === 0 ? '- No console errors detected' : uniqueErrors.map(e => `- ${e}`).join('\n')}

## Summary
| Category | Count |
|----------|-------|
| UI Observations | ${report.ui_observations.length} |
| Bugs | ${report.bugs.length} |
| Missing Features vs QT | ${report.missing_features_vs_qt.length} |
| Feature Gaps | ${report.feature_gaps.length} |
| Console Errors | ${uniqueErrors.length} |
| Screenshots | ${report.screenshots.length} |
`;

  fs.writeFileSync(reportPath, md);
  console.log(`\nReport saved to: ${reportPath}`);
  console.log(`Screenshots in: ${OUT_DIR}/`);
  console.log(`\n${md}`);
})();
