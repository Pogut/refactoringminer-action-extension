// Real-browser end-to-end tests. For every sandbox PR we open the actual
// github.com diff with the extension loaded and assert the overlay paints from
// the live gh-pages feed — the full pipeline end to end: service-worker
// cross-origin fetch → content.js → real GitHub line cells.
//
// Assertions are derived from the live feed (sandbox.fetchFeed), not hard-coded,
// so a feed change surfaces as a real behaviour change rather than a stale
// number. What we pin is the contract: highlights appear, only on files the feed
// names, the legend shows, tooltips read the feed description, and an action
// comment-link hash selects the refactoring it points at.
const { test, expect } = require('./fixtures');
const sb = require('./sandbox');

// Wait for the overlay to finish its first paint. content.js logs
// `[RMX] N refactorings ...` when a render completes; the highlight cells appear
// just before. We wait on a painted cell so virtualization/feed latency is
// absorbed by Playwright's auto-retry rather than a fixed sleep.
async function waitForOverlay(page) {
  await page.waitForSelector('.rmx-hl', { timeout: 30_000 });
}

// First single-line right-side location in the feed — guaranteed paintable (a
// single line is never trimmed as an enclosing container) and addressable by the
// same hash the action's PR comment links use. Returns null if the feed has none.
function deepLinkTarget(refactorings) {
  for (const r of refactorings) {
    for (const loc of r.rightSideLocations || []) {
      if (loc.startLine === loc.endLine) {
        return { filePath: loc.filePath, line: loc.startLine, summaryType: r.type };
      }
    }
  }
  return null;
}

// The extension must actually have loaded — proven by its service worker being
// reachable — before any of the per-PR expectations make sense.
test('extension service worker boots', async ({ serviceWorker }) => {
  expect(serviceWorker.url()).toContain('service-worker.js');
});

for (const pr of sb.PRS) {
  test.describe(`PR #${pr.n} (${pr.lang})`, () => {
    test(`paints highlights from the live feed`, async ({ page }) => {
      const feed = await sb.fetchFeed(pr.n);
      const refactorings = sb.refactoringsOf(feed);
      const feedFiles = new Set();
      refactorings.forEach((r) => {
        (r.leftSideLocations || []).forEach((l) => feedFiles.add(l.filePath));
        (r.rightSideLocations || []).forEach((l) => feedFiles.add(l.filePath));
      });

      await page.goto(sb.filesUrl(pr.n), { waitUntil: 'domcontentloaded' });
      await waitForOverlay(page);

      // Something painted.
      const cells = page.locator('.rmx-hl');
      expect(await cells.count()).toBeGreaterThan(0);

      // Every painted cell belongs to a file the feed actually names — i.e. the
      // overlay never colours an unrelated line (a digest/selector mismatch
      // against live GitHub would surface here).
      const paintedFiles = await cells.evaluateAll((els) =>
        Array.from(new Set(els.map((e) => e.getAttribute('data-rmx-file')).filter(Boolean))),
      );
      expect(paintedFiles.length).toBeGreaterThan(0);
      for (const f of paintedFiles) expect(feedFiles).toContain(f);

      // The overlay reported the same refactoring count the feed carries.
      const reported = page.rmxLogs.find((l) => l.includes('refactorings'));
      expect(reported, `expected an [RMX] log; got ${JSON.stringify(page.rmxLogs)}`).toBeTruthy();
      expect(reported).toContain(`[RMX] ${refactorings.length} refactorings`);

      // Legend is shown (the diff has at least one categorised refactoring).
      await expect(page.locator('#rmx-legend')).toBeVisible();
      expect(await page.locator('#rmx-legend .rmx-lg-row').count()).toBeGreaterThan(0);
    });
  });
}

// Deeper UI behaviours, exercised once on the Python PR (richest feed) — keeping
// them off every PR keeps the live-network suite quick.
test.describe('PR #14 interactions', () => {
  const PR = 14;

  test('tooltip shows the refactoring description on hover', async ({ page }) => {
    await page.goto(sb.filesUrl(PR), { waitUntil: 'domcontentloaded' });
    await waitForOverlay(page);

    const cell = page.locator('.rmx-hl[data-rmx-desc]').first();
    const expected = await cell.getAttribute('data-rmx-desc');
    expect(expected, 'highlighted cell should carry a description').toBeTruthy();

    await cell.hover();
    const tip = page.locator('.rmx-tip');
    await expect(tip).toHaveText(expected, { timeout: 5_000 });
    await expect(tip).toHaveCSS('opacity', '1');
  });

  test('action comment-link hash selects the refactoring it points at', async ({ page }) => {
    const feed = await sb.fetchFeed(PR);
    const target = deepLinkTarget(sb.refactoringsOf(feed));
    expect(target, 'feed should have a single-line right location to deep-link to').toBeTruthy();

    const anchor = sb.lineAnchor(target.filePath, 'R', target.line);
    await page.goto(`${sb.filesUrl(PR)}#${anchor}`, { waitUntil: 'domcontentloaded' });
    await waitForOverlay(page);

    // The deep-linked line cell must exist, be highlighted, and become the
    // neon-selected refactoring (content.js handleDeepLink → overlay.select).
    const cell = page.locator(`#${anchor}, [data-line-anchor="${anchor}"]`).first();
    await expect(cell).toHaveClass(/rmx-hl/, { timeout: 10_000 });
    await expect(cell).toHaveClass(/rmx-sel/, { timeout: 10_000 });
  });
});
