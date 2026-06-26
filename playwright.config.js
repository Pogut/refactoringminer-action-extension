const { defineConfig } = require('@playwright/test');

// Browser E2E config — the project's only test suite. These tests load the real
// extension into Chromium and hit live github.com + gh-pages. Run with `npm test`
// (or `npm run test:headed` to watch it drive a real window).
module.exports = defineConfig({
  testDir: './test/e2e',
  // Live network + a real diff render; generous but bounded.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // One extension/profile per test and shared live endpoints — keep it serial so
  // a flaky network hit fails one test, not a parallel pile-up.
  fullyParallel: false,
  workers: 1,
  // GitHub/gh-pages can blip; one retry in CI smooths that without hiding real
  // breakage (a genuine selector/DOM regression fails both attempts).
  retries: process.env.CI ? 2 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    actionTimeout: 15_000,
    // Capture a trace on the first retry so a CI flake is debuggable after the fact.
    trace: 'on-first-retry',
  },
});
