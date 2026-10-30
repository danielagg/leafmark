import { defineConfig, devices } from '@playwright/test';

try { process.loadEnvFile('.env.local'); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

export default defineConfig({
  testDir: './tests-cloud', testMatch: '**/*.spec.ts', workers: 1,
  timeout: 120_000,
  use: {
    baseURL: process.env.LEAFMARK_TEST_URL || 'http://127.0.0.1:4174',
    // Authentication credentials must never be written to a trace or video.
    trace: 'off', screenshot: 'off', video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.LEAFMARK_TEST_URL ? undefined : {
    command: 'npm run dev -- --port 4174 --strictPort',
    env: { VITE_STORAGE_MODE: 'cloud' },
    url: 'http://127.0.0.1:4174', reuseExistingServer: false,
  },
});
