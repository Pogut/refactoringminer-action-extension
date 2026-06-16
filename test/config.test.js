// Dependency-free checks for the pure logic in src/config.js — the URL parsing
// and feed-path construction, which must stay byte-compatible with the action's
// publish layout. Loaded via vm with a `window` shim (content scripts attach to
// a global `window.RMX`, so no real browser is needed for this part).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

global.window = global;
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'config.js'), 'utf8'));
const { parseLocation, feedUrl } = window.RMX.config;

let passed = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  passed++;
};

// --- parseLocation ---------------------------------------------------------
const files = parseLocation('https://github.com/o/r/pull/14/files');
ok(files && files.view === 'files', 'PR files view is recognised');
ok(files.owner === 'o' && files.repo === 'r' && files.prNumber === '14', 'owner/repo/PR extracted');

const changes = parseLocation('https://github.com/o/r/pull/14/changes');
ok(changes && changes.view === 'files' && changes.prNumber === '14', 'PR /changes view maps to files');

const prCommit = parseLocation('https://github.com/o/r/pull/14/commits/abc123');
ok(prCommit && prCommit.view === 'commit' && prCommit.prNumber === '14', 'PR commit view → commit');

const commit = parseLocation('https://github.com/o/r/commit/abc123');
ok(commit && commit.view === 'commit' && commit.commitSha === 'abc123', 'standalone commit recognised');

ok(parseLocation('https://github.com/o/r/pull/14') === null, 'PR conversation tab is not overlaid');
ok(parseLocation('https://github.com/o/r') === null, 'repo home is not overlaid');
ok(parseLocation('https://example.com/o/r/pull/1/files') === null, 'non-github host ignored');

// --- feedUrl ---------------------------------------------------------------
ok(
  feedUrl({ owner: 'Pogut', repo: 'rm-action-test', prNumber: '14' }) ===
    'https://pogut.github.io/rm-action-test/refactorings/pr-14/refactorings.json',
  'feed URL matches the action publish path (owner l-cased, pr-<n>/refactorings.json)',
);
ok(feedUrl({ owner: 'o', repo: 'r', commitSha: 'x', view: 'commit' }) === null, 'no feed without a PR number');

console.log(`config.test.js: ${passed} assertions passed`);
