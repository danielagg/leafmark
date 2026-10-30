import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests', fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev -- --port 4173 --strictPort', env: { VITE_STORAGE_MODE: 'local' }, url: 'http://127.0.0.1:4173', reuseExistingServer: true },
});
