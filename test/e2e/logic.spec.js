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
  expect(url).toContain('rminer.encs.concordia.ca:8000/RefactoringMiner'); // default server
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
