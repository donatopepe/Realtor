/**
 * Realtor — configurazione Playwright (E2E multi-viewport).
 *
 * Avvia due servizi reali:
 *   - `scripts/serve.js` sulla porta 8123 (app www/ come PWA, shim di cordova.js)
 *   - `server/src/server.js` sulla porta 8124 (API di riferimento, archivio in memoria)
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE).
 */

import { defineConfig, devices } from '@playwright/test';

const APP_PORT = Number(process.env.E2E_APP_PORT || 8123);
const API_PORT = Number(process.env.E2E_API_PORT || 8124);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Nei container/CI Chromium gira come root: il sandbox va disattivato.
    launchOptions: { args: ['--no-sandbox'] },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: [
    {
      command: `node scripts/serve.js --port ${APP_PORT} --quiet`,
      url: `http://127.0.0.1:${APP_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `node server/src/server.js --host 127.0.0.1 --port ${API_PORT} --memory --quiet`,
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  metadata: { apiUrl: `http://127.0.0.1:${API_PORT}/realtor/api/scheda` },
});
