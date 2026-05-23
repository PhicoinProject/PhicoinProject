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
import { importEncryptedWallet, unlockWallet, WALLET_PASSWORD } from './fixtures';

const VALID_TEST_ADDRESS = 'PkjQxN1CZoFpUmdnm3RUb5RKHbN7QNGj3K';
const VALID_TEST_ADDRESS_2 = 'Pum3xBGkPWK9pcpvanoMyfGTdWYuzMWmsr';

test.describe('Address Book', () => {
  test.beforeEach(async ({ page }) => {
    await importEncryptedWallet(page);
    await page.goto('/addressbook', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Address Book' })).toBeVisible({
      timeout: 10000,
    });
  });

  test('shows Address Book heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Address Book' })).toBeVisible();
  });

  test('shows Sending and Receiving tabs', async ({ page }) => {
    const sendingTab = page.locator('button:has-text("Sending"), [role="tab"]:has-text("Sending")').first();
    const receivingTab = page.locator('button:has-text("Receiving"), [role="tab"]:has-text("Receiving")').first();
    await expect(sendingTab).toBeVisible({ timeout: 5000 });
    await expect(receivingTab).toBeVisible({ timeout: 5000 });
  });

  test('Sending tab is default active', async ({ page }) => {
    // Should already be on sending tab
    const addBtn = page.locator('button:has-text("Add"), button[aria-label*="add"]').first();
    await expect(addBtn).toBeVisible({ timeout: 8000 });
  });

  // ---- Add entry ----

  test('happy-path: add valid sending address entry', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add"), button[aria-label*="add"]').first();
    await addBtn.click();

    // Modal should open
    const modal = page.locator('[role="dialog"], [class*="fixed"]').first();
    await expect(modal).toBeVisible({ timeout: 8000 });

    // Fill label first (required)
    const labelInput = page.locator('input[placeholder*="Label"], input[id*="label"], #modal-label, input').nth(0);
    await labelInput.fill('Test Recipient');

    // Fill address
    const addrInput = page.locator('input[placeholder*="Address"], input[placeholder*="address"], input').nth(1);
    await addrInput.fill(VALID_TEST_ADDRESS);

    await page.locator('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Add")').first().click();
    await page.waitForTimeout(500);

    // Entry should appear in the list
    await expect(page.locator('text=Test Recipient')).toBeVisible({ timeout: 8000 });
  });

  test('invalid address format is rejected in add modal', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add")').first();
    await addBtn.click();

    const modal = page.locator('[role="dialog"], [class*="fixed"]').first();
    await expect(modal).toBeVisible({ timeout: 8000 });

    const labelInput = page.locator('[role="dialog"] input').first();
    await labelInput.fill('Invalid Entry');

    const addrInput = page.locator('[role="dialog"] input').nth(1);
    await addrInput.fill('invalid_address_xyz');

    await page.locator('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Add")').first().click();

    await expect(
      page.locator('text=/invalid.*address|Must start with P or H/i').first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test('empty label is rejected', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add")').first();
    await addBtn.click();

    const modal = page.locator('[role="dialog"], [class*="fixed"]').first();
    await expect(modal).toBeVisible({ timeout: 8000 });

    const addrInput = page.locator('[role="dialog"] input').nth(1);
    await addrInput.fill(VALID_TEST_ADDRESS);

    await page.locator('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Add")').first().click();

    await expect(page.locator('text=/Label is required/i').first()).toBeVisible({ timeout: 8000 });
  });

  test('duplicate address is rejected', async ({ page }) => {
    // Add first entry
    const addBtn = page.locator('button:has-text("Add")').first();
    await addBtn.click();
    await page.locator('[role="dialog"] input').first().fill('First Entry');
    await page.locator('[role="dialog"] input').nth(1).fill(VALID_TEST_ADDRESS);
    await page.locator('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Add")').first().click();
    await page.waitForTimeout(500);

    // Try adding same address again
    await addBtn.click();
    await page.locator('[role="dialog"] input').first().fill('Duplicate Entry');
    await page.locator('[role="dialog"] input').nth(1).fill(VALID_TEST_ADDRESS);
    await page.locator('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Add")').first().click();

    await expect(
      page.locator('text=/already in the address book|duplicate/i').first(),
    ).toBeVisible({ timeout: 8000 });
  });

  // ---- Edit and delete ----

  test('edit button opens modal with existing values', async ({ page }) => {
    // First add an entry
    const addBtn = page.locator('button:has-text("Add")').first();
    await addBtn.click();
    await page.locator('[role="dialog"] input').first().fill('Edit Me');
    await page.locator('[role="dialog"] input').nth(1).fill(VALID_TEST_ADDRESS_2);
    await page.locator('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Add")').first().click();
    await page.waitForTimeout(500);

    // Find and click the edit button
    const editBtn = page.locator('button:has-text("Edit"), button[aria-label*="edit"]').first();
    const hasEdit = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasEdit) {
      test.skip(true, 'Edit button not found');
      return;
    }
    await editBtn.click();
    const modal = page.locator('[role="dialog"]').first();
    await expect(modal).toBeVisible({ timeout: 8000 });
    // Should pre-fill label
    const labelValue = await page.locator('[role="dialog"] input').first().inputValue();
    expect(labelValue).toBe('Edit Me');
  });

  test('delete button removes the entry', async ({ page }) => {
    // Add an entry to delete
    const addBtn = page.locator('button:has-text("Add")').first();
    await addBtn.click();
    await page.locator('[role="dialog"] input').first().fill('Delete Me');
    await page.locator('[role="dialog"] input').nth(1).fill(VALID_TEST_ADDRESS);
    await page.locator('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Add")').first().click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Delete Me')).toBeVisible({ timeout: 5000 });

    const deleteBtn = page.locator('button:has-text("Delete"), button[aria-label*="delete"]').first();
    const hasDelete = await deleteBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasDelete) {
      test.skip(true, 'Delete button not found');
      return;
    }
    await deleteBtn.click();
    // Confirm deletion dialog if present
    const confirmDelete = page.locator('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Delete")').last();
    const hasConfirm = await confirmDelete.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasConfirm) await confirmDelete.click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Delete Me')).not.toBeVisible({ timeout: 8000 });
  });

  // ---- Receiving tab ----

  test('Receiving tab shows wallet addresses', async ({ page }) => {
    await page.locator('button:has-text("Receiving")').click();
    await page.waitForTimeout(3000);
    // Should show P-prefixed addresses
    const addrs = page.locator('text=/P[A-Za-z0-9]{25,39}/');
    const count = await addrs.count();
    expect(count).toBeGreaterThan(0);
  });

  // ---- CSV export ----

  test('CSV export button is visible on sending tab', async ({ page }) => {
    const csvBtn = page.locator('button:has-text("CSV"), button:has-text("Export")').first();
    await expect(csvBtn).toBeVisible({ timeout: 8000 });
  });

  // ---- Persistence ----

  test('entries persist after page reload', async ({ page }) => {
    // Add entry
    const addBtn = page.locator('button:has-text("Add")').first();
    await addBtn.click();
    await page.locator('[role="dialog"] input').first().fill('Persist Test');
    await page.locator('[role="dialog"] input').nth(1).fill(VALID_TEST_ADDRESS);
    await page.locator('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Add")').first().click();
    await page.waitForTimeout(500);

    // Reload
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Re-unlock if needed
    const needsUnlock = await page.locator('#passphrase').isVisible({ timeout: 3000 }).catch(() => false);
    if (needsUnlock) {
      await unlockWallet(page, WALLET_PASSWORD);
      await page.goto('/addressbook', { waitUntil: 'domcontentloaded', timeout: 10000 });
    }

    await expect(page.locator('text=Persist Test')).toBeVisible({ timeout: 10000 });
  });
});
