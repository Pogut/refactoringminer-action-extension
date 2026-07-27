// Deterministic tests for RMX.github's reveal machinery — no extension, no
// GitHub session, no network. GitHub hides a refactoring's lines two ways that
// look identical from the outside: a file collapsed behind "Load diff", and
// unchanged context folded behind the per-hunk unfold arrows. The second is the
// one that bites, because RefactoringMiner points at lines GitHub considers
// untouched (the field an Encapsulate Attribute wraps), so those lines sit
// inside a fold and tag nothing while the rest of the same refactoring lights up.
//
// The fixtures below are synthetic diffs in BOTH of GitHub's DOM flavours —
// the classic table (element ids, `a.js-expand` with data-*-range) and the
// React diff (data-diff-side/data-line-number cells, an icon-only button whose
// only clue is its octicon) — with expanders that mount their hidden lines on
// click, exactly as GitHub's own fetch does. That's what pins the label/icon
// matching down without a live session; preview.spec.js covers the real thing.
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

// Build a diff where lines `hidden` are folded away and `shown` are mounted.
// `flavour` picks which of GitHub's two markups to emit. The expander mounts the
// folded lines when clicked (asynchronously, like GitHub's excerpt fetch).
async function buildDiff(page, { flavour, digest, hidden, shown, ranged }) {
  await page.evaluate(
    ({ flavour, digest, hidden, shown, ranged }) => {
      const cell = (line) => {
        const el = document.createElement('div');
        if (flavour === 'classic') {
          el.id = `diff-${digest}L${line}`;
          el.setAttribute('data-line-number', String(line));
        } else {
          el.setAttribute('data-line-anchor', `diff-${digest}L${line}`);
          el.setAttribute('data-diff-side', 'left');
          el.setAttribute('data-line-number', String(line));
        }
        el.textContent = `line ${line}`;
        return el;
      };

      const file = document.createElement('div');
      if (flavour === 'classic') file.id = 'diff-' + digest;
      file.style.height = '400px'; // so controls have client rects
      document.body.appendChild(file);

      // The fold: one expander row, then the mounted lines below it.
      const fold = document.createElement('div');
      file.appendChild(fold);
      let control;
      if (flavour === 'classic') {
        control = document.createElement('a');
        control.className = 'js-expand directional-expander single-expander';
        control.setAttribute('aria-label', 'Expand Up');
        if (ranged) {
          control.setAttribute('data-left-range', `${hidden[0]}-${hidden[hidden.length - 1]}`);
          control.setAttribute('data-right-range', `${hidden[0]}-${hidden[hidden.length - 1]}`);
        }
      } else {
        // React: no text, no aria-label — the octicon is the only signal.
        control = document.createElement('button');
        control.innerHTML = '<svg class="octicon octicon-unfold"></svg>';
      }
      control.style.display = 'block';
      control.style.height = '20px';
      fold.appendChild(control);
      window.__clicks = 0;
      control.addEventListener('click', () => {
        window.__clicks++;
        setTimeout(() => {
          hidden.forEach((n) => fold.appendChild(cell(n)));
          control.remove();
        }, 60);
      });

      shown.forEach((n) => file.appendChild(cell(n)));
    },
    { flavour, digest, hidden, shown, ranged },
  );
}

for (const flavour of ['classic', 'react']) {
  test(`${flavour}: revealLine unfolds the hunk hiding a line GitHub calls unchanged`, async ({ page }) => {
    // The reported case: the changed hunk starts at line 14, so the attribute
    // the refactoring is about — line 11 — is folded out of the DOM entirely.
    await buildDiff(page, {
      flavour,
      digest: DIGEST,
      hidden: [11, 12, 13],
      shown: [14, 15, 16],
      ranged: flavour === 'classic',
    });

    const before = await page.evaluate((d) => RMX.github.lineCells(d, 'L', 11).length, DIGEST);
    expect(before).toBe(0); // folded away: nothing to tag, which is the bug

    const after = await page.evaluate(
      async (d) => (await RMX.github.revealLine(d, 'L', 11)).length,
      DIGEST,
    );
    expect(after).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__clicks)).toBe(1); // one click, not a storm
  });

  test(`${flavour}: revealLine leaves an already-mounted line alone`, async ({ page }) => {
    await buildDiff(page, { flavour, digest: DIGEST, hidden: [11], shown: [14, 15] });
    const cells = await page.evaluate(
      async (d) => (await RMX.github.revealLine(d, 'L', 14)).length,
      DIGEST,
    );
    expect(cells).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__clicks)).toBe(0); // no unfold needed
  });
}

test('an unfold click is scoped to the file that owns the line', async ({ page }) => {
  // Two files, each with its own fold. Revealing a line in the second must not
  // click the first one's expander — the gap is matched against THIS file's rows.
  const other = digest('src/main/java/org/jabref/logic/layout/format/NameFormatterPreferences.java');
  await buildDiff(page, { flavour: 'classic', digest: other, hidden: [2, 3], shown: [4, 5] });
  await page.evaluate(() => {
    window.__otherClicks = 0;
    document.querySelector('.js-expand').addEventListener('click', () => window.__otherClicks++);
  });
  await buildDiff(page, {
    flavour: 'classic', digest: DIGEST, hidden: [11, 12, 13], shown: [14, 15], ranged: true,
  });

  const cells = await page.evaluate(
    async (d) => (await RMX.github.revealLine(d, 'L', 11)).length,
    DIGEST,
  );
  expect(cells).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__otherClicks)).toBe(0);
});

test('revealLine gives up quietly when nothing can unfold the line', async ({ page }) => {
  // No expander at all: the line simply is not in this diff. revealLine must
  // resolve to [] rather than hang or keep clicking.
  await page.evaluate((d) => {
    const file = document.createElement('div');
    file.id = 'diff-' + d;
    const cell = document.createElement('div');
    cell.id = `diff-${d}L14`;
    cell.setAttribute('data-line-number', '14');
    file.appendChild(cell);
    document.body.appendChild(file);
  }, DIGEST);

  const cells = await page.evaluate(
    async (d) => (await RMX.github.revealLine(d, 'L', 11)).length,
    DIGEST,
  );
  expect(cells).toBe(0);
});

test('selecting a refactoring reveals EVERY line it paints on, not just the first', async ({ page }) => {
  // The regression this whole change is about: the overlay used to hold one
  // representative line per refactoring, so if that line happened to be mounted
  // (the added getter, say) nothing was unfolded and the refactoring's other
  // half (the folded attribute it wraps) stayed dark. Every target must be
  // walked — and grouped by file, so one click's worth of unfolding serves the
  // rest of that file's targets.
  await page.addScriptTag({ path: path.join(SRC, 'overlay.js') });
  const calls = await page.evaluate(async (d) => {
    const seen = [];
    RMX.github = {
      lineCells: () => [],
      revealLine: (digest, side, line) => {
        seen.push(digest.slice(0, 6) + side + line);
        return Promise.resolve([]);
      },
    };
    RMX.overlay.setTargets({
      0: [
        { digest: d, side: 'R', line: 30 }, // the added getter — already on screen
        { digest: d, side: 'R', line: 11 }, // the attribute it wraps — folded away
        { digest: d, side: 'L', line: 11 },
      ],
    });
    await RMX.overlay.select(['0']);
    return seen;
  }, DIGEST);
  expect(calls).toEqual([DIGEST.slice(0, 6) + 'R30', DIGEST.slice(0, 6) + 'R11', DIGEST.slice(0, 6) + 'L11']);
});

test('a fold that opens a slice at a time is walked until the line appears', async ({ page }) => {
  // GitHub reveals ~20 lines per click on a long fold, so one click is not
  // enough; the walk has to keep going while each click makes progress.
  await page.evaluate((d) => {
    const file = document.createElement('div');
    file.id = 'diff-' + d;
    document.body.appendChild(file);
    const fold = document.createElement('div');
    file.appendChild(fold);
    const control = document.createElement('a');
    control.className = 'js-expand';
    control.setAttribute('aria-label', 'Expand Up');
    control.style.display = 'block';
    control.style.height = '20px';
    fold.appendChild(control);
    let next = 40; // first mounted line; each click reveals 20 more above it
    window.__clicks = 0;
    control.addEventListener('click', () => {
      window.__clicks++;
      setTimeout(() => {
        for (let n = next - 20; n < next; n++) {
          const cell = document.createElement('div');
          cell.id = `diff-${d}L${n}`;
          cell.setAttribute('data-line-number', String(n));
          fold.appendChild(cell);
        }
        next -= 20;
      }, 40);
    });
    for (let n = 40; n < 43; n++) {
      const cell = document.createElement('div');
      cell.id = `diff-${d}L${n}`;
      cell.setAttribute('data-line-number', String(n));
      file.appendChild(cell);
    }
  }, DIGEST);

  const cells = await page.evaluate(
    async (d) => (await RMX.github.revealLine(d, 'L', 5)).length,
    DIGEST,
  );
  expect(cells).toBeGreaterThan(0);
  const clicks = await page.evaluate(() => window.__clicks);
  expect(clicks).toBeGreaterThan(1);
  expect(clicks).toBeLessThanOrEqual(6); // bounded — never an unfold loop
});
