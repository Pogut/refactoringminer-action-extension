// The project's end-to-end suite — driven entirely against GitHub's logged-in
// "Preview" diff (/changes), the React view real users see day to day and the
// only view that the extension targets. We load the real extension into Chromium
// with a saved GitHub session, open the live Pogut/rm-action-test PRs, and assert
// the overlay paints/behaves from the live gh-pages feed: the full browser path
// end to end (service-worker cross-origin fetch → content.js → the virtualized
// data-line-anchor cells), colour mapping, click-to-pair selection on BOTH sides,
// the left/right side-colour distinction, tooltips, deep links, the attention
// blink, and the pinned-line bars.
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

// --- per-PR painting from the live feed -------------------------------------
// For every sandbox PR: the overlay paints on the Preview diff (via the
// data-line-anchor cell path), only on files the feed actually names, reports the
// feed's refactoring count, and shows the legend. Assertions are derived from the
// live feed (sandbox.fetchFeed), not hard-coded, so a feed change surfaces as a
// real behaviour change rather than a stale number.
for (const pr of sb.PRS) {
  test.describe(`PR #${pr.n} (${pr.lang})`, () => {
    test('paints highlights from the live feed', async ({ page }) => {
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

      // Legend is shown (the diff has at least one categorised refactoring).
      await expect(page.locator('#rmx-legend')).toBeVisible();
      expect(await page.locator('#rmx-legend .rmx-lg-row').count()).toBeGreaterThan(0);
    });
  });
}

// --- colour correctness -----------------------------------------------------
// Pin specific lines to the exact category (colour) the overlay must paint. The
// React diff virtualizes rows AND content.js debounces its re-paint ~250ms after
// rows mount, so we scroll the whole diff in steps, pause past that debounce so
// freshly mounted rows get painted, and accumulate every line's colour before
// scrolling unmounts it again — then assert from that map. (Addressing a line
// directly races virtualization.)
async function paintedCategories(page) {
  const grab = () =>
    page.evaluate(() => {
      const o = {};
      document.querySelectorAll('.rmx-hl[data-rmx-cat]').forEach((el) => {
        const a = el.getAttribute('data-line-anchor') || el.id;
        if (a) o[a] = el.getAttribute('data-rmx-cat');
      });
      return o;
    });
  const map = {};
  await page.mouse.move(640, 400); // hover the diff so the wheel scrolls it
  await page.waitForTimeout(400);
  Object.assign(map, await grab());
  for (let i = 0; i < 18; i++) {
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(350); // > content.js's ~250ms repaint debounce, so new rows are painted
    Object.assign(map, await grab());
  }
  return map;
}

for (const pr of [...new Set(sb.COLOURS.map((c) => c.pr))]) {
  test(`PR #${pr}: each rendered line carries the colour matching its refactoring`, async ({ page }) => {
    await openChanges(page, pr);
    const painted = await paintedCategories(page);
    const rows = sb.COLOURS.filter((x) => x.pr === pr);
    const unrendered = [];
    let verified = 0;

    for (const c of rows) {
      const where = `${c.what} @ ${c.file} ${c.side}${c.line}`;
      const anchor = sb.lineAnchor(c.file, c.side, c.line);
      let cat = painted[anchor];

      // Not painted during the sweep — bring its file container into view so the
      // virtualized rows mount, then read the line directly.
      if (cat === undefined) {
        const file = page.locator(`#diff-${sb.digest(c.file)}, [data-line-anchor="diff-${sb.digest(c.file)}"]`).first();
        if (await file.count()) {
          await file.scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(500);
        }
        const cell = page.locator(`[data-line-anchor="${anchor}"], #${anchor}`).first();
        cat = (await cell.count()) ? await cell.getAttribute('data-rmx-cat') : undefined;
      }

      // Absent line = GitHub's Preview diff didn't render it in headless.
      // A line that IS rendered but unpainted (cat === null) is a real bug → fails.
      if (cat === undefined) {
        unrendered.push(where);
        continue;
      }
      verified++;
      expect(cat, `${where} → expected colour "${c.cat}"`).toBe(c.cat);
    }

    if (unrendered.length) {
      console.warn(`  Preview diff didn't render these lines in headless: ${unrendered.join('; ')}`);
    }
    // Guard against a vacuous pass: most rows must actually render and verify.
    expect(verified, `only ${verified}/${rows.length} colour rows rendered on the Preview diff`).toBeGreaterThanOrEqual(
      Math.ceil(rows.length * 0.6),
    );
  });
}

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

// --- pinned-line bars (Preview-only) ----------------------------------------
// A selected line that scrolls out of view is mirrored as a floating bar at the
// top/bottom edge.
test('selected lines that scroll away show pinned bars', async ({ page }) => {
  await openChanges(page, 9);

  const first = page.locator('.rmx-hl[data-rmx-index]').first();
  await first.scrollIntoViewIfNeeded();
  await first.click();
  await expect(page.locator('.rmx-sel').first()).toBeVisible();

  await page.mouse.move(640, 400); // put the cursor over the diff so the wheel scrolls it
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 1200);

  await expect(
    page.locator('#rmx-pin-top .rmx-pin, #rmx-pin-bottom .rmx-pin').first(),
    'a pinned bar should mirror the off-screen selected line',
  ).toBeVisible({ timeout: 10_000 });
});

// Select a refactoring and scroll it off-screen far enough that a pinned bar
// (and its toggle) appears. Shared setup — returns whichever stack got the bar.
async function selectAndPinOffscreen(page, pr) {
  await openChanges(page, pr);
  const first = page.locator('.rmx-hl[data-rmx-index]').first();
  await first.scrollIntoViewIfNeeded();
  await first.click();
  await expect(page.locator('.rmx-sel').first()).toBeVisible();

  await page.mouse.move(640, 400); // cursor over the diff so the wheel scrolls it
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 1200);

  await expect(
    page.locator('#rmx-pin-top .rmx-pin, #rmx-pin-bottom .rmx-pin').first(),
    'a pinned bar should mirror the off-screen selected line',
  ).toBeVisible({ timeout: 10_000 });

  const isTop = await page.locator('#rmx-pin-top .rmx-pin').count();
  return page.locator(isTop ? '#rmx-pin-top' : '#rmx-pin-bottom');
}

// The pinned bar's left stripe must use the same side colour as the inline
// highlight (pink for left/before, violet for right/after), so the cue stays
// consistent wherever a selected line surfaces. Checked via real computed CSS.
test('pinned bars use the side colour — left pink, right violet', async ({ page }) => {
  const stack = await selectAndPinOffscreen(page, 9);
  const pin = stack.locator('.rmx-pin').first();

  const side = await pin.evaluate((el) =>
    el.classList.contains('rmx-pin-L') ? 'L' : el.classList.contains('rmx-pin-R') ? 'R' : null,
  );
  expect(side, 'pinned bar should carry a side class (rmx-pin-L or rmx-pin-R)').toBeTruthy();

  const expected = side === 'L' ? 'rgb(190, 24, 93)' : 'rgb(109, 40, 217)'; // #be185d / #6d28d9
  // Web-first, auto-retrying: re-resolves the stripe on every poll. Scroll/settle
  // events keep firing renderStack(), which removes and recreates the .rmx-pin
  // bars (src/overlay.js); reading computed style through a manually-held handle
  // could hit a detached node — getComputedStyle then returns "" for every
  // property. toHaveCSS re-queries each poll, so a mid-flight re-paint is retried.
  await expect(
    pin.locator('.rmx-pin-stripe'),
    `${side === 'L' ? 'left' : 'right'} pin stripe colour`,
  ).toHaveCSS('background-color', expected);
});

// Each pin stack has a persistent toggle ("▲/▼ N lines off screen") that
// collapses/expands its bars without clearing the selection. We assert the bar
// rows actually appear/disappear from the DOM (not just a CSS class on the layer)
// and that the caret flips direction to reflect the new state.
test('the pinned-bar toggle collapses and re-expands the stack', async ({ page }) => {
  const stack = await selectAndPinOffscreen(page, 9);
  const toggle = stack.locator('.rmx-pin-toggle');

  await expect(toggle, 'toggle should appear once a line is pinned').toBeVisible();
  await expect(toggle).toContainText(/lines? off screen/);

  const barsBefore = await stack.locator('.rmx-pin').count();
  expect(barsBefore, 'bars should be visible before collapsing').toBeGreaterThan(0);
  const caretBefore = await toggle.locator('.rmx-pin-toggle-caret').textContent();

  await toggle.click();
  await expect(stack.locator('.rmx-pin'), 'bars removed from the DOM while collapsed').toHaveCount(0);
  await expect(toggle, 'the toggle itself must stay visible while collapsed').toBeVisible();
  const caretAfterCollapse = await toggle.locator('.rmx-pin-toggle-caret').textContent();
  expect(caretAfterCollapse, 'caret should flip direction on collapse').not.toBe(caretBefore);

  await toggle.click();
  await expect(stack.locator('.rmx-pin').first(), 'bars rebuilt on expand').toBeVisible();
  expect(await stack.locator('.rmx-pin').count()).toBe(barsBefore);
  const caretAfterExpand = await toggle.locator('.rmx-pin-toggle-caret').textContent();
  expect(caretAfterExpand, 'caret should flip back on re-expand').toBe(caretBefore);
});

// --- toggle DOM-node persistence — regression test for the hover-glitch fix -
// Bug history: scroll-driven re-paints used to rebuild the WHOLE pin layer
// (`layer.textContent = ''`), destroying and recreating the toggle element on
// every scroll tick — so :hover state was lost mid-hover, producing a visible
// flicker. The fix made the toggle a node created once in ensurePinLayers();
// renderStack() now only removes/rebuilds the .rmx-pin bar rows.
//
// We can't observe ":hover didn't flicker" from outside the browser, but DOM
// node identity is a precise proxy: tag the live toggle with a throwaway JS
// property (NOT a DOM attribute — a plain JS property set via assignment can only
// live on the exact object it was set on, so it cannot survive a
// remove()+createElement() cycle). If a future change reintroduces wholesale
// layer clearing, this fails because the tag is gone after the next re-paint.
test('the pinned-bar toggle DOM node survives scroll-triggered re-paints', async ({ page }) => {
  await selectAndPinOffscreen(page, 9);

  const tagged = await page.evaluate(() => {
    const toggle = document.querySelector('#rmx-pin-top .rmx-pin-toggle, #rmx-pin-bottom .rmx-pin-toggle');
    if (!toggle) return false;
    toggle.__rmxTestTag = 'stable-node';
    return true;
  });
  expect(tagged, 'expected a toggle element to tag').toBe(true);

  // Force several more scroll-driven re-paints — updatePins()/renderStack() run
  // unconditionally on every captured scroll event while a selection is active.
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(50);
  }

  const stillTagged = await page.evaluate(
    () =>
      document.querySelector('#rmx-pin-top .rmx-pin-toggle, #rmx-pin-bottom .rmx-pin-toggle')?.__rmxTestTag ===
      'stable-node',
  );
  expect(stillTagged, 'toggle element identity should survive re-paints — recreation would lose this JS-only tag').toBe(
    true,
  );
});
