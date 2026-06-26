// Playwright test fixture that boots a real Chromium with THIS extension loaded
// unpacked, the way a user would via chrome://extensions → Load unpacked. MV3
// extensions only load into a persistent context, so each test gets its own
// throwaway profile with the extension's content scripts + service worker live.
//
// Loading rules (Chromium): an unpacked extension needs --load-extension and,
// because the diff overlay relies on its background service worker to fetch the
// gh-pages feed cross-origin, the service worker must be running before we
// navigate. The `serviceWorker` fixture waits for exactly that.
const path = require('path');
const { test: base, chromium, expect } = require('@playwright/test');

// The extension root = the directory holding manifest.json (two levels up).
const EXT_ROOT = path.resolve(__dirname, '..', '..');

// Headless by default (new headless mode loads extensions); set HEADED=1 to
// watch it drive a real window — handy when a selector breaks against live
// GitHub and you want to see what changed.
const HEADLESS = !process.env.HEADED;

const test = base.extend({
  // A persistent context is mandatory for extensions; '' = ephemeral profile dir.
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // new headless shell; required for MV3 extensions headless
      headless: HEADLESS,
      args: [
        `--disable-extensions-except=${EXT_ROOT}`,
        `--load-extension=${EXT_ROOT}`,
      ],
    });
    await use(context);
    await context.close();
  },

  // The MV3 background service worker (src/service-worker.js) — it answers the
  // content script's feed-fetch messages. Surfacing it here both proves the
  // extension actually loaded and lets a test inspect/await it if needed.
  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20_000 });
    await use(sw);
  },

  // A page whose console is mirrored into `page.rmxLogs` (the extension logs
  // `[RMX] N refactorings, M line-spans highlighted`, which we assert on), so
  // tests can read back what the overlay reported without re-deriving it.
  page: async ({ context, serviceWorker }, use) => {
    const page = await context.newPage();
    page.rmxLogs = [];
    page.on('console', (msg) => {
      const t = msg.text();
      if (t.startsWith('[RMX]')) page.rmxLogs.push(t);
    });
    await use(page);
    await page.close();
  },
});

module.exports = { test, expect };
