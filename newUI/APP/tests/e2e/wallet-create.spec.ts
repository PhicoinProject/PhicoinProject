import { test, expect } from '@playwright/test';

// These tests require NO existing wallet in localStorage.
// Override the global storageState with an empty one so the app shows CreateWallet.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Wallet Creation Flow', () => {
  test('should show PHICOIN Wallet title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/PHICOIN/i);
  });

  test('should show CreateWallet page when no wallet exists', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Create PHICOIN Wallet/i)).toBeVisible({ timeout: 10000 });
  });

  test('should show 24-word mnemonic on step 1', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Use heading selector to avoid strict mode issues
    await expect(page.getByRole('heading', { name: /Recovery Phrase/i })).toBeVisible();

    // Should show 24 words text
    await expect(page.getByText(/24 words/i)).toBeVisible();

    // Should show numbered word slots in 4-column grid
    const wordSlots = page.locator('.grid.grid-cols-4 > div');
    const count = await wordSlots.count();
    expect(count).toBe(24);
  });

  test('should have Regenerate button', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    await expect(page.getByRole('button', { name: /Regenerate/i })).toBeVisible();
  });

  test('should have backup confirmation checkbox', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    await expect(page.getByLabel(/written down/i)).toBeVisible();
  });

  test('Next button should be disabled without confirming backup', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  test('should proceed to step 2 after confirming backup', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Check the backup confirmation
    await page.getByLabel(/written down/i).check({ force: true });

    // Wait for button to become enabled
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled({ timeout: 5000 });

    // Click Next
    await page.getByRole('button', { name: 'Next' }).click();

    // Should show Custom Seed step
    await expect(page.getByRole('heading', { name: /Custom Seed/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('should proceed to step 3 after entering custom seed', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Confirm backup and go to step 2
    await page.getByLabel(/written down/i).check({ force: true });
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: /Custom Seed/i })).toBeVisible({
      timeout: 5000,
    });

    // Enter custom seed (min 8 chars)
    const seedInput = page.getByLabel(/Custom Seed/i);
    await seedInput.fill('MySecretSeed123');
    await seedInput.press('Tab'); // trigger input change

    // Click Next
    await page.getByRole('button', { name: 'Next' }).click();

    // Should show Encryption Password step
    await expect(page.getByRole('heading', { name: /Encryption Password/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('should show password strength meter', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Navigate through steps
    await page.getByLabel(/written down/i).check({ force: true });
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: /Custom Seed/i })).toBeVisible({
      timeout: 5000,
    });

    await page.getByLabel(/Custom Seed/i).fill('MySecretSeed123');
    await page.getByLabel(/Custom Seed/i).press('Tab');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: /Encryption Password/i })).toBeVisible({
      timeout: 5000,
    });

    // Enter password
    await page.getByLabel(/^Password$/).fill('TestPassword123!');

    // Should show strength label
    await expect(page.getByText(/Weak|Fair|Strong|Very/i)).toBeVisible({ timeout: 5000 });
  });

  test('should show "Import existing wallet" link', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    await expect(page.getByRole('button', { name: /Import existing/i })).toBeVisible();
  });
});

test.describe('Wallet Import Page', () => {
  test('should navigate to import page', async ({ page }) => {
    await page.goto('/import');
    await page.waitForTimeout(2000);
    await expect(page.locator('#root')).toBeAttached();
  });

  test('should have restore from mnemonic option', async ({ page }) => {
    await page.goto('/import');
    await page.waitForTimeout(2000);
    const restoreText = page.getByText(/restore|mnemonic|recovery|word/i);
    await expect(restoreText.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Crypto Operations in Browser', () => {
  test('should have Web Crypto API available', async ({ page }) => {
    await page.goto('/');
    const hasCrypto = await page.evaluate(() => {
      return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
    });
    expect(hasCrypto).toBe(true);
  });

  test('should generate random values', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const arr = new Uint8Array(32);
      crypto.getRandomValues(arr);
      return Array.from(arr).some((b) => b > 0);
    });
    expect(result).toBe(true);
  });

  test('should support PBKDF2 key derivation', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      try {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
          'raw',
          enc.encode('test'),
          'PBKDF2',
          false,
          ['deriveBits']
        );
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const bits = await crypto.subtle.deriveBits(
          { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' },
          keyMaterial,
          256
        );
        return bits.byteLength === 32;
      } catch {
        return false;
      }
    });
    expect(result).toBe(true);
  });

  test('should support AES-GCM encryption', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      try {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
          'encrypt',
          'decrypt',
        ]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const enc = new TextEncoder();
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode('test'));
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        return new TextDecoder().decode(pt) === 'test';
      } catch {
        return false;
      }
    });
    expect(result).toBe(true);
  });
});

test.describe('Application Rendering', () => {
  test('should render without unexpected console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Filter out expected warnings
    const unexpectedErrors = errors.filter(
      (e) => !e.includes('React') && !e.includes('hydration') && !e.includes('Failed to load')
    );
    expect(unexpectedErrors).toHaveLength(0);
  });

  test('should have responsive layout', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Check that the CreateWallet card is visible
    const card = page.locator('[class*="shadow-lg"]');
    const count = await card.count();
    expect(count).toBeGreaterThan(0);
  });
});
