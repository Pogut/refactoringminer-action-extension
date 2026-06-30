// Authenticated end-to-end tests against GitHub's new "Preview" diff (/changes) —
// the logged-in experience (image 2). They exercise the code paths the classic
// suite can't reach: the data-line-anchor cell resolution, the virtualized diff,
// and the pinned-line bars that appear when a selected line scrolls out of view.
//
// These need a saved GitHub session. Capture it once: `npm run test:auth`. Until
// then the whole file is skipped (so `npm test` stays green when logged out).
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

test('paints on the Preview diff via data-line-anchor', async ({ page }) => {
  const feed = await sb.fetchFeed(12);
  await openChanges(page, 12);

  // The Preview diff keys cells with data-line-anchor (not element ids); painted
  // cells carrying it prove the overlay took the React-diff path, not the classic one.
  expect(await page.locator('[data-line-anchor^="diff-"]').count(), 'Preview diff anchors present').toBeGreaterThan(0);
  expect(await page.locator('.rmx-hl[data-line-anchor]').count(), 'painted via the data-line-anchor path').toBeGreaterThan(0);

  const reported = page.rmxLogs.find((l) => l.includes('refactorings'));
  expect(reported).toContain(`[RMX] ${sb.refactoringsOf(feed).length} refactorings`);
  await expect(page.locator('#rmx-legend')).toBeVisible();
});

// Same colour contract as the classic suite, now on the Preview diff. The React
// diff virtualizes rows AND content.js debounces its re-paint ~250ms after rows
// mount, so we scroll the whole diff in steps, pause past that debounce so freshly
// mounted rows get painted, and accumulate every line's colour before scrolling
// unmounts it again — then assert from that map. (Addressing a line directly races
// virtualization; GitHub's Preview diff also won't reliably scroll-to-hash for an
// off-screen file in headless.)
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
  test(`PR #${pr}: each rendered line carries the colour matching its refactoring (Preview)`, async ({ page }) => {
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

      // Absent line = GitHub's Preview diff didn't render it in headless (the
      // classic suite verifies this colour exhaustively, so we don't fail on it).
      // A line that IS rendered but unpainted (cat === null) is a real bug → fails.
      if (cat === undefined) {
        unrendered.push(where);
        continue;
      }
      verified++;
      expect(cat, `${where} → expected colour "${c.cat}"`).toBe(c.cat);
    }

    if (unrendered.length) {
      console.warn(`  Preview diff didn't render (covered by the classic suite): ${unrendered.join('; ')}`);
    }
    // Guard against a vacuous pass: most rows must actually render and verify.
    expect(verified, `only ${verified}/${rows.length} colour rows rendered on the Preview diff`).toBeGreaterThanOrEqual(
      Math.ceil(rows.length * 0.6),
    );
  });
}

// Clicking a highlighted line lights the whole refactoring in gold on BOTH sides.
// Self-calibrating: we find any refactoring whose left and right are both mounted,
// so the test doesn't depend on the Preview diff's exact line layout.
test('clicking a line selects its counterpart on both sides (Preview)', async ({ page }) => {
  await openChanges(page, 9);

  const pair = await page.evaluate(() => {
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
  expect(pair, 'expected a refactoring with both sides mounted on the Preview diff').toBeTruthy();

  const left = page.locator(`[data-line-anchor="${pair.left}"]`).first();
  const right = page.locator(`[data-line-anchor="${pair.right}"]`).first();

  await expect(right).not.toHaveClass(/rmx-sel/);
  await right.click();
  await expect(right, 'clicked line selected').toHaveClass(/rmx-sel/);
  await expect(left, 'counterpart on the other side selected too').toHaveClass(/rmx-sel/);
  await expect(right, 'gold blink fill applied').toHaveClass(/rmx-on/);
});

// Pinned-line peek (Preview-only): a selected line that scrolls out of view is
// mirrored as a floating bar at the top/bottom edge. Select, scroll the diff away,
// and the bar should appear.
test('selected lines that scroll away show pinned bars (Preview)', async ({ page }) => {
  await openChanges(page, 9);

  // Select a refactoring (any painted line will do).
  const first = page.locator('.rmx-hl[data-rmx-index]').first();
  await first.scrollIntoViewIfNeeded();
  await first.click();
  await expect(page.locator('.rmx-sel').first()).toBeVisible();

  // Scroll far enough that the selection leaves the viewport.
  await page.mouse.move(640, 400); // put the cursor over the diff so the wheel scrolls it
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 1200);

  await expect(
    page.locator('#rmx-pin-top .rmx-pin, #rmx-pin-bottom .rmx-pin').first(),
    'a pinned bar should mirror the off-screen selected line',
  ).toBeVisible({ timeout: 10_000 });
});

// Select a refactoring and scroll it off-screen far enough that a pinned bar
// (and its toggle) appears. Shared setup for the three tests below — returns
// whichever stack ('#rmx-pin-top' or '#rmx-pin-bottom') actually got the bar,
// since which edge it lands on depends on where the selected line started
// relative to the viewport, not something worth hard-coding per PR.
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

// --- pinned bar colour matches side (Preview-only) --------------------------
// The pinned bar's left stripe must use the same side colour as the inline
// highlight (pink for left/before, violet for right/after, src/overlay.js),
// so the cue stays consistent wherever a selected line surfaces — inline or
// pinned. Checked via real computed CSS, not just the rmx-pin-L/R class name.
test('pinned bars use the side colour — left pink, right violet (Preview)', async ({ page }) => {
  const stack = await selectAndPinOffscreen(page, 9);
  const pin = stack.locator('.rmx-pin').first();

  const side = await pin.evaluate((el) =>
    el.classList.contains('rmx-pin-L') ? 'L' : el.classList.contains('rmx-pin-R') ? 'R' : null,
  );
  expect(side, 'pinned bar should carry a side class (rmx-pin-L or rmx-pin-R)').toBeTruthy();

  const expected = side === 'L' ? 'rgb(190, 24, 93)' : 'rgb(109, 40, 217)'; // #be185d / #6d28d9
  // Web-first, auto-retrying: re-resolves the stripe on every poll. Scroll/settle
  // events on the live Preview diff keep firing renderStack(), which removes and
  // recreates the .rmx-pin bars (src/overlay.js); reading computed style through a
  // manually-held handle could hit a detached node — getComputedStyle then returns
  // "" for every property. toHaveCSS re-queries each poll, so a mid-flight re-paint
  // is retried instead of failing.
  await expect(
    pin.locator('.rmx-pin-stripe'),
    `${side === 'L' ? 'left' : 'right'} pin stripe colour`,
  ).toHaveCSS('background-color', expected);
});

// --- collapsible pinned-bar toggle (Preview-only) ---------------------------
// Each pin stack has a persistent toggle ("▲/▼ N lines off screen") at the
// content-facing edge that collapses/expands its bars without clearing the
// selection. We assert the bar rows actually appear/disappear from the DOM
// (renderStack() adds/removes .rmx-pin elements) — not just a CSS class on
// the layer — and that the caret flips direction to reflect the new state.
test('the pinned-bar toggle collapses and re-expands the stack (Preview)', async ({ page }) => {
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
// renderStack() now only removes/rebuilds the .rmx-pin bar rows and leaves
// the toggle alone.
//
// We can't observe ":hover didn't flicker" from outside the browser, but DOM
// node identity is a precise, equivalent proxy: tag the live toggle element
// with a throwaway JS property (deliberately NOT a DOM attribute — an
// attribute could in principle be copied during a refactor; a plain JS
// property set via assignment can only ever live on the exact object it was
// set on, so it cannot survive a remove()+createElement() cycle). If a future
// change reintroduces wholesale layer clearing, this test fails because the
// tag is gone after the next forced re-paint.
test('the pinned-bar toggle DOM node survives scroll-triggered re-paints (Preview)', async ({ page }) => {
  await selectAndPinOffscreen(page, 9);

  const tagged = await page.evaluate(() => {
    const toggle = document.querySelector('#rmx-pin-top .rmx-pin-toggle, #rmx-pin-bottom .rmx-pin-toggle');
    if (!toggle) return false;
    toggle.__rmxTestTag = 'stable-node';
    return true;
  });
  expect(tagged, 'expected a toggle element to tag').toBe(true);

  // Force several more scroll-driven re-paints — updatePins()/renderStack()
  // run unconditionally on every captured scroll event while a selection is
  // active (src/overlay.js), so this reliably re-exercises the exact code
  // path that used to wipe the toggle, without needing a large scroll.
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
