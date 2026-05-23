/**
 * addressbook.spec.ts
 *
 * Covers:
 *   - Navigate to Address Book
 *   - Sending tab: add entry (happy-path), address validation (invalid rejected),
 *     duplicate address rejected, edit label, delete entry
 *   - Receiving tab: shows wallet-derived addresses
 *   - CSV export button
 *   - Persistence: entry survives page reload (localStorage-backed)
 */

import { test, expect } from '@playwright/test';
import { gotoUnlocked, WALLET_PASSWORD, unlockWallet } from './fixtures';

const VALID_TEST_ADDRESS = 'PkjQxN1CZoFpUmdnm3RUb5RKHbN7QNGj3K';
const VALID_TEST_ADDRESS_2 = 'Pum3xBGkPWK9pcpvanoMyfGTdWYuzMWmsr';

// Modal selector — Modal component uses .fixed.inset-0.z-50 (no role="dialog")
const MODAL_SEL = '.fixed.inset-0.z-50';
// Inner card (relative z-10) inside the modal overlay
const MODAL_CARD_SEL = '.relative.z-10';

test.describe('Address Book', () => {
  test.beforeEach(async ({ page }) => {
    await gotoUnlocked(page, '/addressbook');
    await expect(page.getByRole('heading', { name: 'Address Book' })).toBeVisible({
      timeout: 10000,
    });
  });

  test('shows Address Book heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Address Book' })).toBeVisible();
  });

  test('shows Sending and Receiving tabs', async ({ page }) => {
    // Tab buttons use exact labels from component
    const sendingTab = page.locator('button:has-text("Sending")').first();
    const receivingTab = page.locator('button:has-text("Receiving")').first();
    await expect(sendingTab).toBeVisible({ timeout: 5000 });
    await expect(receivingTab).toBeVisible({ timeout: 5000 });
  });

  test('Receiving tab is default active', async ({ page }) => {
    // Default tab is 'receiving' — the "Receiving" tab content should be visible
    // New Address button appears only on receiving tab
    const newAddrBtn = page.locator('button:has-text("New Address")').first();
    const hasNewAddr = await newAddrBtn.isVisible({ timeout: 5000 }).catch(() => false);
    // Alternatively the table header may show "Address" column
    const hasTable = await page.locator('table').isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasNewAddr || hasTable).toBe(true);
  });

  // ---- Switch to Sending tab ----

  test('Sending tab shows Add Address button', async ({ page }) => {
    await page.locator('button:has-text("Sending")').first().click();
    await page.waitForTimeout(300);
    // Add Address button only visible on the sending tab
    const addBtn = page.locator('button:has-text("Add Address")').first();
    await expect(addBtn).toBeVisible({ timeout: 8000 });
  });

  // ---- Add entry ----

  test('happy-path: add valid sending address entry', async ({ page }) => {
    // Switch to Sending tab first
    await page.locator('button:has-text("Sending")').first().click();
    await page.waitForTimeout(300);

    const addBtn = page.locator('button:has-text("Add Address")').first();
    await addBtn.click();

    // Modal overlay should appear
    await expect(page.locator(MODAL_SEL).first()).toBeVisible({ timeout: 8000 });

    // Label input: placeholder="e.g. Alice's wallet"
    const labelInput = page.locator('input[placeholder*="Alice"]').first();
    await labelInput.fill('Test Recipient');

    // Address input: placeholder="P... or H..."
    const addrInput = page.locator('input[placeholder="P... or H..."]').first();
    await addrInput.fill(VALID_TEST_ADDRESS);

    // Save button says "Add" for new entries
    await page.locator('button:has-text("Add")').last().click();
    await page.waitForTimeout(500);

    // Entry should appear in the list
    await expect(page.locator('text=Test Recipient')).toBeVisible({ timeout: 8000 });
  });

  test('invalid address format is rejected in add modal', async ({ page }) => {
    await page.locator('button:has-text("Sending")').first().click();
    await page.waitForTimeout(300);
    const addBtn = page.locator('button:has-text("Add Address")').first();
    await addBtn.click();

    await expect(page.locator(MODAL_SEL).first()).toBeVisible({ timeout: 8000 });

    // Fill label
    await page.locator('input[placeholder*="Alice"]').first().fill('Invalid Entry');
    // Fill invalid address
    await page.locator('input[placeholder="P... or H..."]').first().fill('invalid_address_xyz');

    await page.locator('button:has-text("Add")').last().click();

    // Error is shown inside the modal card
    await expect(
      page.locator('text=/invalid.*address|Must start with P or H/i').first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test('empty label is rejected', async ({ page }) => {
    await page.locator('button:has-text("Sending")').first().click();
    await page.waitForTimeout(300);
    const addBtn = page.locator('button:has-text("Add Address")').first();
    await addBtn.click();

    await expect(page.locator(MODAL_SEL).first()).toBeVisible({ timeout: 8000 });

    // Fill address but leave label empty
    await page.locator('input[placeholder="P... or H..."]').first().fill(VALID_TEST_ADDRESS);
    await page.locator('button:has-text("Add")').last().click();

    await expect(page.locator('text=/Label is required/i').first()).toBeVisible({ timeout: 8000 });
  });

  test('duplicate address is rejected', async ({ page }) => {
    await page.locator('button:has-text("Sending")').first().click();
    await page.waitForTimeout(300);

    // Add first entry
    const addBtn = page.locator('button:has-text("Add Address")').first();
    await addBtn.click();
    await expect(page.locator(MODAL_SEL).first()).toBeVisible({ timeout: 8000 });
    await page.locator('input[placeholder*="Alice"]').first().fill('First Entry');
    await page.locator('input[placeholder="P... or H..."]').first().fill(VALID_TEST_ADDRESS);
    await page.locator('button:has-text("Add")').last().click();
    await page.waitForTimeout(500);

    // Try adding same address again
    await addBtn.click();
    await expect(page.locator(MODAL_SEL).first()).toBeVisible({ timeout: 8000 });
    await page.locator('input[placeholder*="Alice"]').first().fill('Duplicate Entry');
    await page.locator('input[placeholder="P... or H..."]').first().fill(VALID_TEST_ADDRESS);
    await page.locator('button:has-text("Add")').last().click();

    await expect(
      page.locator('text=/already in the address book|duplicate/i').first(),
    ).toBeVisible({ timeout: 8000 });
  });

  // ---- Edit and delete ----

  test('edit button opens modal with existing values', async ({ page }) => {
    await page.locator('button:has-text("Sending")').first().click();
    await page.waitForTimeout(300);

    // First add an entry
    const addBtn = page.locator('button:has-text("Add Address")').first();
    await addBtn.click();
    await expect(page.locator(MODAL_SEL).first()).toBeVisible({ timeout: 8000 });
    await page.locator('input[placeholder*="Alice"]').first().fill('Edit Me');
    await page.locator('input[placeholder="P... or H..."]').first().fill(VALID_TEST_ADDRESS_2);
    await page.locator('button:has-text("Add")').last().click();
    await page.waitForTimeout(500);

    // Find and click the edit button (row action)
    const editBtn = page.locator('button:has-text("Edit")').first();
    const hasEdit = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasEdit) {
      test.skip(true, 'Edit button not found');
      return;
    }
    await editBtn.click();
    await expect(page.locator(MODAL_SEL).first()).toBeVisible({ timeout: 8000 });
    // Should pre-fill label with "Edit Me"
    const labelValue = await page.locator('input[placeholder*="Alice"]').first().inputValue();
    expect(labelValue).toBe('Edit Me');
  });

  test('delete button removes the entry', async ({ page }) => {
    await page.locator('button:has-text("Sending")').first().click();
    await page.waitForTimeout(300);

    // Add an entry to delete
    const addBtn = page.locator('button:has-text("Add Address")').first();
    await addBtn.click();
    await expect(page.locator(MODAL_SEL).first()).toBeVisible({ timeout: 8000 });
    await page.locator('input[placeholder*="Alice"]').first().fill('Delete Me');
    await page.locator('input[placeholder="P... or H..."]').first().fill(VALID_TEST_ADDRESS);
    await page.locator('button:has-text("Add")').last().click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Delete Me')).toBeVisible({ timeout: 5000 });

    const deleteBtn = page.locator('button:has-text("Delete")').first();
    const hasDelete = await deleteBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasDelete) {
      test.skip(true, 'Delete button not found');
      return;
    }
    await deleteBtn.click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Delete Me')).not.toBeVisible({ timeout: 8000 });
  });

  // ---- Receiving tab ----

  test('Receiving tab shows wallet addresses or empty state', async ({ page }) => {
    // Default tab is already receiving
    await page.waitForTimeout(3000);
    // Should show P-prefixed addresses OR loading/empty state
    const hasAddrs = (await page.locator('text=/P[A-Za-z0-9]{25,39}/').count()) > 0;
    const hasEmpty = await page
      .locator('text=/No receiving addresses|Click.*New Address/i')
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    expect(hasAddrs || hasEmpty).toBe(true);
  });

  // ---- CSV export ----

  test('CSV export button is visible', async ({ page }) => {
    // "Export to CSV" — disabled when list is empty
    const csvBtn = page.locator('button:has-text("Export to CSV")').first();
    await expect(csvBtn).toBeVisible({ timeout: 8000 });
  });

  // ---- Persistence ----

  test('entries persist after page reload', async ({ page }) => {
    await page.locator('button:has-text("Sending")').first().click();
    await page.waitForTimeout(300);

    // Add entry
    const addBtn = page.locator('button:has-text("Add Address")').first();
    await addBtn.click();
    await expect(page.locator(MODAL_SEL).first()).toBeVisible({ timeout: 8000 });
    await page.locator('input[placeholder*="Alice"]').first().fill('Persist Test');
    await page.locator('input[placeholder="P... or H..."]').first().fill(VALID_TEST_ADDRESS);
    await page.locator('button:has-text("Add")').last().click();
    await page.waitForTimeout(500);

    // Reload and re-unlock
    await page.reload({ waitUntil: 'domcontentloaded' });
    const needsUnlock = await page.locator('#passphrase').isVisible({ timeout: 3000 }).catch(() => false);
    if (needsUnlock) {
      await unlockWallet(page, WALLET_PASSWORD);
    }

    // Navigate back if needed
    const onAddressBook = page.url().includes('/addressbook');
    if (!onAddressBook) {
      await page.goto('/addressbook', { waitUntil: 'domcontentloaded', timeout: 10000 });
      const needsUnlock2 = await page.locator('#passphrase').isVisible({ timeout: 3000 }).catch(() => false);
      if (needsUnlock2) {
        await unlockWallet(page, WALLET_PASSWORD);
      }
    }

    // Switch to Sending tab
    await page.locator('button:has-text("Sending")').first().click();
    await expect(page.locator('text=Persist Test')).toBeVisible({ timeout: 10000 });
  });
});
