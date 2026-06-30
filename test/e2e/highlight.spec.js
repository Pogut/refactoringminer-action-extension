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

// The clickable source cell for a line. The classic diff puts the `diff-<…>` id on
// the line-*number* <td>; the actual code (what a user clicks) is the row's
// sibling .blob-code cell, possibly past an empty-cell spacer. Clicking the code
// cell — not the number cell — avoids triggering GitHub's own line-anchor handler.
function codeCellOf(page, anchor) {
  return page.locator(`xpath=//td[@id="${anchor}"]/following-sibling::td[contains(@class,"blob-code")][1]`);
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

// --- colour correctness ----------------------------------------------------
// Pin specific lines to the exact category (colour) the overlay must paint. The
// expectations live in sandbox.js (sb.COLOURS), shared with the Preview suite so
// both views must agree. If categorize() regresses, the exact line that changed
// colour fails — by name.
for (const pr of [...new Set(sb.COLOURS.map((c) => c.pr))]) {
  test(`PR #${pr}: each line carries the colour matching its refactoring`, async ({ page }) => {
    await page.goto(sb.filesUrl(pr), { waitUntil: 'domcontentloaded' });
    await waitForOverlay(page);
    for (const c of sb.COLOURS.filter((x) => x.pr === pr)) {
      const where = `${c.what} @ ${c.file} ${c.side}${c.line}`;
      const cell = page.locator(`#${sb.lineAnchor(c.file, c.side, c.line)}`);
      await expect(cell, `${where}: should be highlighted`).toHaveClass(/rmx-hl/);
      await expect(cell, `${where}: expected colour "${c.cat}"`).toHaveAttribute('data-rmx-cat', c.cat);
    }
  });
}

// --- click-to-pair selection (the gold "blink on both sides") --------------
// Clicking any highlighted line must light the WHOLE refactoring in the gold
// selection on BOTH sides — so the user sees a change's counterpart. We use a
// Move Attribute in PR #9: its source (left) and destination (right) are
// different files/lines, so "both sides lit" is unambiguous.
test.describe('click-to-pair selection', () => {
  const PR = 9;
  const SRC = sb.lineAnchor('CustomerProfile.java', 'L', 3); // movedOut (source)
  const DST = sb.lineAnchor('Address.java', 'R', 2); //         movedIn (destination)

  test('clicking the right side lights the left counterpart', async ({ page }) => {
    await page.goto(sb.filesUrl(PR), { waitUntil: 'domcontentloaded' });
    await waitForOverlay(page);
    const src = page.locator(`#${SRC}`);
    const dst = page.locator(`#${DST}`);

    // Both painted, nothing selected yet.
    await expect(src).toHaveClass(/rmx-hl/);
    await expect(dst).toHaveClass(/rmx-hl/);
    await expect(src).not.toHaveClass(/rmx-sel/);

    await codeCellOf(page, DST).click(); // click the destination line (right side)

    await expect(dst, 'clicked line is selected').toHaveClass(/rmx-sel/);
    await expect(src, 'counterpart on the OTHER side is selected too').toHaveClass(/rmx-sel/);
    // The gold "on" fill is applied (it blinks; the class appears on the cell).
    await expect(dst, 'gold blink fill applied').toHaveClass(/rmx-on/);
  });

  test('clicking the left side lights the right counterpart', async ({ page }) => {
    await page.goto(sb.filesUrl(PR), { waitUntil: 'domcontentloaded' });
    await waitForOverlay(page);
    const src = page.locator(`#${SRC}`);
    const dst = page.locator(`#${DST}`);

    await codeCellOf(page, SRC).click(); // click the source line (left side)

    await expect(src, 'clicked line is selected').toHaveClass(/rmx-sel/);
    await expect(dst, 'counterpart on the OTHER side is selected too').toHaveClass(/rmx-sel/);
  });
});

// --- left/right side colour distinction -------------------------------------
// Selecting a refactoring colours BOTH counterpart cells, but the two sides
// must be visually distinguishable at a glance: the left ("before") cell gets
// a hot-pink outline + fill, the right ("after") cell gets a violet one. We
// assert real *computed* CSS — not just that a class name is present — so a
// regression that ships the wrong hex value, or swaps the L/R CSS rules,
// fails here even though the class names would still look correct.
//
// Re-uses PR #9's Move Attribute pair from the click-to-pair test above
// (source=left in CustomerProfile.java, destination=right in Address.java —
// different files), so "which cell is left vs right" is unambiguous.
test.describe('left/right side colour distinction', () => {
  const PR = 9;
  const SRC = sb.lineAnchor('CustomerProfile.java', 'L', 3); // movedOut (source, LEFT)
  const DST = sb.lineAnchor('Address.java', 'R', 2); //         movedIn (destination, RIGHT)

  // Mirrors src/overlay.js's CSS literals (#be185d/#ec4899 left, #6d28d9/#7c3aed
  // right) as the rgb() form getComputedStyle() returns them in Chromium.
  const LEFT_OUTLINE = 'rgb(190, 24, 93)'; //   #be185d
  const LEFT_FILL = 'rgb(236, 72, 153)'; //     #ec4899
  const RIGHT_OUTLINE = 'rgb(109, 40, 217)'; // #6d28d9
  const RIGHT_FILL = 'rgb(124, 58, 237)'; //    #7c3aed

  test('left cell paints hot pink, right cell paints violet, on selection', async ({ page }) => {
    await page.goto(sb.filesUrl(PR), { waitUntil: 'domcontentloaded' });
    await waitForOverlay(page);

    await codeCellOf(page, DST).click(); // selects both SRC (left) and DST (right)

    const src = page.locator(`#${SRC}`);
    const dst = page.locator(`#${DST}`);
    await expect(src).toHaveClass(/rmx-sel/);
    await expect(dst).toHaveClass(/rmx-sel/);

    // The outline (box-shadow) is present in both blink phases, so it's a
    // stable signal regardless of timing. Checked as a substring because the
    // shorthand also carries the offset/blur/spread values around the colour.
    const srcShadow = await src.evaluate((el) => getComputedStyle(el).boxShadow);
    const dstShadow = await dst.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(srcShadow, 'left (before) cell outline should be hot pink').toContain(LEFT_OUTLINE);
    expect(dstShadow, 'right (after) cell outline should be violet').toContain(RIGHT_OUTLINE);

    // select() sets blinkOn = true synchronously, before any timer fires, so
    // the "on" fill is already applied by the time .click() resolves —
    // checking it needs no wait (same guarantee the click-to-pair test above
    // relies on for `rmx-on`).
    await expect(src, 'left cell carries the on-phase class').toHaveClass(/rmx-on/);
    await expect(dst, 'right cell carries the on-phase class').toHaveClass(/rmx-on/);
    await expect(src, 'left fill colour').toHaveCSS('background-color', LEFT_FILL);
    await expect(dst, 'right fill colour').toHaveCSS('background-color', RIGHT_FILL);
  });
});

// --- attention blink: fast first, then settles into a slow pulse -----------
// On selection the fill blinks fast for a few cycles to catch the user's eye,
// then settles into the slow synced pulse shared with the pinned bars
// (src/overlay.js: ATTENTION_BLINKS, BLINK_FAST_MS, BLINK_MS). Exact timings
// are a UX-tuning detail, so rather than pinning millisecond gaps we assert
// the SHAPE of the toggle-rate curve: many class-toggle events bunched in the
// first ~1.5s, then a clearly lower rate for the next ~2.5s. That holds even
// if the constants are retuned by ~100ms, and only breaks if the fast-then-
// slow behaviour itself regresses (e.g. reverting to one constant rate).
//
// Measurement: a MutationObserver is attached to the selected cell's `class`
// attribute from INSIDE the page (page.evaluate), not polled from Playwright,
// so the captured timestamps reflect real browser timer/paint timing instead
// of Playwright↔browser round-trip jitter. Every classList.add/toggle call in
// overlay.js's select()/fastTick()/slowTick() mutates `class`; synchronous
// mutations to the same attribute within one task coalesce into a single
// MutationObserver record, so one record == one user-visible blink state
// change (the very first record is the click itself).
//
// page.evaluate's returned promise only resolves once the in-page promise
// does (after the full observation window), so it's started WITHOUT an
// `await` and raced against the click via Promise.all — awaiting it first
// would block Playwright before the click ever happened.
test.describe('attention blink (fast-then-slow)', () => {
  const PR = 9;
  const TARGET = sb.lineAnchor('CustomerProfile.java', 'L', 3);
  const FAST_WINDOW_MS = 1500; //   generous vs. the ~1s attention phase the feature targets
  const TOTAL_OBSERVE_MS = 4000; // FAST_WINDOW_MS + a slow-phase sampling window

  test('toggles several times quickly, then drops to a slow steady pulse', async ({ page }) => {
    await page.goto(sb.filesUrl(PR), { waitUntil: 'domcontentloaded' });
    await waitForOverlay(page);

    const [timestamps] = await Promise.all([
      page.evaluate(
        ({ sel, totalMs }) =>
          new Promise((resolve) => {
            const target = document.querySelector(sel);
            const t0 = performance.now();
            const stamps = [];
            const mo = new MutationObserver(() => stamps.push(performance.now() - t0));
            mo.observe(target, { attributes: true, attributeFilter: ['class'] });
            setTimeout(() => {
              mo.disconnect();
              resolve(stamps);
            }, totalMs);
          }),
        { sel: `#${TARGET}`, totalMs: TOTAL_OBSERVE_MS },
      ),
      (async () => {
        await page.waitForTimeout(50); // let the observer attach before the click fires
        await codeCellOf(page, TARGET).click();
      })(),
    ]);

    expect(timestamps.length, `expected several class-toggle events, got ${JSON.stringify(timestamps)}`).toBeGreaterThan(3);

    const fast = timestamps.filter((t) => t <= FAST_WINDOW_MS);
    const slow = timestamps.filter((t) => t > FAST_WINDOW_MS);

    // Attention phase = 3 blinks = 6 toggles, plus the initial click toggle =
    // 7 events expected; assert a generous lower bound so CI jitter can't flake it.
    expect(
      fast.length,
      `expected several fast toggles within ${FAST_WINDOW_MS}ms, got ${JSON.stringify(timestamps)}`,
    ).toBeGreaterThanOrEqual(5);

    // Each gap between fast-phase toggles should be well under the slow
    // pulse's 2500ms half-cycle — this characterises them as actually "fast",
    // not merely "early".
    const fastGaps = fast.slice(1).map((t, i) => t - fast[i]);
    for (const gap of fastGaps) {
      expect(gap, `fast-phase gap of ${gap}ms should be well under the slow pulse rate`).toBeLessThan(600);
    }

    // After the attention window the toggle rate must drop sharply: a steady
    // pulse ticks roughly once per 2500ms half-cycle, so at most a couple of
    // slow-phase ticks should land in the remaining ~2.5s.
    expect(
      slow.length,
      `expected the blink to slow down after ${FAST_WINDOW_MS}ms, got ${JSON.stringify(timestamps)}`,
    ).toBeLessThanOrEqual(2);

    // The core contract: toggle RATE during attention must be unambiguously
    // higher than the steady-state rate — not just "more events" (a longer
    // window would trivially have more), but more per second.
    const fastRate = fast.length / (FAST_WINDOW_MS / 1000);
    const slowRate = slow.length / ((TOTAL_OBSERVE_MS - FAST_WINDOW_MS) / 1000);
    const minRequiredFastRate = Math.max(slowRate * 3, 1);
    expect(fastRate, 'attention-phase blink rate should be much higher than the steady pulse').toBeGreaterThan(
      minRequiredFastRate,
    );
  });
});
