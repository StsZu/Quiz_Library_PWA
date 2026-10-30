// Smoke test of a deployed URL (task T013, SC-09): SMOKE_URL=https://… npx playwright test -c playwright.smoke.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/smoke',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.SMOKE_URL, locale: 'uk-UA' },
  projects: [
    { name: 'webkit-ipad', use: { ...devices['iPad Pro 11'], browserName: 'webkit' }, grep: /clean quiz audit/ },
    // Playwright cannot reload a WebKit page offline, so offline runs in Chromium as in the e2e suite.
    { name: 'chromium-offline', use: { browserName: 'chromium', serviceWorkers: 'allow' }, grep: /offline/ },
  ],
})
