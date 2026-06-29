// Playwright fixtures that boot a real Chromium with THIS extension loaded
// unpacked. MV3 extensions only load into a persistent context, so each test
// gets its own throwaway profile with the extension's content scripts + service
// worker live.
//
// Two flavours come out of one factory:
//   • `test`       — logged out. GitHub serves the classic /files table diff.
//   • `authedTest` — loads a saved GitHub session (see auth.js / capture-auth.js)
//                    so GitHub serves the new "Preview" /changes React diff.
const path = require('path');
const { test: base, chromium, expect } = require('@playwright/test');
const { authCookies } = require('./auth');

// The extension root = the directory holding manifest.json (two levels up).
const EXT_ROOT = path.resolve(__dirname, '..', '..');

// Headless by default (new headless mode loads extensions); set HEADED=1 to
// watch it drive a real window — handy when a selector breaks against live
// GitHub and you want to see what changed.
const HEADLESS = !process.env.HEADED;

// `authed` controls whether the context is logged in to GitHub. The two suites
// differ only by this flag, so the rest of the fixture is shared.
function makeTest(authed) {
  return base.extend({
    // A persistent context is mandatory for extensions; '' = ephemeral profile.
    context: async ({}, use) => {
      const context = await chromium.launchPersistentContext('', {
        channel: 'chromium', // new headless shell; required for MV3 extensions headless
        headless: HEADLESS,
        args: [
          `--disable-extensions-except=${EXT_ROOT}`,
          `--load-extension=${EXT_ROOT}`,
        ],
      });
      // Log the freshly-launched (extension-bearing) browser into GitHub by
      // injecting the captured session cookies — no login flow per run.
      if (authed) await context.addCookies(authCookies());
      await use(context);
      await context.close();
    },

    // The MV3 background service worker (src/service-worker.js) — it answers the
    // content script's feed-fetch messages. Surfacing it proves the extension
    // actually loaded and lets a test await it.
    serviceWorker: async ({ context }, use) => {
      let [sw] = context.serviceWorkers();
      if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20_000 });
      await use(sw);
    },

    // A page whose console is mirrored into `page.rmxLogs` (the extension logs
    // `[RMX] N refactorings, M line-spans highlighted`, which we assert on).
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
}

module.exports = { test: makeTest(false), authedTest: makeTest(true), expect };
