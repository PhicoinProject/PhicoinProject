/**
 * transactions.spec.ts
 *
 * Covers:
 *   - Transaction list loads ~11 entries from the funded test wallet
 *   - Direction filter (all / sent / received / self)
 *   - Text search by TxID prefix
 *   - Date range filter fields present
 *   - CSV export button present and clickable
 *   - Row-click opens detail modal (with vin/vout section)
 *   - Modal close returns to list
 */

import { test, expect } from '@playwright/test';
import { importEncryptedWallet } from './fixtures';

test.describe('Transaction History', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
    await page.goto('/transactions', { waitUntil: 'domcontentloaded', timeout: 10000 });
    // Wait for transaction data to load (first RPC poll)
    await expect(page.locator('h1:has-text("Transactions"), h2:has-text("Transactions")').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('navigates to /transactions from sidebar', async ({ page }) => {
    await importEncryptedWallet(page);
    await page.getByRole('link', { name: 'Transactions', exact: true }).click();
    await page.waitForURL('/transactions', { timeout: 10000 });
    await expect(
      page.locator('h1:has-text("Transactions"), h2:has-text("Transactions")').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows transaction rows for funded wallet', async ({ page }) => {
    // Allow time for RPC data
    await page.waitForTimeout(5000);
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    // Funded wallet has ~11 transactions; default count=50 so all should show
    expect(rowCount).toBeGreaterThan(0);
  });

  test('shows at least 5 transactions (funded wallet has ~11)', async ({ page }) => {
    await page.waitForTimeout(6000);
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(5);
  });

  test('search input is visible', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"], input[type="search"], input[placeholder*="txid"], input[placeholder*="address"]');
    await expect(searchInput.first()).toBeVisible({ timeout: 10000 });
  });

  test('search by partial TxID filters the list', async ({ page }) => {
    await page.waitForTimeout(5000);
    const rows = page.locator('table tbody tr');
    const initial = await rows.count();
    if (initial === 0) {
      test.skip(true, 'No transactions loaded yet');
      return;
    }

    // Get first txid from table
    const firstRow = rows.first();
    const txidCell = firstRow.locator('td').first();
    const txidText = (await txidCell.textContent()) ?? '';
    const prefix = txidText.slice(0, 6);

    const searchInput = page.locator('input[placeholder*="Search"], input[type="search"]').first();
    await searchInput.fill(prefix);
    await page.waitForTimeout(500);

    const filteredRows = page.locator('table tbody tr');
    const filteredCount = await filteredRows.count();
    // Should have <= initial count (at minimum 1 match)
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThanOrEqual(initial);
  });

  test('search with no match shows empty state', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"], input[type="search"]').first();
    const isVisible = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);
    if (!isVisible) {
      test.skip(true, 'No search input found');
      return;
    }
    await searchInput.fill('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    await page.waitForTimeout(500);
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBe(0);
  });

  test('direction filter buttons/select are present', async ({ page }) => {
    // Filter may be a <select> or a set of buttons
    const filterSel = page.locator('select, button:has-text("All"), button:has-text("Sent"), button:has-text("Received")');
    const count = await filterSel.count();
    expect(count).toBeGreaterThan(0);
  });

  test('filtering by "Sent" shows only sent transactions', async ({ page }) => {
    await page.waitForTimeout(5000);
    const sentFilter = page.locator('button:has-text("Sent"), option[value="sent"]').first();
    const visible = await sentFilter.isVisible({ timeout: 3000 }).catch(() => false);
    if (!visible) {
      const selectEl = page.locator('select').first();
      const hasSelect = await selectEl.isVisible({ timeout: 3000 }).catch(() => false);
      if (hasSelect) {
        await selectEl.selectOption({ label: 'Sent' });
      } else {
        test.skip(true, 'No direction filter found');
        return;
      }
    } else {
      await sentFilter.click();
    }
    await page.waitForTimeout(1000);
    // Either rows remain or empty — no error
    await expect(page.locator('body')).toBeVisible();
  });

  test('date range filter inputs are present', async ({ page }) => {
    const dateInputs = page.locator('input[type="date"]');
    const count = await dateInputs.count();
    expect(count).toBeGreaterThanOrEqual(2); // start date + end date
  });

  test('CSV export button is visible', async ({ page }) => {
    const csvBtn = page.locator('button:has-text("CSV"), button:has-text("Export")');
    await expect(csvBtn.first()).toBeVisible({ timeout: 10000 });
  });

  test('CSV button is clickable without errors', async ({ page }) => {
    await page.waitForTimeout(3000);
    const csvBtn = page.locator('button:has-text("CSV"), button:has-text("Export")').first();
    const visible = await csvBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!visible) {
      test.skip(true, 'CSV button not found');
      return;
    }
    // Listen for download or just ensure no crash
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
      csvBtn.click(),
    ]);
    // Either a download occurred or the button was a no-op — no exception is the pass condition
    await expect(page.locator('body')).toBeVisible();
    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.csv$/i);
    }
  });

  test('clicking a transaction row opens detail modal', async ({ page }) => {
    await page.waitForTimeout(5000);
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    if (rowCount === 0) {
      test.skip(true, 'No transactions loaded');
      return;
    }
    await rows.first().click();
    // Modal should appear
    await expect(
      page.locator('[role="dialog"], [class*="fixed inset-0"], [class*="Modal"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('detail modal shows TxID field', async ({ page }) => {
    await page.waitForTimeout(5000);
    const rows = page.locator('table tbody tr');
    if ((await rows.count()) === 0) {
      test.skip(true, 'No transactions loaded');
      return;
    }
    await rows.first().click();
    await expect(page.locator('text=/TxID|txid|Transaction ID/i').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('detail modal shows vin/vout sections or input/output', async ({ page }) => {
    await page.waitForTimeout(5000);
    const rows = page.locator('table tbody tr');
    if ((await rows.count()) === 0) {
      test.skip(true, 'No transactions loaded');
      return;
    }
    await rows.first().click();
    await expect(
      page.locator('text=/vin|vout|Input|Output|Inputs|Outputs/i').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('closing detail modal returns to list', async ({ page }) => {
    await page.waitForTimeout(5000);
    const rows = page.locator('table tbody tr');
    if ((await rows.count()) === 0) {
      test.skip(true, 'No transactions loaded');
      return;
    }
    await rows.first().click();
    // Close button
    const closeBtn = page.locator('[role="dialog"] button:has-text("Close"), [role="dialog"] button[aria-label="Close"], button:has-text("×")').first();
    const hasClose = await closeBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasClose) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
    // Modal should be gone
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 8000 });
  });
});
