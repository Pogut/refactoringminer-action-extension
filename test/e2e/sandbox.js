// The live sandbox the browser E2E tests drive: the real Pogut/rm-action-test
// PRs whose RefactoringMiner feeds are published on gh-pages. We hit the *real*
// github.com diff with the extension loaded, exercising the full browser path:
// the service-worker cross-origin feed fetch, the live GitHub DOM (and its
// drift), Turbo nav, and the virtualized diff re-paint.
const crypto = require('crypto');

const OWNER = 'Pogut';
const REPO = 'rm-action-test';

// One row per PR that has a published feed. `lang` is just for readable test
// titles. The action bundles every PR under refactorings/pr-<n>/, so these
// coexist — each must have been (re)run under the action at least once so its
// folder exists in the current pages-store.
const PRS = [
  { n: 9, lang: 'java' },
  { n: 12, lang: 'kotlin' },
  { n: 13, lang: 'typescript' },
  { n: 14, lang: 'python' },
];

// GitHub keys each diff line cell by sha256(filePath) — the same digest the
// extension computes (src/github.js) and the action embeds in its comment links.
// Mirror it here so a test can address a specific line cell without scraping.
function digest(filePath) {
  return crypto.createHash('sha256').update(filePath, 'utf8').digest('hex');
}

// The classic /files diff cell id, e.g. diff-<digest>R6. On the new /changes
// React diff the same string is the cell's data-line-anchor — both are what the
// extension resolves and what an action comment link points at via the URL hash.
function lineAnchor(filePath, side, line) {
  return `diff-${digest(filePath)}${side}${line}`;
}

function filesUrl(prNumber) {
  return `https://github.com/${OWNER}/${REPO}/pull/${prNumber}/files`;
}

// The new "Preview" React diff. Logged-out visitors are redirected to /files;
// only an authenticated session (with the Preview diff enabled) sees it.
function changesUrl(prNumber) {
  return `https://github.com/${OWNER}/${REPO}/pull/${prNumber}/changes`;
}

// A selector that finds a line cell in EITHER diff UI: the classic table puts the
// anchor on an element id; the Preview React diff puts it on data-line-anchor.
// Both equal diff-<digest><side><line>, so one selector serves both suites.
function cellSelector(filePath, side, line) {
  const a = lineAnchor(filePath, side, line);
  return `#${a}, [data-line-anchor="${a}"]`;
}

// The published feed, fetched straight from gh-pages (Node 22 has global fetch).
// Tests derive their expectations from this rather than hard-coding, so a feed
// change shows up as a behaviour change, not a stale assertion.
async function fetchFeed(prNumber) {
  const url = `https://${OWNER.toLowerCase()}.github.io/${REPO}/refactorings/pr-${prNumber}/refactorings.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`feed for pr-${prNumber} returned ${res.status} (${url})`);
  return res.json();
}

// RefactoringMiner's native export is { url, refactorings }; also accept the
// wrapped { commits: [...] } form, matching content.js's firstCommit().
function refactoringsOf(feed) {
  if (Array.isArray(feed.refactorings)) return feed.refactorings;
  if (Array.isArray(feed.commits) && feed.commits[0]) return feed.commits[0].refactorings || [];
  return [];
}

module.exports = {
  OWNER, REPO, PRS,
  digest, lineAnchor, cellSelector,
  filesUrl, changesUrl, fetchFeed, refactoringsOf,
};
