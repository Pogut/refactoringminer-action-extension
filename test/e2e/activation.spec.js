// Auto-activation on ARRIVAL, which is the case a content script makes easy to
// get wrong: it is injected when a DOCUMENT loads and never again, while GitHub
// moves between pages with pushState. Reaching a diff from the repo page, the
// pull list, or a notification therefore loads no document, and the manifest's
// patterns cover only the diff URLs — so the script was simply not there when
// the reader arrived. Auto-activation had nothing to run and the toolbar button
// had no receiver, so the page had to be reloaded before either worked.
// service-worker.js now injects on demand for exactly that gap.
//
// Logged out, so no captured session is needed; the arrival path being tested is
// the same one the signed-in React UI uses.
const { test, expect } = require('./fixtures');
const sb = require('./sandbox');

const REPO_HOME = `https://github.com/${sb.OWNER}/${sb.REPO}`;
const PR = 9;

// Turn on the setting the options page writes, from the service worker (which
// shares the extension's storage with the content script).
async function enableAutoTrigger(serviceWorker) {
  await serviceWorker.evaluate(
    () => new Promise((r) => chrome.storage.sync.set({ autoTrigger: true }, r)),
  );
}

test('auto-activates on a diff reached by client-side navigation, with no reload', async ({
  page,
  serviceWorker,
}) => {
  test.setTimeout(120_000);
  await enableAutoTrigger(serviceWorker);

  // Land somewhere that is NOT a diff. This is the document that gets the
  // content script; everything after it happens without another one.
  await page.goto(REPO_HOME, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#rmx-report')).toHaveCount(0);

  // Navigate the way GitHub's own router does — URL swapped in place, no load.
  await page.evaluate((path) => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/${sb.OWNER}/${sb.REPO}/pull/${PR}/files`);

  // The panel must appear off the back of that navigation alone.
  await expect(page.locator('#rmx-report')).toBeVisible({ timeout: 60_000 });
  await page.locator('#rmx-report .rmx-rp-row').first().waitFor({ timeout: 60_000 });
  expect(await page.locator('#rmx-report .rmx-rp-row').count()).toBeGreaterThan(0);
});

test('the toolbar button reaches a diff reached by client-side navigation', async ({
  page,
  serviceWorker,
}) => {
  test.setTimeout(120_000);
  // Click-to-activate mode (autoTrigger left off): the button is the only way
  // in, so it must find a receiver on arrival. Sending to a page with no content
  // script rejects with "Could not establish connection. Receiving end does not
  // exist." — which the service worker swallows, leaving the button simply dead.
  await page.goto(REPO_HOME, { waitUntil: 'domcontentloaded' });
  await page.evaluate((path) => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/${sb.OWNER}/${sb.REPO}/pull/${PR}/files`);

  // Deliberately no wait: pressing the button straight after arriving must work
  // whether or not the navigation's own injection has landed yet, so this runs
  // the handler the toolbar runs rather than re-implementing it here.
  await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await activateTab(tab);
  });
  await expect(page.locator('#rmx-report')).toBeVisible({ timeout: 60_000 });
  await page.locator('#rmx-report .rmx-rp-row').first().waitFor({ timeout: 60_000 });
});

test('stays inert on the GitHub pages it does not overlay', async ({ page, serviceWorker }) => {
  // The on-demand injection is keyed off the URL, so the pages that are not
  // diffs must come away untouched: no panel, and not even a stylesheet.
  await enableAutoTrigger(serviceWorker);
  for (const url of [REPO_HOME, `${REPO_HOME}/pulls`, `${REPO_HOME}/pull/${PR}`]) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3_000); // past schedule()'s 300 ms debounce and then some
    expect(await page.locator('#rmx-report').count(), `${url} should not be overlaid`).toBe(0);
    expect(await page.locator('#rmx-style').count(), `${url} should inject no styles`).toBe(0);
  }
});

test('a normal document load is injected exactly once', async ({ page, serviceWorker }) => {
  // The on-demand path fires on the same `complete` event a real page load
  // raises, so it has to recognise the declarative copy already running and
  // leave it alone. Two copies would mean two URL pollers and two analyses.
  test.setTimeout(120_000);
  await enableAutoTrigger(serviceWorker);
  const loads = [];
  page.on('console', (m) => {
    if (m.text().includes('content script loaded')) loads.push(m.text());
  });
  await page.goto(`${REPO_HOME}/pull/${PR}/files`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#rmx-report')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(5_000); // let any second injection show up
  expect(loads, `expected one injection, got ${JSON.stringify(loads)}`).toHaveLength(1);
  expect(await page.locator('#rmx-report').count()).toBe(1);
});
