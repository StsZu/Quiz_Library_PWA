import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4175',
    locale: 'uk-UA',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'webkit-ipad', use: { ...devices['iPad Pro 11'], browserName: 'webkit' }, testIgnore: /offline\.spec/ },
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'], browserName: 'webkit' }, testMatch: /(library|audit)\.spec/ },
    { name: 'chromium', use: { browserName: 'chromium' }, testMatch: /audit\.spec/ },
    { name: 'chromium-offline', use: { browserName: 'chromium', serviceWorkers: 'allow' }, testMatch: /offline\.spec/ },
  ],
  webServer: {
    command: 'npx vite build --mode test && npx vite preview --outDir dist-test --port 4175 --strictPort',
    url: 'http://localhost:4175',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
