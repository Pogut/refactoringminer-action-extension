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
