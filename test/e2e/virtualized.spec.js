// Deterministic tests for the third way GitHub hides a refactoring's lines, on
// top of the collapsed file (viewed.spec.js) and the folded hunk
// (unfold.spec.js): a diff with hundreds of files is virtualized per FILE.
// GitHub sizes a placeholder for each one and keeps only the handful around the
// viewport in the DOM, so a 1000-file commit mounts about five and every other
// file has no row, no id="diff-<digest>" box and no fold control to start from.
//
// That was the "clicking a refactoring does nothing at all" report: with none of
// its file in the page, a selection resolved zero cells and there was nothing on
// screen to blink, scroll to or unfold. The fix drives GitHub's own file anchor
// (the tree entry, or the bare #diff-<digest> hash when the tree is hidden),
// which is what makes the virtualizer mount the file.
//
// The fixtures below mount their rows when that anchor is used, exactly as
// GitHub's virtualizer does.
const path = require('path');
const { test, expect } = require('@playwright/test');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const { digest } = require('./sandbox');

const PATH = 'src/main/java/org/jabref/logic/net/ssl/SSLPreferences.java';
const DIGEST = digest(PATH);

test.beforeEach(async ({ page }) => {
  await page.goto('about:blank');
  await page.addScriptTag({ path: path.join(SRC, 'github.js') });
});

// A file the virtualizer has not mounted: nothing of it in the DOM. `via` picks
// what puts it there, the file-tree entry or the hash, mirroring a page whose
// tree is open and one whose tree the reviewer has closed. `mountDelay` is how
// long GitHub takes to render the rows after the anchor is driven (measured at
// over 4s on a 1,000-file commit, hence the slow-mount test), and
// `ignoreClicks` swallows that many click events first — what a huge page does
// while it is still hydrating.
async function virtualizedFile(page, { digest, filePath, lines, via, mountDelay = 60, ignoreClicks = 0 }) {
  await page.evaluate(
    ({ digest, filePath, lines, via, mountDelay, ignoreClicks }) => {
      window.__mounts = 0;
      window.__clicks = 0;
      const host = document.createElement('div');
      document.body.appendChild(host);

      const mount = () => {
        if (window.__mounts++) return;
        setTimeout(() => {
          lines.forEach((n) => {
            const cell = document.createElement('div');
            cell.setAttribute('data-line-anchor', `diff-${digest}L${n}`);
            cell.setAttribute('data-diff-side', 'left');
            cell.setAttribute('data-line-number', String(n));
            cell.style.display = 'block';
            cell.style.height = '20px';
            cell.textContent = `line ${n}`;
            host.appendChild(cell);
          });
        }, mountDelay);
      };

      if (via === 'tree') {
        const entry = document.createElement('a');
        entry.href = '#diff-' + digest;
        entry.textContent = filePath;
        entry.style.display = 'block';
        entry.addEventListener('click', () => {
          if (window.__clicks++ < ignoreClicks) return;
          mount();
        });
        document.body.appendChild(entry);
      } else {
        window.addEventListener('hashchange', () => {
          if (window.location.hash === '#diff-' + digest) mount();
        });
      }
    },
    { digest, filePath, lines, via, mountDelay, ignoreClicks },
  );
}

for (const via of ['tree', 'hash']) {
  test(`a file the diff has not mounted is reached through its ${via} anchor`, async ({ page }) => {
    await virtualizedFile(page, { digest: DIGEST, filePath: PATH, lines: [11, 12, 13], via });

    const before = await page.evaluate((d) => RMX.github.lineCells(d, 'L', 11).length, DIGEST);
    expect(before).toBe(0); // nothing of the file is in the page yet

    const out = await page.evaluate(
      async ({ d, p }) => ({
        cells: (await RMX.github.revealLine(d, 'L', 11, p)).length,
        mounts: window.__mounts,
      }),
      { d: DIGEST, p: PATH },
    );

    expect(out.cells).toBeGreaterThan(0);
    expect(out.mounts).toBe(1);
  });
}

test('a mount slower than one polling budget is still caught', async ({ page }) => {
  // Measured on a live 1,000-file commit: a mount can land over 4s after the
  // anchor click, past a single 2s poll. The retry loop must keep waiting
  // rather than declare the file unreachable.
  await virtualizedFile(page, { digest: DIGEST, filePath: PATH, lines: [11], via: 'tree', mountDelay: 2600 });

  const out = await page.evaluate(
    async ({ d, p }) => ({
      cells: (await RMX.github.revealLine(d, 'L', 11, p)).length,
      rows: document.querySelectorAll(`[data-line-anchor="diff-${d}L11"]`).length,
    }),
    { d: DIGEST, p: PATH },
  );

  expect(out.cells).toBeGreaterThan(0);
  expect(out.rows).toBe(1); // the retry must not have mounted the file twice
});

test('a click GitHub swallows is retried until the file mounts', async ({ page }) => {
  // While a huge diff is still hydrating, GitHub loses clicks outright (also
  // measured live). The fixture ignores the first click; only the retry's
  // full pointer sequence gets through.
  await virtualizedFile(page, { digest: DIGEST, filePath: PATH, lines: [11], via: 'tree', ignoreClicks: 1 });

  const out = await page.evaluate(
    async ({ d, p }) => ({
      cells: (await RMX.github.revealLine(d, 'L', 11, p)).length,
      clicks: window.__clicks,
      mounts: window.__mounts,
    }),
    { d: DIGEST, p: PATH },
  );

  expect(out.cells).toBeGreaterThan(0);
  expect(out.clicks).toBeGreaterThan(1);
  expect(out.mounts).toBe(1);
});

test('a large file parked behind "Load diff" is loaded, not left to the tree link', async ({ page }) => {
  // GitHub renders a big file as a placeholder — "Large diffs are not rendered
  // by default" with a Load diff button — and that placeholder carries NO line
  // cells. Measured live, this is the case that stayed dead: fileRoot resolved
  // the file through one querySelector that also matched the file-tree entry,
  // and because the tree is rendered before the diff, the sidebar link always
  // won. loadDiff then searched inside a link and found nothing.
  await page.evaluate((d) => {
    window.__loadClicks = 0;

    // The file TREE, first in document order — exactly where the old lookup landed.
    const tree = document.createElement('nav');
    const entry = document.createElement('a');
    entry.href = '#diff-' + d;
    entry.textContent = 'GetWalksTest.java';
    tree.appendChild(entry);
    document.body.appendChild(tree);

    // The real diff container, later in the document, holding the placeholder.
    const box = document.createElement('div');
    box.setAttribute('data-diff-anchor', 'diff-' + d);
    box.style.height = '200px';
    const note = document.createElement('div');
    note.textContent = 'Large diffs are not rendered by default.';
    const btn = document.createElement('button');
    btn.textContent = 'Load diff';
    btn.style.display = 'block';
    btn.style.height = '20px';
    btn.addEventListener('click', () => {
      window.__loadClicks++;
      setTimeout(() => {
        [59, 60, 61].forEach((n) => {
          const cell = document.createElement('div');
          cell.setAttribute('data-line-anchor', `diff-${d}R${n}`);
          cell.setAttribute('data-diff-side', 'right');
          cell.setAttribute('data-line-number', String(n));
          cell.style.display = 'block';
          cell.style.height = '20px';
          cell.textContent = `line ${n}`;
          box.appendChild(cell);
        });
        btn.remove();
      }, 60);
    });
    box.appendChild(note);
    box.appendChild(btn);
    document.body.appendChild(box);
  }, DIGEST);

  const out = await page.evaluate(
    async ({ d, p }) => ({
      cells: (await RMX.github.revealLine(d, 'R', 60, p)).length,
      loadClicks: window.__loadClicks,
    }),
    { d: DIGEST, p: PATH },
  );

  expect(out.cells).toBeGreaterThan(0);
  expect(out.loadClicks).toBe(1);
});

test('a mounted file is left alone: no anchor is navigated for a line already on screen', async ({ page }) => {
  // The guard that keeps every ordinary diff on its old path. A file whose rows
  // are present must never be sent through the virtualizer's anchor, or a normal
  // click would rewrite the page hash and jump the reviewer to the file top.
  await page.evaluate((d) => {
    window.__treeClicks = 0;
    const entry = document.createElement('a');
    entry.href = '#diff-' + d;
    entry.addEventListener('click', () => { window.__treeClicks++; });
    document.body.appendChild(entry);
    [11, 12].forEach((n) => {
      const cell = document.createElement('div');
      cell.setAttribute('data-line-anchor', `diff-${d}L${n}`);
      cell.setAttribute('data-diff-side', 'left');
      cell.setAttribute('data-line-number', String(n));
      cell.style.display = 'block';
      cell.style.height = '20px';
      cell.textContent = `line ${n}`;
      document.body.appendChild(cell);
    });
  }, DIGEST);

  const out = await page.evaluate(
    async ({ d, p }) => ({
      cells: (await RMX.github.revealLine(d, 'L', 11, p)).length,
      treeClicks: window.__treeClicks,
      hash: window.location.hash,
    }),
    { d: DIGEST, p: PATH },
  );

  expect(out.cells).toBeGreaterThan(0);
  expect(out.treeClicks).toBe(0);
  expect(out.hash).toBe('');
});

test('a file that never mounts gives up quietly instead of hanging', async ({ page }) => {
  // A dead tree entry (the file genuinely is not in this diff). revealLine has
  // to come back empty in bounded time: the selection that awaits it is what
  // repaints and blinks, so hanging here would freeze the click.
  await page.evaluate((d) => {
    const entry = document.createElement('a');
    entry.href = '#diff-' + d;
    document.body.appendChild(entry);
  }, DIGEST);

  const out = await page.evaluate(
    async ({ d, p }) => {
      const t0 = Date.now();
      const cells = await RMX.github.revealLine(d, 'L', 11, p);
      return { cells: cells.length, ms: Date.now() - t0 };
    },
    { d: DIGEST, p: PATH },
  );

  expect(out.cells).toBe(0);
  expect(out.ms).toBeLessThan(10000);
});

test('selecting a refactoring walks its files one at a time', async ({ page }) => {
  // Two files in flight at once means the second anchor navigation supersedes
  // the first, leaving it to time out, so ensureRevealed must not overlap them.
  await page.addScriptTag({ path: path.join(SRC, 'overlay.js') });
  const OTHER = 'b'.repeat(64);
  const order = await page.evaluate(async ({ d, other }) => {
    const seen = [];
    let live = 0;
    RMX.github = {
      lineCells: () => [],
      revealLine: async (dg, side, line) => {
        if (live) seen.push('OVERLAP');
        live++;
        await new Promise((r) => setTimeout(r, 20));
        seen.push((dg === d ? 'first' : 'second') + side + line);
        live--;
        return [];
      },
    };
    RMX.overlay.setTargets({
      0: [
        { digest: d, side: 'R', line: 30 },
        { digest: other, side: 'R', line: 7 },
        { digest: d, side: 'L', line: 11 },
      ],
    });
    await RMX.overlay.select(['0']);
    return seen;
  }, { d: DIGEST, other: OTHER });

  expect(order).not.toContain('OVERLAP');
  // Grouped by file, each file finished before the next one starts — and the
  // PRIMARY file (the one holding targets[0], where the selection will land)
  // goes last, so no later file's reveal can navigate the page and get the
  // primary's freshly mounted rows virtualized away before they're painted.
  expect(order).toEqual(['secondR7', 'firstR30', 'firstL11']);
});

test('the file the selection lands on is revealed last, and survives to be tagged', async ({ page }) => {
  // The reported case: a refactoring spanning two large files opened the first,
  // then opening the second navigated away and the virtualizer threw the first
  // one's rows straight back out — so the single repaint at the end of select()
  // tagged nothing, and the click "just opened a file" with no highlight.
  await page.addScriptTag({ path: path.join(SRC, 'overlay.js') });
  const OTHER = 'b'.repeat(64);
  const out = await page.evaluate(async ({ d, other }) => {
    const mounted = new Set();
    const opened = [];
    // Opening a file evicts every other one, exactly as the virtualizer does.
    RMX.github = {
      lineCells: () => [],
      cellKey: (dg, s, l) => dg + '|' + s + '|' + l,
      revealLine: async (dg) => {
        opened.push(dg === d ? 'primary' : 'other');
        mounted.clear();
        mounted.add(dg);
        return [];
      },
    };
    RMX.overlay.setTargets({
      0: [
        { digest: d, side: 'R', line: 30 },   // targets[0] ⇒ the primary file
        { digest: other, side: 'L', line: 7 },
      ],
    });
    await RMX.overlay.select(['0']);
    return { opened, stillMounted: Array.from(mounted)[0] === d ? 'primary' : 'other' };
  }, { d: DIGEST, other: OTHER });

  expect(out.opened[out.opened.length - 1]).toBe('primary');
  expect(out.stillMounted).toBe('primary');
});

test('a user input cancels a travel in flight', async ({ page }) => {
  // The crawl toward a far-off file can run for tens of seconds on a huge
  // commit (the page rubber-bands long scrolls to its re-measure throughput).
  // The user must be able to take the wheel back: any real input ends it.
  await page.addScriptTag({ path: path.join(SRC, 'overlay.js') });
  await page.setViewportSize({ width: 900, height: 600 });
  const out = await page.evaluate(async (d) => {
    // A tall page with a properly tagged target far beyond the near threshold.
    const filler = document.createElement('div');
    filler.style.height = '100000px';
    document.body.appendChild(filler);
    const cell = document.createElement('div');
    cell.setAttribute('data-line-anchor', `diff-${d}L11`);
    cell.setAttribute('data-diff-side', 'left');
    cell.setAttribute('data-line-number', '11');
    cell.style.height = '20px';
    cell.textContent = 'target line 11';
    document.body.appendChild(cell);
    const byKey = new Map([[RMX.github.cellKey(d, 'L', 11), {
      filePath: 'x', contribs: [{ index: '0', summary: 's', trailing: false }],
    }]]);
    RMX.overlay.setPlan({ byKey, descByIndex: { 0: 's' } });
    if (!RMX.overlay.paintAll()) return { err: 'nothing tagged' };

    // Freeze the scroll the way the virtualized page does, so the travel loop
    // keeps running instead of arriving on its first seek.
    const sc = document.scrollingElement;
    const pin = setInterval(() => { sc.scrollTop = 0; }, 20);
    let seeks = 0; // travel's writes land far from 0, so each fires a scroll event
    const onScroll = () => { if (sc.scrollTop > 50000) seeks++; };
    window.addEventListener('scroll', onScroll, true);

    if (!RMX.overlay.scrollToRefactoring('0')) return { err: 'no cell to scroll' };
    await new Promise((r) => setTimeout(r, 450));
    const seeksBeforeCancel = seeks;

    // A wheel event = the user takes over; the loop must stop issuing seeks.
    window.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100)); // let an in-flight step notice
    clearInterval(pin);
    sc.scrollTop = 0;
    seeks = 0;
    await new Promise((r) => setTimeout(r, 600));
    return { seeksBeforeCancel, seeksAfterCancel: seeks };
  }, DIGEST);

  expect(out.err).toBeUndefined();
  expect(out.seeksBeforeCancel).toBeGreaterThan(0); // the travel really was running
  expect(out.seeksAfterCancel).toBe(0);             // and the wheel ended it
});
