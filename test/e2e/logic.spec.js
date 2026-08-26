// Fast, deterministic unit tests for the pure content-script logic — no
// extension, no GitHub session, no live RefactoringMiner server. The source
// files attach their modules to `window.RMX`, so we load them into a blank page
// and exercise the pure functions directly. This is where URL parsing, feed/git
// URL construction, and the RM request shape are pinned down cheaply; the live
// browser suites (preview/commit specs) cover the DOM + network integration.
const path = require('path');
const { test, expect } = require('@playwright/test');

const SRC = path.resolve(__dirname, '..', '..', 'src');

test.beforeEach(async ({ page }) => {
  await page.goto('about:blank');
  await page.addScriptTag({ path: path.join(SRC, 'config.js') });
  await page.addScriptTag({ path: path.join(SRC, 'rm.js') });
});

test('parseLocation recognises PR files, changes, PR-commit, and commit pages', async ({ page }) => {
  const out = await page.evaluate(() => ({
    files: RMX.config.parseLocation('https://github.com/o/r/pull/12/files'),
    changes: RMX.config.parseLocation('https://github.com/o/r/pull/12/changes?diff=split'),
    prCommit: RMX.config.parseLocation('https://github.com/o/r/pull/12/commits/abc123'),
    // The Preview UI deep-links a single commit as /changes/<sha>; the trailing
    // sha must route it to the commit view, not the whole-PR files view — this is
    // what stops a single commit page from being analysed as the entire PR.
    prChangesCommit: RMX.config.parseLocation('https://github.com/o/r/pull/12/changes/abc123'),
    commit: RMX.config.parseLocation('https://github.com/o/r/commit/deadbeef'),
    issues: RMX.config.parseLocation('https://github.com/o/r/issues/3'),
    notGithub: RMX.config.parseLocation('https://example.com/o/r/commit/x'),
  }));
  expect(out.files).toMatchObject({ owner: 'o', repo: 'r', prNumber: '12', view: 'files' });
  expect(out.files.commitSha).toBeUndefined();
  expect(out.changes).toMatchObject({ prNumber: '12', view: 'files' });
  expect(out.prCommit).toMatchObject({ prNumber: '12', commitSha: 'abc123', view: 'commit' });
  expect(out.prChangesCommit).toMatchObject({ prNumber: '12', commitSha: 'abc123', view: 'commit' });
  expect(out.commit).toMatchObject({ owner: 'o', repo: 'r', commitSha: 'deadbeef', view: 'commit' });
  expect(out.issues).toBeNull();
  expect(out.notGithub).toBeNull();
});

test('feedUrl builds the per-PR path; gitUrl builds the clone URL', async ({ page }) => {
  const out = await page.evaluate(() => ({
    feed: RMX.config.feedUrl({ owner: 'MyOrg', repo: 'My-Repo', prNumber: '7' }),
    feedNoPr: RMX.config.feedUrl({ owner: 'o', repo: 'r', commitSha: 'x' }),
    git: RMX.config.gitUrl({ owner: 'MyOrg', repo: 'My-Repo' }),
    gitNone: RMX.config.gitUrl({ owner: 'o' }),
  }));
  // Owner is lower-cased for the github.io subdomain; repo case is preserved.
  expect(out.feed).toBe('https://myorg.github.io/My-Repo/refactorings/pr-7/refactorings.json');
  expect(out.feedNoPr).toBeNull(); // commit-only page → no action feed
  expect(out.git).toBe('https://github.com/MyOrg/My-Repo.git');
  expect(out.gitNone).toBeNull();
});

test('rm.fetchCommit calls the configured service with gitURL, commitId, timeout', async ({ page }) => {
  const url = await page.evaluate(async () => {
    let captured = '';
    // Stub fetch so no real request goes out; capture the URL the client builds.
    window.fetch = (u) => {
      captured = u;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ commits: [] }) });
    };
    await RMX.rm.fetchCommit('https://github.com/o/r.git', 'abc123');
    return captured;
  });
  expect(url).toContain('rminer.gveloso.com/RefactoringMiner'); // default server
  expect(url).toContain('gitURL=' + encodeURIComponent('https://github.com/o/r.git'));
  expect(url).toContain('commitId=abc123');
  expect(url).toContain('timeout=60');
  expect(url).not.toContain('token='); // no token stored → omitted
});

test('rm.fetchCommit memoises per request (one request per gitURL+id)', async ({ page }) => {
  const calls = await page.evaluate(async () => {
    let n = 0;
    window.fetch = () => {
      n++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ commits: [] }) });
    };
    await RMX.rm.fetchCommit('https://github.com/o/r.git', 'same-sha');
    await RMX.rm.fetchCommit('https://github.com/o/r.git', 'same-sha'); // cached
    await RMX.rm.fetchCommit('https://github.com/o/r.git', '42'); // different id → new request
    await RMX.rm.fetchCommit('https://github.com/other/x.git', 'same-sha'); // different repo → new request
    return n;
  });
  expect(calls).toBe(3);
});

test('rm.fetchCommit passes an integer PR number through as commitId (whole-PR mode)', async ({ page }) => {
  // The service treats an integer commitId as a pull-request number and runs
  // detectAtPullRequest; the client just forwards whatever id it's given.
  const url = await page.evaluate(async () => {
    let captured = '';
    window.fetch = (u) => {
      captured = u;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ commits: [] }) });
    };
    await RMX.rm.fetchCommit('https://github.com/o/r.git', '7');
    return captured;
  });
  expect(url).toContain('commitId=7');
});

// --- reached-by lines (invocations / references) ----------------------------
// RefactoringMiner reports two kinds of location for one refactoring: the code
// that changed, and the code that merely REACHES it — the call sites an Extract
// leaves behind, the statements that mention a renamed variable. The overlay
// paints the second kind in the accent colour and leaves it out of the edge
// chips' line counts. That decision is per SELECTION, not per paint (a line can
// be a call site of one refactoring and changed code of another), which is what
// these pin down.
//
// overlay.js reaches the DOM only through RMX.github, so a stub adapter and a
// handful of divs are a whole diff as far as it's concerned.
const OVERLAY_HARNESS = () => {
  const cells = new Map(); // "digest|side|line" -> div
  window.RMX.github = {
    cellKey: (d, s, l) => d + '|' + s + '|' + l,
    cellIdentity: (el) => (el.dataset.id ? JSON.parse(el.dataset.id) : null),
    candidateCells: () => Array.from(cells.values()),
    lineCells: (d, s, l) => [cells.get(d + '|' + s + '|' + l)].filter(Boolean),
    revealLine: async () => true,
    fileDigest: async (p) => p,
  };
  // One div per source line, carrying text so lineHasCode() accepts it.
  window.mount = (side, line) => {
    const el = document.createElement('div');
    el.dataset.id = JSON.stringify({ digest: 'd', side, line });
    el.textContent = 'code(' + line + ');';
    document.body.appendChild(el);
    cells.set('d|' + side + '|' + line, el);
    return el;
  };
  // A paint plan in the shape content.js builds, from [line, index, accent, role]
  // rows. `descByIndex` carries each refactoring's summary, as content.js does.
  window.planOf = (rows) => {
    const byKey = new Map();
    const descByIndex = {};
    rows.forEach(([line, index, accent, role]) => {
      const key = 'd|R|' + line;
      if (!byKey.has(key)) byKey.set(key, { filePath: 'A.java', contribs: [] });
      byKey.get(key).contribs.push({
        index: String(index), summary: 'S' + index, header: null, trailing: false,
        accent, role: role || '',
      });
      descByIndex[String(index)] = 'Extract Method: a() → b' + index + '()';
    });
    return { byKey, headerGroups: new Map(), descByIndex, targets: {} };
  };
  window.stateOf = (line) => {
    const el = cells.get('d|R|' + line);
    return {
      reached: el.getAttribute('data-rmx-reached'),
      role: el.getAttribute('data-rmx-role'),
      inert: el.hasAttribute('data-rmx-inert'),
      acc: el.classList.contains('rmx-acc'),
    };
  };
  // Click a line the way a reader does, through the delegated document handler.
  window.clickLine = (line) => {
    cells.get('d|R|' + line).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };
  // Which lines are currently lit, by number — the observable effect of a
  // selection, and enough to say WHICH refactoring got selected when each has a
  // line of its own.
  window.litLines = () => Array.from(document.querySelectorAll('.rmx-sel'))
    .map((el) => JSON.parse(el.dataset.id).line).sort((a, b) => a - b);
  window.hoverHtml = (line) => {
    cells.get('d|R|' + line).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return window.__rmxTip.innerHTML;
  };
};

test.describe('reached-by (invocation / reference) lines', () => {
  test.beforeEach(async ({ page }) => {
    await page.addScriptTag({ path: path.join(SRC, 'overlay.js') });
    await page.evaluate(OVERLAY_HARNESS);
  });

  test('paintAll records reached-by per index, and a changed contribution clears it', async ({ page }) => {
    const out = await page.evaluate(() => {
      [10, 11, 12].forEach((l) => window.mount('R', l));
      RMX.overlay.setPlan(window.planOf([
        [10, 0, false],       // changed code of refactoring 0
        [11, 0, true],        // a call site of refactoring 0
        [12, 0, true],        // reached by 0 …
        [12, 0, false],       // … and changed by it too — changed wins
      ]));
      RMX.overlay.paintAll();
      return [10, 11, 12].map((l) => window.stateOf(l).reached);
    });
    expect(out).toEqual([null, '0', null]);
  });

  test('a line reached by one refactoring and changed by another follows the selection', async ({ page }) => {
    const out = await page.evaluate(async () => {
      window.mount('R', 20);
      RMX.overlay.setPlan(window.planOf([
        [20, 0, true],   // refactoring 0 only calls into this line
        [20, 1, false],  // refactoring 1 changed it
      ]));
      RMX.overlay.paintAll();
      const seen = {};
      // select() reveals + blinks; applySelection is the part that colours.
      await RMX.overlay.select(['0']);
      seen.callerOnly = window.stateOf(20).acc;
      await RMX.overlay.select(['1']);
      seen.changerOnly = window.stateOf(20).acc;
      await RMX.overlay.select(['0', '1']);
      seen.both = window.stateOf(20).acc;
      return seen;
    });
    // Lit for the caller alone → accent. Lit for the refactoring that changed
    // it, alone or alongside the caller → the change is what should show.
    expect(out).toEqual({ callerOnly: true, changerOnly: false, both: false });
  });

  test('a reached-by line is inert: clicking it selects nothing and keeps the selection', async ({ page }) => {
    const out = await page.evaluate(async () => {
      [30, 31].forEach((l) => window.mount('R', l));
      RMX.overlay.setPlan(window.planOf([
        [30, 0, false],                                  // changed code
        [31, 0, true, 'extracted method invocation'],    // its call site
      ]));
      RMX.overlay.paintAll();
      RMX.overlay.installTooltip();
      const settle = () => new Promise((r) => setTimeout(r, 30));
      const seen = { inert: [window.stateOf(30).inert, window.stateOf(31).inert] };
      window.clickLine(31);
      await settle();
      seen.afterInertClick = window.litLines();
      // A real line still selects, and an inert click afterwards must not undo it.
      window.clickLine(30);
      await settle();
      seen.afterRealClick = window.litLines();
      window.clickLine(31);
      await settle();
      seen.selectionSurvives = window.litLines();
      return seen;
    });
    expect(out.inert).toEqual([false, true]);
    expect(out.afterInertClick).toEqual([]);          // the click did nothing
    // Selecting the refactoring lights BOTH its lines — the call site included,
    // in the accent colour. Only the click on it is suppressed, not its painting.
    expect(out.afterRealClick).toEqual([30, 31]);
    expect(out.selectionSurvives).toEqual([30, 31]);  // inert click didn't clear it
  });

  test('a line reached by one refactoring but changed by another stays clickable', async ({ page }) => {
    const lit = await page.evaluate(async () => {
      [40, 41, 42].forEach((l) => window.mount('R', l));
      RMX.overlay.setPlan(window.planOf([
        [40, 0, true, 'extracted method invocation'],  // 0 only calls into line 40
        [40, 1, false],                                // 1 changed line 40
        [41, 0, false],                                // a line only 0 owns
        [42, 1, false],                                // a line only 1 owns
      ]));
      RMX.overlay.paintAll();
      RMX.overlay.installTooltip();
      window.clickLine(40);
      await new Promise((r) => setTimeout(r, 30));
      return window.litLines();
    });
    // 42 lit and 41 dark ⇒ the click selected refactoring 1 (which changed the
    // line) and not 0 (which merely reaches it).
    expect(lit).toEqual([40, 42]);
  });

  test('a reached-by line hovers to its JSON description, without the counterpart peek', async ({ page }) => {
    const html = await page.evaluate(() => {
      [50, 51].forEach((l) => window.mount('R', l));
      RMX.overlay.setPlan(window.planOf([
        [50, 0, false],
        [51, 0, true, 'statement referencing the renamed variable'],
      ]));
      RMX.overlay.paintAll();
      RMX.overlay.installTooltip();
      return { reached: window.hoverHtml(51), changed: window.hoverHtml(50) };
    });
    // The location's own words, sentence-cased, plus which refactoring reaches it.
    expect(html.reached).toContain('Statement referencing the renamed variable');
    expect(html.reached).toContain('Extract Method: a() → b0()');
    // None of the pairing affordances — there is no counterpart and no click.
    expect(html.reached).not.toContain('click to jump');
    expect(html.reached).not.toContain('rmx-tip-code');
    // The ordinary line keeps the full peek.
    expect(html.changed).not.toContain('rmx-tip-owner');
  });

  test('the accent palette is published as CSS variables', async ({ page }) => {
    const vars = await page.evaluate(() => {
      RMX.overlay.ensureStyle();
      const s = document.documentElement.style;
      return {
        fill: s.getPropertyValue('--rmx-accent'),
        outline: s.getPropertyValue('--rmx-accent-d'),
        segment: s.getPropertyValue('--rmx-accent-seg'),
      };
    });
    expect(vars.fill).toBe('#f5dbff');    // light default; GitHub's theme isn't dark here
    expect(vars.outline).toBe('#a626d4');
    expect(vars.segment).toBeTruthy();
  });
});
