import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export const STORAGE_STATE_PATH = path.resolve('test-results/storageState.json');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: process.env.TEST_BASE_URL || 'http://localhost:13001',
    trace: 'retain-on-failure',
    // Most tests reuse the pre-imported wallet state via storageState
    storageState: STORAGE_STATE_PATH,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
