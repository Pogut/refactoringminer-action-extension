// Deterministic tests for reaching a refactoring inside a file the reviewer
// marked "Viewed" — no extension, no GitHub session, no network.
//
// Ticking "Viewed" collapses the file, and a reviewer part-way through a PR has
// most of them collapsed. That hid a refactoring two different ways, and the
// fixtures below reproduce both from real GitHub markup:
//
//   • classic diff — the rows STAY in the DOM inside a hidden container, so
//     lineCells resolved them happily and the selection painted its neon onto
//     cells nobody could see. Verified against live github.com: collapsing a
//     file left all 19 of its rows queryable, at display:none.
//   • React diff — no rows are rendered at all, so every lookup that starts
//     from a mounted cell came back empty and the refactoring was unreachable.
//     This is the "all files viewed, clicking a refactoring does nothing" case.
//
// The markup here mirrors what a live probe returned: the file box carries
// id="diff-<digest>" and data-tagsearch-path, the header carries data-anchor and
// data-path, and the toggle is button.js-details-target labelled "Toggle diff
// contents" with aria-expanded. The React header is the uncertain one, so it is
// exercised through both of the handles the code can latch onto (the anchor
// attribute, and the file path alone).
//
// Every test also asserts the "Viewed" checkbox is left exactly as the reviewer
// set it: expanding is local, unchecking would rewrite their review progress.
const path = require('path');
const { test, expect } = require('@playwright/test');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const { digest } = require('./sandbox');

const PATH = 'python/customer_profile.py';
const DIGEST = digest(PATH);

test.beforeEach(async ({ page }) => {
  await page.goto('about:blank');
  await page.addScriptTag({ path: path.join(SRC, 'github.js') });
});

// The classic file box: rows present but inside a hidden container.
async function classicViewedFile(page, { digest, filePath, lines }) {
  await page.evaluate(({ digest, filePath, lines }) => {
    window.__viewedClicks = 0;
    const box = document.createElement('div');
    box.id = 'diff-' + digest;
    box.className = 'file js-file js-details-container Details';
    box.setAttribute('data-tagsearch-path', filePath);

    const header = document.createElement('div');
    header.className = 'file-header';
    header.setAttribute('data-path', filePath);
    header.setAttribute('data-anchor', 'diff-' + digest);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn-octicon js-details-target';
    toggle.setAttribute('aria-label', 'Toggle diff contents');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.style.display = 'block';
    toggle.style.height = '20px';

    // The Viewed checkbox, which must never be clicked.
    const label = document.createElement('label');
    const viewed = document.createElement('input');
    viewed.type = 'checkbox';
    viewed.className = 'js-reviewed-checkbox';
    viewed.checked = true;
    viewed.addEventListener('click', () => { window.__viewedClicks++; });
    label.appendChild(viewed);
    label.appendChild(document.createTextNode('Viewed'));

    header.appendChild(toggle);
    header.appendChild(label);
    box.appendChild(header);

    const content = document.createElement('div');
    content.className = 'js-file-content';
    content.hidden = true; // collapsed: present, display:none
    lines.forEach((n) => {
      const cell = document.createElement('div');
      cell.id = `diff-${digest}L${n}`;
      cell.setAttribute('data-line-number', String(n));
      cell.textContent = `line ${n}`;
      content.appendChild(cell);
    });
    box.appendChild(content);
    document.body.appendChild(box);

    toggle.addEventListener('click', () => {
      toggle.setAttribute('aria-expanded', 'true');
      content.hidden = false;
    });
  }, { digest, filePath, lines });
}

// The React file row: nothing of the file is rendered until it is expanded.
// `handle` picks which identifier the header exposes.
async function reactViewedFile(page, { digest, filePath, lines, handle }) {
  await page.evaluate(({ digest, filePath, lines, handle }) => {
    window.__viewedClicks = 0;
    const row = document.createElement('div');
    if (handle === 'anchor') row.setAttribute('data-anchor', 'diff-' + digest);
    row.style.display = 'block';
    row.style.height = '30px';

    const toggle = document.createElement('button');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<svg class="octicon octicon-chevron-right"></svg>';
    toggle.style.display = 'block';
    toggle.style.height = '20px';

    const name = document.createElement('span');
    if (handle === 'path') name.setAttribute('title', filePath);
    name.textContent = filePath;

    const viewed = document.createElement('input');
    viewed.type = 'checkbox';
    viewed.checked = true;
    viewed.setAttribute('aria-label', 'Viewed');
    viewed.addEventListener('click', () => { window.__viewedClicks++; });

    row.appendChild(toggle);
    row.appendChild(name);
    row.appendChild(viewed);
    const body = document.createElement('div');
    row.appendChild(body);
    document.body.appendChild(row);

    toggle.addEventListener('click', () => {
      toggle.setAttribute('aria-expanded', 'true');
      setTimeout(() => {
        lines.forEach((n) => {
          const cell = document.createElement('div');
          cell.setAttribute('data-line-anchor', `diff-${digest}L${n}`);
          cell.setAttribute('data-diff-side', 'left');
          cell.setAttribute('data-line-number', String(n));
          cell.textContent = `line ${n}`;
          body.appendChild(cell);
        });
      }, 60);
    });
  }, { digest, filePath, lines, handle });
}

test('classic: a viewed file keeps its rows in the DOM, so they must not count as reachable', async ({ page }) => {
  await classicViewedFile(page, { digest: DIGEST, filePath: PATH, lines: [11, 12, 13] });

  // The trap this whole fix is about: the cells resolve while still invisible.
  const found = await page.evaluate((d) => RMX.github.lineCells(d, 'L', 11).length, DIGEST);
  expect(found).toBeGreaterThan(0);
  const visible = await page.evaluate(
    (d) => document.getElementById(`diff-${d}L11`).getClientRects().length,
    DIGEST,
  );
  expect(visible).toBe(0);

  const out = await page.evaluate(async (d) => {
    const cells = await RMX.github.revealLine(d, 'L', 11);
    return {
      cells: cells.length,
      onScreen: document.getElementById(`diff-${d}L11`).getClientRects().length > 0,
      viewedClicks: window.__viewedClicks,
      stillViewed: document.querySelector('.js-reviewed-checkbox').checked,
    };
  }, DIGEST);

  expect(out.cells).toBeGreaterThan(0);
  expect(out.onScreen).toBe(true);
  expect(out.viewedClicks).toBe(0); // review state left alone
  expect(out.stillViewed).toBe(true);
});

for (const handle of ['anchor', 'path']) {
  test(`react: a viewed file with no rendered rows is found by its ${handle} and expanded`, async ({ page }) => {
    // The reported case: every file marked viewed, so a refactoring row has
    // nothing on screen to aim at and used to do nothing at all.
    await reactViewedFile(page, { digest: DIGEST, filePath: PATH, lines: [11, 12, 13], handle });

    const before = await page.evaluate((d) => RMX.github.lineCells(d, 'L', 11).length, DIGEST);
    expect(before).toBe(0); // nothing of the file exists yet

    const out = await page.evaluate(
      async ({ d, p }) => {
        const cells = await RMX.github.revealLine(d, 'L', 11, p);
        return {
          cells: cells.length,
          viewedClicks: window.__viewedClicks,
          stillViewed: document.querySelector('input[type="checkbox"]').checked,
        };
      },
      { d: DIGEST, p: PATH },
    );

    expect(out.cells).toBeGreaterThan(0);
    expect(out.viewedClicks).toBe(0);
    expect(out.stillViewed).toBe(true);
  });
}

test('an expanded file is left alone — no toggle click, no review state touched', async ({ page }) => {
  await page.evaluate(({ d, p }) => {
    window.__toggleClicks = 0;
    window.__viewedClicks = 0;
    const box = document.createElement('div');
    box.id = 'diff-' + d;
    box.setAttribute('data-tagsearch-path', p);
    const toggle = document.createElement('button');
    toggle.className = 'js-details-target';
    toggle.setAttribute('aria-label', 'Toggle diff contents');
    toggle.setAttribute('aria-expanded', 'true'); // already open
    toggle.addEventListener('click', () => { window.__toggleClicks++; });
    const viewed = document.createElement('input');
    viewed.type = 'checkbox';
    viewed.checked = false;
    viewed.addEventListener('click', () => { window.__viewedClicks++; });
    box.appendChild(toggle);
    box.appendChild(viewed);
    [11, 12].forEach((n) => {
      const cell = document.createElement('div');
      cell.id = `diff-${d}L${n}`;
      cell.setAttribute('data-line-number', String(n));
      cell.textContent = `line ${n}`;
      box.appendChild(cell);
    });
    document.body.appendChild(box);
  }, { d: DIGEST, p: PATH });

  const out = await page.evaluate(
    async ({ d, p }) => ({
      cells: (await RMX.github.revealLine(d, 'L', 11, p)).length,
      toggleClicks: window.__toggleClicks,
      viewedClicks: window.__viewedClicks,
    }),
    { d: DIGEST, p: PATH },
  );
  expect(out.cells).toBeGreaterThan(0);
  expect(out.toggleClicks).toBe(0);
  expect(out.viewedClicks).toBe(0);
});

test('an open file with a folded line is left to the unfold path, not "expanded"', async ({ page }) => {
  // Regression guard for the gh-11 case. The file is showing and only the target
  // LINE is folded, so the collapsed-file step must not run at all. The trap is
  // the collapsed comment thread below: a real diff is full of unrelated
  // aria-expanded="false" controls, and clicking one would be quite wrong.
  await page.evaluate(({ d, p }) => {
    window.__trapClicks = 0;
    const box = document.createElement('div');
    box.id = 'diff-' + d;
    box.setAttribute('data-tagsearch-path', p);

    const trap = document.createElement('button');
    trap.setAttribute('aria-expanded', 'false');
    trap.setAttribute('aria-label', 'Show resolved conversation');
    trap.style.display = 'block';
    trap.style.height = '20px';
    trap.addEventListener('click', () => { window.__trapClicks++; });
    box.appendChild(trap);

    // Rendered rows: the file is open. Line 11 is simply not among them.
    [14, 15, 16].forEach((n) => {
      const cell = document.createElement('div');
      cell.id = `diff-${d}L${n}`;
      cell.setAttribute('data-line-number', String(n));
      cell.textContent = `line ${n}`;
      box.appendChild(cell);
    });
    document.body.appendChild(box);
  }, { d: DIGEST, p: PATH });

  const trapClicks = await page.evaluate(
    async ({ d, p }) => {
      await RMX.github.revealLine(d, 'L', 11, p);
      return window.__trapClicks;
    },
    { d: DIGEST, p: PATH },
  );
  expect(trapClicks).toBe(0);
});

test('the file-header comment button is never mistaken for the chevron', async ({ page }) => {
  // The real misfire this guards: GitHub's "comment on this file" button carries
  // aria-expanded="false" exactly like a collapsed toggle, and sits in the same
  // header. Scanning for that attribute alone popped open "Add comment on file"
  // instead of opening the file. Only the chevron may be pressed.
  await page.evaluate(({ d, p }) => {
    window.__commentClicks = 0;
    window.__chevronClicks = 0;
    const row = document.createElement('div');
    row.setAttribute('data-anchor', 'diff-' + d);
    row.setAttribute('data-path', p);

    // Comment button FIRST in DOM order, so a first-match scan would take it.
    const comment = document.createElement('button');
    comment.setAttribute('aria-expanded', 'false');
    comment.setAttribute('aria-label', 'Comment on this file');
    comment.innerHTML = '<svg class="octicon octicon-comment"></svg>';
    comment.style.display = 'block';
    comment.style.height = '20px';
    comment.addEventListener('click', () => { window.__commentClicks++; });
    row.appendChild(comment);

    // The kebab menu, same trap.
    const menu = document.createElement('button');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'More options');
    menu.style.display = 'block';
    menu.style.height = '20px';
    menu.addEventListener('click', () => { window.__commentClicks++; });
    row.appendChild(menu);

    const body = document.createElement('div');
    const chevron = document.createElement('button');
    chevron.setAttribute('aria-expanded', 'false');
    chevron.innerHTML = '<svg class="octicon octicon-chevron-right"></svg>';
    chevron.style.display = 'block';
    chevron.style.height = '20px';
    chevron.addEventListener('click', () => {
      window.__chevronClicks++;
      const cell = document.createElement('div');
      cell.setAttribute('data-line-anchor', `diff-${d}L11`);
      cell.setAttribute('data-diff-side', 'left');
      cell.setAttribute('data-line-number', '11');
      cell.textContent = 'line 11';
      body.appendChild(cell);
    });
    row.appendChild(chevron);
    row.appendChild(body);
    document.body.appendChild(row);
  }, { d: DIGEST, p: PATH });

  const out = await page.evaluate(
    async ({ d, p }) => ({
      cells: (await RMX.github.revealLine(d, 'L', 11, p)).length,
      commentClicks: window.__commentClicks,
      chevronClicks: window.__chevronClicks,
    }),
    { d: DIGEST, p: PATH },
  );
  expect(out.commentClicks).toBe(0);
  expect(out.chevronClicks).toBe(1);
  expect(out.cells).toBeGreaterThan(0);
});

test('a control that fails to open the file is retired, not pressed once per line', async ({ page }) => {
  // If the chevron guess is ever wrong again, the damage must be one click, not
  // one per line of the refactoring (a selection reveals many lines per file).
  await page.evaluate(({ d, p }) => {
    window.__clicks = 0;
    const row = document.createElement('div');
    row.setAttribute('data-anchor', 'diff-' + d);
    row.setAttribute('data-path', p);
    const fake = document.createElement('button');
    fake.setAttribute('aria-expanded', 'false');
    fake.innerHTML = '<svg class="octicon octicon-chevron-right"></svg>';
    fake.style.display = 'block';
    fake.style.height = '20px';
    fake.addEventListener('click', () => { window.__clicks++; }); // opens nothing
    row.appendChild(fake);
    document.body.appendChild(row);
  }, { d: DIGEST, p: PATH });

  const clicks = await page.evaluate(
    async ({ d, p }) => {
      for (const line of [11, 12, 13, 14]) await RMX.github.revealLine(d, 'L', line, p);
      return window.__clicks;
    },
    { d: DIGEST, p: PATH },
  );
  expect(clicks).toBe(1);
});

test('a viewed control is never mistaken for the expand control', async ({ page }) => {
  // A collapsed file whose only aria-expanded="false" controls ARE the viewed
  // toggle, in both shapes GitHub might render it: a button carrying the label,
  // and a button wrapping the checkbox. Either would otherwise be picked up by
  // the generic scan. The file must stay collapsed rather than be forced open by
  // unticking it, because that would rewrite the reviewer's review progress.
  await page.evaluate(({ d, p }) => {
    window.__viewedClicks = 0;
    const box = document.createElement('div');
    box.id = 'diff-' + d;
    box.setAttribute('data-tagsearch-path', p);

    const labelled = document.createElement('button');
    labelled.setAttribute('aria-expanded', 'false');
    labelled.setAttribute('aria-label', 'Viewed');
    labelled.style.display = 'block';
    labelled.style.height = '20px';
    labelled.addEventListener('click', () => { window.__viewedClicks++; });
    box.appendChild(labelled);

    const wrapper = document.createElement('button');
    wrapper.setAttribute('aria-expanded', 'false');
    wrapper.style.display = 'block';
    wrapper.style.height = '20px';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    wrapper.appendChild(cb);
    wrapper.addEventListener('click', () => { window.__viewedClicks++; });
    box.appendChild(wrapper);

    document.body.appendChild(box);
  }, { d: DIGEST, p: PATH });

  const clicks = await page.evaluate(
    async ({ d, p }) => {
      await RMX.github.revealLine(d, 'L', 11, p);
      return window.__viewedClicks;
    },
    { d: DIGEST, p: PATH },
  );
  expect(clicks).toBe(0);
});
