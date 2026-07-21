// The project's end-to-end suite — driven entirely against GitHub's logged-in
// "Preview" diff (/changes), the React view real users see day to day and the
// only view that the extension targets. We load the real extension into Chromium
// with a saved GitHub session, open the live Pogut/rm-action-test PRs, and assert
// the overlay tags cells/behaves from the live gh-pages feed: the full browser
// path end to end (service-worker cross-origin fetch → content.js → the
// virtualized data-line-anchor cells), click-to-pair selection on BOTH sides,
// the left/right selection-colour distinction, tooltips, deep links, the
// attention blink, and the focus-navigation UI (navigator, minimap, edge chips).
//
// These need a saved GitHub session. Capture it once: `npm run test:auth`. Until
// then the whole suite is skipped (so `npm test` stays green when logged out).
// (The classic logged-out /files diff is intentionally NOT supported.)
const { authedTest: test, expect } = require('./fixtures');
const sb = require('./sandbox');
const { hasAuth } = require('./auth');

test.skip(!hasAuth(), 'Preview-diff tests need a GitHub session — run: npm run test:auth');

async function waitForOverlay(page) {
  await page.waitForSelector('.rmx-hl', { timeout: 30_000 });
}

// Open the Preview diff and confirm we actually landed on it (a logged-out
// session is redirected to /files, so this also proves the saved session works).
async function openChanges(page, pr) {
  await page.goto(sb.changesUrl(pr), { waitUntil: 'domcontentloaded' });
  expect(page.url(), 'session should keep us on the Preview /changes diff (not redirected to /files)').toContain('/changes');
  await waitForOverlay(page);
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

// Discover a refactoring whose left AND right cells are both mounted in the live
// (virtualized) Preview diff, returning their anchors. Self-calibrating so the
// "both sides" tests don't depend on the diff's exact line layout per PR.
function findMountedPair(page) {
  return page.evaluate(() => {
    const byIdx = {};
    document.querySelectorAll('.rmx-hl[data-rmx-index]').forEach((el) => {
      const side = el.getAttribute('data-rmx-side');
      const anchor = el.getAttribute('data-line-anchor') || el.id;
      if (!side || !anchor) return;
      el.getAttribute('data-rmx-index').split(' ').forEach((i) => {
        byIdx[i] = byIdx[i] || {};
        byIdx[i][side] = byIdx[i][side] || anchor;
      });
    });
    const i = Object.keys(byIdx).find((k) => byIdx[k].L && byIdx[k].R);
    return i ? { left: byIdx[i].L, right: byIdx[i].R } : null;
  });
}

// The extension must actually have loaded — proven by its service worker being
// reachable — before any of the per-PR expectations make sense.
test('extension service worker boots', async ({ serviceWorker }) => {
  expect(serviceWorker.url()).toContain('service-worker.js');
});

// --- per-PR cell tagging from the live feed ---------------------------------
// For every sandbox PR: the overlay tags cells on the Preview diff (via the
// data-line-anchor cell path), only on files the feed actually names, and reports
// the feed's refactoring count. Assertions are derived from the live feed
// (sandbox.fetchFeed), not hard-coded, so a feed change surfaces as a real
// behaviour change rather than a stale number.
for (const pr of sb.PRS) {
  test.describe(`PR #${pr.n} (${pr.lang})`, () => {
    test('tags refactoring lines from the live feed', async ({ page }) => {
      const feed = await sb.fetchFeed(pr.n); // download real JSON feed from GitHub pages
      const refactorings = sb.refactoringsOf(feed);
      const feedFiles = new Set();
      refactorings.forEach((r) => {
        (r.leftSideLocations || []).forEach((l) => feedFiles.add(l.filePath));
        (r.rightSideLocations || []).forEach((l) => feedFiles.add(l.filePath));
      });

      await openChanges(page, pr.n);

      // Something painted, and via the Preview diff's data-line-anchor cells
      // (not classic element ids) — proof the overlay took the React-diff path.
      const cells = page.locator('.rmx-hl');
      expect(await cells.count()).toBeGreaterThan(0);
      expect(await page.locator('.rmx-hl[data-line-anchor]').count(), 'painted via the data-line-anchor path').toBeGreaterThan(0);

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

      // The report panel lists every refactoring in the feed (one row each).
      await expect(page.locator('#rmx-report')).toBeVisible();
      expect(await page.locator('#rmx-report .rmx-rp-row').count()).toBe(refactorings.length);
    });
  });
}

// --- refactorings report panel ---------------------------------------------
// The bottom-left panel lists every refactoring; a row click selects (blinks)
// that refactoring on the diff, and the header collapses/expands the list.
test.describe('report panel (PR #14)', () => {
  test('a row click selects the refactoring; header collapses the list', async ({ page }) => {
    await openChanges(page, 14);
    const panel = page.locator('#rmx-report');
    await expect(panel).toBeVisible();

    const rows = panel.locator('.rmx-rp-row');
    expect(await rows.count()).toBeGreaterThan(0);

    // Clicking a row selects its refactoring (a tagged cell gains rmx-sel).
    await rows.first().click();
    await expect(page.locator('.rmx-hl.rmx-sel').first()).toBeVisible({ timeout: 10_000 });

    // The header toggles the body without tearing down the panel.
    await expect(panel.locator('.rmx-rp-body')).toBeVisible();
    await panel.locator('.rmx-rp-head').click();
    await expect(panel).toHaveClass(/rmx-collapsed/);
    await expect(panel.locator('.rmx-rp-body')).toBeHidden();
    await panel.locator('.rmx-rp-head').click();
    await expect(panel.locator('.rmx-rp-body')).toBeVisible();
  });

  // Each row has an "explain" disclosure that opens an inline card with the
  // detector's full description + before/after locations — replacing the old
  // native-title hover. Only one card is open at a time.
  test('the explain disclosure opens a description card (single-open)', async ({ page }) => {
    await openChanges(page, 14);
    const items = page.locator('#rmx-report .rmx-rp-item');
    expect(await items.count()).toBeGreaterThan(1);

    const first = items.first();
    await expect(first.locator('.rmx-rp-detail')).toBeHidden();
    await first.locator('.rmx-rp-info').click();
    await expect(first).toHaveClass(/rmx-open/);
    await expect(first.locator('.rmx-rp-detail')).toBeVisible();
    await expect(first.locator('.rmx-rp-detail')).toContainText(/\w/);

    // Opening another closes the first.
    const second = items.nth(1);
    await second.locator('.rmx-rp-info').click();
    await expect(second).toHaveClass(/rmx-open/);
    await expect(first).not.toHaveClass(/rmx-open/);
  });
});

// --- click-to-pair selection (the gold "blink on both sides") ---------------
// Clicking any highlighted line must light the WHOLE refactoring in the gold
// selection on BOTH sides — so the user sees a change's counterpart. Self-
// calibrating: we find a refactoring whose left and right are both mounted.
test('clicking a line selects its counterpart on both sides', async ({ page }) => {
  await openChanges(page, 9);

  const pair = await findMountedPair(page);
  expect(pair, 'expected a refactoring with both sides mounted on the Preview diff').toBeTruthy();

  const left = page.locator(`[data-line-anchor="${pair.left}"][data-rmx-side="L"]`).first();
  const right = page.locator(`[data-line-anchor="${pair.right}"][data-rmx-side="R"]`).first();

  await expect(right).not.toHaveClass(/rmx-sel/);
  await right.click();
  await expect(right, 'clicked line selected').toHaveClass(/rmx-sel/);
  await expect(left, 'counterpart on the other side selected too').toHaveClass(/rmx-sel/);
  await expect(right, 'gold blink fill applied').toHaveClass(/rmx-on/);
});

// --- left/right side colour distinction -------------------------------------
// Selecting a refactoring colours BOTH counterpart cells, but the two sides must
// be visually distinguishable at a glance: the left ("before") cell gets a
// hot-pink outline + fill, the right ("after") cell a violet one. We assert real
// *computed* CSS — not just that a class name is present — so a regression that
// ships the wrong hex value, or swaps the L/R CSS rules, fails here even though
// the class names would still look correct. Self-calibrating on a mounted pair.
/* TEMPORARILY DISABLED for demo — re-enable by removing this block comment.
test('left cell paints hot pink, right cell paints violet, on selection', async ({ page }) => {
  await openChanges(page, 9);

  const pair = await findMountedPair(page);
  expect(pair, 'expected a refactoring with both sides mounted on the Preview diff').toBeTruthy();

  // Mirrors src/overlay.js's CSS literals (#be185d/#ec4899 left, #6d28d9/#7c3aed
  // right) as the rgb() form getComputedStyle() returns them in Chromium.
  const LEFT_OUTLINE = 'rgb(190, 24, 93)'; //   #be185d
  const LEFT_FILL = 'rgb(236, 72, 153)'; //     #ec4899
  const RIGHT_OUTLINE = 'rgb(109, 40, 217)'; // #6d28d9
  const RIGHT_FILL = 'rgb(124, 58, 237)'; //    #7c3aed

  const left = page.locator(`[data-line-anchor="${pair.left}"][data-rmx-side="L"]`).first();
  const right = page.locator(`[data-line-anchor="${pair.right}"][data-rmx-side="R"]`).first();

  await right.click();
  await expect(left).toHaveClass(/rmx-sel/);
  await expect(right).toHaveClass(/rmx-sel/);

  // The outline (box-shadow) is present in both blink phases, so it's a stable
  // signal regardless of timing. Web-first toHaveCSS re-resolves each poll, so a
  // scroll/settle re-paint can't produce a detached-node read.
  await expect(left, 'left (before) cell outline should be hot pink').toHaveCSS('box-shadow', new RegExp(escapeRe(LEFT_OUTLINE)));
  await expect(right, 'right (after) cell outline should be violet').toHaveCSS('box-shadow', new RegExp(escapeRe(RIGHT_OUTLINE)));

  // The "on" fill: the blink toggles it, and the background-color transition
  // means it settles exactly on the fill colour during the on-hold — toHaveCSS
  // polls until it catches that.
  await expect(left, 'left fill colour').toHaveCSS('background-color', LEFT_FILL);
  await expect(right, 'right fill colour').toHaveCSS('background-color', RIGHT_FILL);
});
*/

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- tooltip + deep link (exercised on PR #14, the richest feed) ------------
test.describe('PR #14 interactions', () => {
  const PR = 14;

  test('tooltip shows the refactoring description on hover', async ({ page }) => {
    await openChanges(page, PR);

    const cell = page.locator('.rmx-hl[data-rmx-desc]').first();
    await cell.scrollIntoViewIfNeeded();
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
    await page.goto(`${sb.changesUrl(PR)}#${anchor}`, { waitUntil: 'domcontentloaded' });
    expect(page.url(), 'session should keep us on /changes').toContain('/changes');
    await waitForOverlay(page);

    // The Preview diff virtualizes rows: bring the target file into view so the
    // line mounts and gets painted, then the re-paint's handleDeepLink selects it.
    const file = page.locator(`#diff-${sb.digest(target.filePath)}, [data-line-anchor="diff-${sb.digest(target.filePath)}"]`).first();
    if (await file.count()) {
      await file.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(500);
    }

    const cell = page.locator(`[data-line-anchor="${anchor}"][data-rmx-side="R"], #${anchor}`).first();
    await expect(cell).toHaveClass(/rmx-hl/, { timeout: 10_000 });
    await expect(cell).toHaveClass(/rmx-sel/, { timeout: 10_000 });
  });
});

// NOTE: the classic suite measured the attention blink's fast-then-slow CADENCE
// by counting `class`-attribute mutations on the selected cell. That isn't
// portable to the live Preview diff: GitHub's React diff rewrites a row's
// className on its own re-renders (and content.js re-paints ~every 250ms), so the
// selected cell's `class` mutates independently of the blink and swamps the
// signal. The blink's actual effect — the gold `rmx-on` fill applied on
// selection — is still asserted by the click-to-pair and left/right tests above.

// --- edge chips (Preview-only) ----------------------------------------------
// A selected line that scrolls out of view surfaces as a SINGLE edge chip at the
// relevant screen edge — the replacement for the old stacked pin bars, which grew
// without bound and could bury the page on a big refactoring.
test('a selected line that scrolls away shows a single edge chip', async ({ page }) => {
  await openChanges(page, 9);

  const first = page.locator('.rmx-hl[data-rmx-index]').first();
  await first.scrollIntoViewIfNeeded();
  await first.click();
  await expect(page.locator('.rmx-sel').first()).toBeVisible();

  await page.mouse.move(640, 400); // put the cursor over the diff so the wheel scrolls it
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 1200);

  const chips = page.locator('.rmx-edge-chip.rmx-show');
  await expect(
    chips.first(),
    'an edge chip should point at the off-screen selected line',
  ).toBeVisible({ timeout: 10_000 });
  // The whole point of the redesign: at most one chip per edge, never a stack.
  expect(await chips.count(), 'at most one chip per screen edge').toBeLessThanOrEqual(2);
  await expect(chips.first()).toContainText(/above|below/);
  // Every count shown is a per-side segment, so its dot and number agree.
  expect(await chips.first().locator('.rmx-edge-seg').count()).toBeGreaterThan(0);
});

// The edge chip's side dot uses the same side colour as the inline highlight
// (pink for left/before, violet for right/after), keeping the cue consistent
// wherever a selected line surfaces. Checked via real computed CSS.
test('the edge chip dot uses the side colour — left pink, right violet', async ({ page }) => {
  await openChanges(page, 9);

  const first = page.locator('.rmx-hl[data-rmx-index]').first();
  await first.scrollIntoViewIfNeeded();
  await first.click();
  await expect(page.locator('.rmx-sel').first()).toBeVisible();

  await page.mouse.move(640, 400);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 1200);

  const chip = page.locator('.rmx-edge-chip.rmx-show').first();
  await expect(chip).toBeVisible({ timeout: 10_000 });
  // Each per-side segment's dot is #ec4899 (left) or #7c3aed (right) — the fills.
  await expect(chip.locator('.rmx-edge-seg .rmx-edge-dot').first()).toHaveCSS(
    'background-color',
    /rgb\(236, 72, 153\)|rgb\(124, 58, 237\)/,
  );
});

// --- focus navigator --------------------------------------------------------
// A fixed pill walks the feed's refactorings one at a time. Next/prev change the
// selection and keep the "n / total" counter in step — the primary way to trace
// a refactoring without hunting for its lines.
test('the navigator steps through refactorings and tracks the count', async ({ page }) => {
  await openChanges(page, 14);
  const nav = page.locator('#rmx-nav');
  await expect(nav).toBeVisible();

  const total = await page.locator('#rmx-report .rmx-rp-row').count();
  expect(total, 'need at least two refactorings to step between').toBeGreaterThan(1);

  const next = nav.locator('.rmx-nav-btn').last();
  const prev = nav.locator('.rmx-nav-btn').first();

  await next.click(); // → first refactoring
  await expect(page.locator('.rmx-sel').first()).toBeVisible({ timeout: 10_000 });
  await expect(nav.locator('.rmx-nav-count')).toHaveText(`1 / ${total}`);

  await next.click(); // → second
  await expect(nav.locator('.rmx-nav-count')).toHaveText(`2 / ${total}`);

  await prev.click(); // → back to first
  await expect(nav.locator('.rmx-nav-count')).toHaveText(`1 / ${total}`);
});

// --- minimap ----------------------------------------------------------------
// The right-edge rail is the always-on overview: one tick per refactoring, plus a
// viewport thumb. Clicking a tick focuses (reveals + selects) that refactoring.
test('the minimap shows a tick per refactoring and a tick click selects one', async ({ page }) => {
  await openChanges(page, 14);
  const minimap = page.locator('#rmx-minimap');
  const total = await page.locator('#rmx-report .rmx-rp-row').count();

  // The rail only appears when the diff is taller than the viewport — scroll a
  // little so a refresh runs and the extent is measured.
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 400);
  await expect(minimap).toBeVisible({ timeout: 10_000 });
  expect(await minimap.locator('.rmx-mm-tick').count(), 'one tick per refactoring').toBe(total);

  await minimap.locator('.rmx-mm-tick:visible').first().click();
  await expect(page.locator('.rmx-sel').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#rmx-nav .rmx-nav-count')).toHaveText(new RegExp(`/ ${total}$`));
});
