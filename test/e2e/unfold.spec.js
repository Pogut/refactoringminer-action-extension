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

test('the fold scope widens past the row that merely holds an expander', async ({ page }) => {
  // Measured on a live 1,000-file commit: the climb from a mounted cell stopped
  // at the <tr> that carries the hunk's expand buttons. That row holds no line
  // of the target side, so foldGaps saw one 0..Infinity gap and the walk clicked
  // whichever expander was there — the wrong end of the file, spending one of
  // the six rounds. The scope has to keep widening until it can actually place
  // the fold, i.e. until it holds a line of that side.
  await page.evaluate((d) => {
    window.__clicked = [];
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    document.body.appendChild(table);

    const cellFor = (side, n) => {
      const td = document.createElement('td');
      td.setAttribute('data-line-anchor', `diff-${d}${side}${n}`);
      td.textContent = `line ${n}`;
      return td;
    };
    const lineRow = (side, n) => {
      const tr = document.createElement('tr');
      tr.appendChild(cellFor(side, n));
      return tr;
    };
    const button = (label, onClick) => {
      const btn = document.createElement('button');
      btn.setAttribute('aria-label', label);
      btn.style.display = 'block';
      btn.style.height = '20px';
      btn.addEventListener('click', () => { window.__clicked.push(label); onClick(btn); });
      return btn;
    };

    // The shape measured live: the file's FIRST cell sits in a row that also
    // carries an expander — and that cell is the LEFT side, while the line we
    // want is on the right. One level of climb therefore reaches a control but
    // no right-side line to place the fold against.
    const head = document.createElement('tr');
    head.appendChild(cellFor('L', 17));
    const headTd = document.createElement('td');
    headTd.appendChild(button('Expand file up from line 17', () => {}));
    head.appendChild(headTd);
    tbody.appendChild(head);

    [17, 18, 49].forEach((n) => tbody.appendChild(lineRow('R', n)));
    const gapRow = document.createElement('tr');
    const gapTd = document.createElement('td');
    gapTd.appendChild(button('Expand file from line 49 to line 53', () => {
      setTimeout(() => { tbody.insertBefore(lineRow('R', 50), gapRow); }, 40);
    }));
    gapRow.appendChild(gapTd);
    tbody.appendChild(gapRow);
    [53, 54].forEach((n) => tbody.appendChild(lineRow('R', n)));
  }, DIGEST);

  const out = await page.evaluate(
    async (d) => ({
      cells: (await RMX.github.revealLine(d, 'R', 50)).length,
      clicked: window.__clicked,
    }),
    DIGEST,
  );

  expect(out.cells).toBeGreaterThan(0);
  // The very first click must be the expander that actually spans line 50.
  expect(out.clicked[0]).toBe('Expand file from line 49 to line 53');
});
