# PHICOIN Web Wallet — End-to-End Test Plan

**Date**: 2026-05-23  
**App URL**: `http://localhost:13001`  
**Test framework**: Playwright (Chromium)  
**Test wallet**: funded backup at `$TEST_WALLET_PATH` (default `newUI/design/phicoin-wallet-backup-2026-05-15.json`)  
**Test wallet password**: set via the `TEST_WALLET_PASSWORD` env var (never committed)  
**Funded balance**: ~0.95 PHI, ~11 transactions

---

## Robustness Rules

- **Never use `waitUntil: 'networkidle'`** — the app polls RPC forever → hangs. Always use `domcontentloaded` + `expect(locator).toBeVisible()` with explicit timeouts.
- **After every full `page.reload()`** the AuthGate shows the Unlock page (auto-unlock was removed). Tests call `unlockWallet()` from fixtures after any reload that requires auth.
- **Money-touching actions** (PHI send, asset issue/transfer) are gated behind `ALLOW_BROADCAST=1` env flag. Default: drive to confirm dialog, assert summary, then Cancel.

---

## Spec Files

| File | Description |
|------|-------------|
| `wallet-lifecycle.spec.ts` | Create, import, unlock, rate-limit, change passphrase, backup reveal |
| `wallet-create.spec.ts` | Create wallet flow (mnemonic, quiz, password strength), crypto API |
| `overview.spec.ts` | Dashboard balance, recent txs, network stats |
| `transactions.spec.ts` | Tx list, filter, search, CSV, detail modal |
| `send-receive.spec.ts` | Send form, confirm dialog, Receive address+QR+BIP21 |
| `addressbook.spec.ts` | CRUD sending entries, validation, receiving tab, persistence |
| `assets-display.spec.ts` | Assets list, send/receive modal validation |
| `asset-issuance.spec.ts` | Create Asset types, field validation, type-specific fields |
| `asset-transfer.spec.ts` | Manage Assets (reissue, admin ops), Restricted Assets tabs |
| `sign-verify.spec.ts` | Sign message, verify round-trip TRUE/FALSE, empty-field guard |
| `rpc-console.spec.ts` | getblockchaininfo response, blocked methods rejected client-side |
| `settings.spec.ts` | Connection fields, dark mode toggle, Save, tabs |
| `mining.spec.ts` | Mining stats: blocks, difficulty, hash rate, mempool |

---

## Test Case Inventory

### 1. Wallet Lifecycle (`wallet-lifecycle.spec.ts`)

| # | Test | Type |
|---|------|------|
| WL-01 | Create Wallet page visible in fresh context | Happy |
| WL-02 | 24-word mnemonic displays on step 1 | Happy |
| WL-03 | Regenerate button produces different mnemonic | Happy |
| WL-04 | Next disabled until backup confirmed | Validation |
| WL-05 | Proceeds to step 2 after confirming backup | Happy |
| WL-06 | Import existing wallet link visible | Happy |
| WL-07 | Password strength meter on step 3 | Happy |
| WL-08 | Import page accessible without auth | Happy |
| WL-09 | Recovery Phrase tab visible on import page | Happy |
| WL-10 | Recovery Phrase tab shows 24-word input | Happy |
| WL-11 | Import encrypted wallet (happy-path) | Happy |
| WL-12 | Wrong password shows error | Validation |
| WL-13 | Invalid JSON shows parse error | Validation |
| WL-14 | Empty JSON textarea shows validation error | Validation |
| WL-15 | Unlock page shown after reload | Happy |
| WL-16 | Correct password unlocks to dashboard | Happy |
| WL-17 | Wrong password shows error on unlock page | Validation |
| WL-18 | Rate limit after 5 wrong attempts | Security |
| WL-19 | Change Passphrase form visible on backup page | Happy |
| WL-20 | Empty fields rejected on change passphrase | Validation |
| WL-21 | Wrong old password rejected | Security |
| WL-22 | Mismatched new passwords rejected | Validation |
| WL-23 | New password too short rejected | Validation |
| WL-24 | Same-as-old password rejected | Validation |
| WL-25 | Show/hide toggle changes input type | Happy |
| WL-26 | Clear button resets passphrase fields | Happy |
| WL-27 | Backup page accessible from sidebar | Happy |
| WL-28 | Backup page shows export option | Happy |
| WL-29 | Generate Backup produces JSON | Happy |

### 2. Overview (`overview.spec.ts`)

| # | Test | Type |
|---|------|------|
| OV-01 | Dashboard heading visible | Happy |
| OV-02 | Total Balance card visible | Happy |
| OV-03 | Balance displayed with PHI unit | Happy |
| OV-04 | Balance ~0.95 PHI (0.1–10 range) | Happy |
| OV-05 | Assets count card visible | Happy |
| OV-06 | Network card shows block height > 0 | Happy |
| OV-07 | Recent Transactions section exists | Happy |
| OV-08 | At least one tx row from funded wallet | Happy |
| OV-09 | 4-card network info grid renders | Happy |
| OV-10 | No RPC error banner when healthy | Health |

### 3. Transactions (`transactions.spec.ts`)

| # | Test | Type |
|---|------|------|
| TX-01 | Sidebar nav to /transactions | Happy |
| TX-02 | Tx rows load for funded wallet | Happy |
| TX-03 | At least 5 transactions (funded wallet has ~11) | Happy |
| TX-04 | Search input visible | Happy |
| TX-05 | Search by partial TxID filters list | Happy |
| TX-06 | Search with no match → empty list | Happy |
| TX-07 | Direction filter present | Happy |
| TX-08 | Filter by "Sent" shows only sent | Happy |
| TX-09 | Date range inputs present (2x) | Happy |
| TX-10 | CSV export button visible | Happy |
| TX-11 | CSV button clickable (download or no-op) | Happy |
| TX-12 | Row-click opens detail modal | Happy |
| TX-13 | Modal shows TxID field | Happy |
| TX-14 | Modal shows vin/vout sections | Happy |
| TX-15 | Closing modal returns to list | Happy |

### 4. Send / Receive (`send-receive.spec.ts`)

| # | Test | Type |
|---|------|------|
| SR-01 | Receive heading visible | Happy |
| SR-02 | Generate Address button present | Happy |
| SR-03 | Generated address starts with P | Happy |
| SR-04 | QR code SVG renders | Happy |
| SR-05 | Copy Address button after generation | Happy |
| SR-06 | BIP21 URI with phicoin: scheme | Happy |
| SR-07 | Amount field updates URI | Happy |
| SR-08 | Label field updates URI | Happy |
| SR-09 | Copy URI button clickable | Happy |
| SR-10 | Reset button clears address | Happy |
| SR-11 | Send heading visible | Happy |
| SR-12 | Recipient address input visible | Happy |
| SR-13 | Amount input visible | Happy |
| SR-14 | PHI balance shown | Happy |
| SR-15 | Invalid address format rejected | Validation |
| SR-16 | Add Recipient button adds second row | Happy |
| SR-17 | Remove button removes extra row | Happy |
| SR-18 | Fee rate control present | Happy |
| SR-19 | Subtract fee checkbox visible | Happy |
| SR-20 | Coin control / From selector visible | Happy |
| SR-21 | Estimate Fee button triggers update | Happy |
| SR-22 | Confirm dialog shows amount + fee + total | Happy |
| SR-23 | Cancel in confirm = no broadcast | Security |
| SR-24 | ALLOW_BROADCAST=1: self-send broadcast | Broadcast |

### 5. Address Book (`addressbook.spec.ts`)

| # | Test | Type |
|---|------|------|
| AB-01 | Address Book heading visible | Happy |
| AB-02 | Sending and Receiving tabs visible | Happy |
| AB-03 | Sending tab is default active | Happy |
| AB-04 | Add entry happy-path | Happy |
| AB-05 | Invalid address rejected | Validation |
| AB-06 | Empty label rejected | Validation |
| AB-07 | Duplicate address rejected | Validation |
| AB-08 | Edit button pre-fills modal | Happy |
| AB-09 | Delete removes entry | Happy |
| AB-10 | Receiving tab shows wallet addresses | Happy |
| AB-11 | CSV export button visible | Happy |
| AB-12 | Entries persist after reload | Happy |

### 6. Assets (`assets-display.spec.ts`)

| # | Test | Type |
|---|------|------|
| AD-01 | Sidebar nav to /assets | Happy |
| AD-02 | Assets heading visible | Happy |
| AD-03 | Page renders without crash | Happy |
| AD-04 | Shows table or empty state | Happy |
| AD-05 | Send modal opens for held asset | Happy |
| AD-06 | Send modal validates empty address | Validation |
| AD-07 | Receive modal opens | Happy |
| AD-08 | Receive modal shows P-prefixed address | Happy |

### 7. Create Asset (`asset-issuance.spec.ts`)

| # | Test | Type |
|---|------|------|
| CA-01 | Sidebar nav to /create-asset | Happy |
| CA-02 | Shows 5 type cards | Happy |
| CA-03 | Create New Asset button opens modal | Happy |
| CA-04 | Empty label → required error | Validation |
| CA-05 | Label > 31 chars → error | Validation |
| CA-06 | Negative quantity → error | Validation |
| CA-07 | Decimal places > 8 → error | Validation |
| CA-08 | Decimal = 8 accepted | Validation |
| CA-09 | UNIQUE hides quantity field | Happy |
| CA-10 | RESTRICTED shows verifier field | Happy |
| CA-11 | RESTRICTED empty verifier → error | Validation |
| CA-12 | SUB shows parent selector | Happy |
| CA-13 | UNIQUE shows parent selector | Happy |
| CA-14 | IPFS toggle reveals IPFS input | Happy |
| CA-15 | Reissuable checkbox toggleable | Happy |
| CA-16 | QUALIFIER type changes fields | Happy |
| CA-17 | ROOT issue (broadcast gated) | Broadcast |

### 8. Manage / Restricted Assets (`asset-transfer.spec.ts`)

| # | Test | Type |
|---|------|------|
| MA-01 | Sidebar nav to /manage-assets | Happy |
| MA-02 | My Assets / Admin toggles visible | Happy |
| MA-03 | My Assets shows assets or empty | Happy |
| MA-04 | Reissue opens modal | Happy |
| MA-05 | Reissue validates quantity > 0 | Validation |
| MA-06 | Admin tab shows qualifier/freeze ops | Happy |
| MA-07 | Set Verifier opens verifier modal | Happy |
| RA-01 | Sidebar nav to /restricted | Happy |
| RA-02 | 4 tabs visible | Happy |
| RA-03 | My Restricted tab content | Happy |
| RA-04 | Qualifiers tab renders | Happy |
| RA-05 | Tags tab renders | Happy |
| RA-06 | Restrictions tab renders | Happy |

### 9. Sign / Verify (`sign-verify.spec.ts`)

| # | Test | Type |
|---|------|------|
| SV-01 | Sidebar nav to /sign-verify | Happy |
| SV-02 | Sign tab visible | Happy |
| SV-03 | Verify tab visible | Happy |
| SV-04 | Sign tab has message textarea | Happy |
| SV-05 | Sign produces base64 signature | Happy |
| SV-06 | Signed address is P-prefixed | Happy |
| SV-07 | Copy Signature button visible | Happy |
| SV-08 | Round-trip: sign → verify → TRUE | Happy |
| SV-09 | Tampered message → verify → FALSE | Security |
| SV-10 | Verify with empty fields shows warning | Validation |

### 10. RPC Console (`rpc-console.spec.ts`)

| # | Test | Type |
|---|------|------|
| RC-01 | Sidebar nav to /rpc | Happy |
| RC-02 | Console heading/label visible | Happy |
| RC-03 | Command input visible | Happy |
| RC-04 | Send/Execute button visible | Happy |
| RC-05 | Output area visible | Happy |
| RC-06 | getblockchaininfo returns response | Happy |
| RC-07 | getblockchaininfo response has blocks field | Happy |
| RC-08 | `dumpprivkey` blocked client-side | Security |
| RC-09 | `importprivkey` blocked client-side | Security |
| RC-10 | `sendrawtransaction` blocked client-side | Security |
| RC-11 | `walletpassphrase` blocked client-side | Security |
| RC-12 | Up arrow recalls last command | Happy |
| RC-13 | `getmininginfo` readable command | Happy |

### 11. Settings (`settings.spec.ts`)

| # | Test | Type |
|---|------|------|
| SE-01 | Sidebar nav to /settings | Happy |
| SE-02 | Settings heading visible | Happy |
| SE-03 | Connection tab shows RPC fields | Happy |
| SE-04 | Host input present | Happy |
| SE-05 | Port input present | Happy |
| SE-06 | User input present | Happy |
| SE-07 | Password input present | Happy |
| SE-08 | Save button present | Happy |
| SE-09 | Save shows success feedback | Happy |
| SE-10 | Dark mode toggle visible | Happy |
| SE-11 | Dark mode toggle flips html.dark class | Happy |
| SE-12 | Notifications tab accessible | Happy |
| SE-13 | Network tab shows ban management | Happy |
| SE-14 | About tab shows version info | Happy |
| SE-15 | Currency tab renders | Happy |

### 12. Mining (`mining.spec.ts`)

| # | Test | Type |
|---|------|------|
| MI-01 | Sidebar nav to /mining | Happy |
| MI-02 | Mining heading visible | Happy |
| MI-03 | Blocks stat card visible | Happy |
| MI-04 | Difficulty stat card visible | Happy |
| MI-05 | Hash Rate stat visible | Happy |
| MI-06 | Non-zero block count | Happy |
| MI-07 | Mempool section renders | Happy |
| MI-08 | No unhandled errors | Health |
| MI-09 | Hash rate formatted with units or N/A | Happy |

---

## Running the Suite

### Prerequisites

1. App running: `npm run dev` (inside `newUI/APP/`) — available at `http://localhost:13001`
2. Daemon running: `phicoin-daemon-1` container with RPC on `http://127.0.0.1:28966`
3. Playwright installed: `npx playwright install chromium`

### Default run (no broadcast — cancel at confirm dialog)

```bash
cd /media/runner/FILES/Phicoin_project/newUI/APP
npx playwright test
```

### Run with real PHI broadcast (self-send + asset issue)

```bash
ALLOW_BROADCAST=1 npx playwright test
```

### Run a specific spec

```bash
npx playwright test tests/e2e/send-receive.spec.ts
```

### Run with UI / headed mode

```bash
npx playwright test --headed
```

### List all discovered tests (no execution)

```bash
npx playwright test --list
```

---

## Known Gaps and Caveats

1. **Import via recovery phrase (mnemonic)**: The fixture `importEncryptedWallet` uses the JSON
   backup. A separate test using the 24-word phrase would require exposing the mnemonic for the
   test wallet; this is intentionally omitted for security.

2. **Idle-lock timeout**: The IDLE_AUTOLOCK_MS constant controls idle lock. A test that
   manipulates timers to trigger it in < 10s would require mocking `setTimeout` or a very
   short constant in test mode. The current tests verify the mechanism exists (cooldown message)
   but don't wait the full idle period.

3. **UTXO coin-control list**: The test checks that the From address selector is present.
   A full coin-control UTXO list test requires a funded address with multiple UTXOs; the funded
   wallet may consolidate into a single UTXO after prior sends.

4. **Asset round-trip (issue → list → send)**: With `ALLOW_BROADCAST=0` (default) these are
   only form-level tests. Full broadcast tests require `ALLOW_BROADCAST=1` and sufficient funds
   (~500 PHI per root asset issuance).

5. **BIP21 URI field selectors**: The Receive page uses generic placeholder text. If the input
   IDs change, the locators `input[placeholder*="Amount"]` may need updating. Prefer adding
   `data-testid` attributes in production.

6. **`wallet-create.spec.ts`**: The existing file tests the CreateWallet flow (mnemonic, quiz,
   Web Crypto API). It is preserved as-is and not replaced. The new `wallet-lifecycle.spec.ts`
   replaces and extends the old version of that file.
