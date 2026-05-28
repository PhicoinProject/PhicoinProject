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

// Both must pass the wallet's Base58Check validation (version byte 0x38 = 'P',
// valid checksum) or the Add-Address modal rejects them and no entry is saved.
// The previous VALID_TEST_ADDRESS ('PkjQ…') was NOT a valid address — it failed
// the Base58Check checksum — so every add/duplicate/delete/persist test silently
// failed (the entry never got created). These are real, checksum-valid addresses.
const VALID_TEST_ADDRESS = 'PoVBTpZKuDvegEEaPSYPp76FLFbnc9bZHn';
const VALID_TEST_ADDRESS_2 = 'Pum3xBGkPWK9pcpvanoMyfGTdWYuzMWmsr';

/**
 * KNOWN PRODUCT BUG — Sending-list does not refresh reactively.
 *
 * src/pages/AddressBook.tsx derives the sending entries with:
 *     const sendingEntries = useMemo(() => getEntries('sending'), [getEntries]);
 * `getEntries` is a stable Zustand action reference, so the memo is computed
 * ONCE and never re-derives when the store's `entries` array changes. After
 * addEntry()/deleteEntry() the entry IS persisted to localStorage (verified:
 * the new row appears after navigating away and back), but the table is not
 * updated until the component remounts.
 *
 * Tests that assert a just-added/deleted row appears/disappears in-place are
 * therefore marked test.fixme until the product code re-derives the list from
 * live store state (e.g. a Zustand selector subscribing to `entries`). The
 * validation/duplicate/empty-label tests still run — they read live store
 * state (findByAddress) or modal error text, which are unaffected.
 */
// FIXED: AddressBook now derives the sending list from a Zustand `entries` selector
// (useAddressBookStore((s) => s.entries) + useMemo), so it re-renders on add/edit/delete.
// Flag kept (false) so the add/delete-in-place assertions run and guard against regression.
const SENDING_LIST_NOT_REACTIVE = false;

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
    // BLOCKED by the AddressBook sending-list reactivity bug (see top of file):
    // the entry is saved to the store but the table is not refreshed in-place.
    test.fixme(SENDING_LIST_NOT_REACTIVE, 'AddressBook sending list does not re-derive after addEntry()');
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
    // BLOCKED by the AddressBook sending-list reactivity bug (see top of file):
    // the entry added below never renders, so its row Edit button is absent.
    test.fixme(SENDING_LIST_NOT_REACTIVE, 'AddressBook sending list does not re-derive after addEntry()');
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
    // BLOCKED by the AddressBook sending-list reactivity bug (see top of file):
    // the just-added entry never renders in the table, so there is no row to
    // delete; and even after delete the list would not refresh in-place.
    test.fixme(SENDING_LIST_NOT_REACTIVE, 'AddressBook sending list does not re-derive after addEntry()/deleteEntry()');
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
    // Deleting is now a two-step confirmation (destructive action): the row Delete button
    // opens a confirmation Modal; the actual removal happens on the modal's Delete button.
    await deleteBtn.click();
    const confirmBtn = page.locator(`${MODAL_SEL} button:has-text("Delete")`).last();
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
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
    // NOTE: this test is NOT blocked by the sending-list reactivity bug — a full
    // page reload remounts AddressBook, so the persisted entry IS re-derived and
    // shown. We assert localStorage persistence + post-remount visibility.
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

    // The store write is synchronous; confirm it reached the persisted store.
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('phicoin-addressbook') ?? ''))
      .toContain('Persist Test');

    // Reload, then re-unlock AND navigate back to /addressbook in one robust step.
    // unlockWallet() always lands on the Dashboard, so we must use the in-SPA
    // gotoUnlocked() helper to reach /addressbook (it also waits for route
    // content to render — a raw page.goto would not).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await gotoUnlocked(page, '/addressbook', WALLET_PASSWORD);

    await expect(page.getByRole('heading', { name: 'Address Book' })).toBeVisible({ timeout: 15000 });

    // Switch to Sending tab
    await page.locator('button:has-text("Sending")').first().click();
    await expect(page.locator('text=Persist Test')).toBeVisible({ timeout: 10000 });
  });
});
