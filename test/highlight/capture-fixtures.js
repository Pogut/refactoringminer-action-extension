// One-time fixture capture (run rarely, when the test repo's PRs change). For
// each language in fixtures.config.js it pulls three things out of the
// rm-action-test git repo and writes them under fixtures/<lang>/:
//
//   feed.json        — the refactorings.json the action published (gh-pages)
//   before/<path>    — every referenced file at the PR base ref  (left side)
//   after/<path>     — every referenced file at the PR head ref  (right side)
//   meta.json        — owner/repo/pr + the refs, so the harness can rebuild URLs
//
// We only snapshot the files the feed actually references, but each is stored in
// full (all lines) so the harness can faithfully reproduce blank lines and the
// declaration lines that the trimming logic inspects.
//
// Usage: RM_TEST_REPO=/path/to/rm-action-test node test/highlight/capture-fixtures.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FIXTURES = require('./fixtures.config');
const REPO =
  process.env.RM_TEST_REPO ||
  path.resolve(__dirname, '..', '..', '..', 'rm-action-test');
const OUT = path.join(__dirname, 'fixtures');

function git(args) {
  return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
}

// `git show <ref>:<file>`, or null when the file doesn't exist on that ref (e.g.
// a class the refactoring creates has no "before" version). We treat absence as
// "this side has no cells for that file" rather than an error.
function showFile(ref, file) {
  try {
    return execFileSync('git', ['-C', REPO, 'show', `${ref}:${file}`], {
      encoding: 'utf8',
      maxBuffer: 64 << 20,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {
    return null;
  }
}

function refsForSide(refactorings, sideKey) {
  const paths = new Set();
  refactorings.forEach((r) => (r[sideKey] || []).forEach((loc) => paths.add(loc.filePath)));
  return paths;
}

function writeTree(dir, ref, paths) {
  let written = 0;
  paths.forEach((rel) => {
    const content = showFile(ref, rel);
    if (content === null) return;
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    written++;
  });
  return written;
}

function ownerRepoFromUrl(url) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url || '');
  return m ? { owner: m[1], repo: m[2], prNumber: m[3] } : null;
}

function feedPathOnPages(pr) {
  // Find the gh-pages ref (local or remote) that holds the published feeds.
  const candidates = ['gh-pages', 'origin/gh-pages'];
  for (const ref of candidates) {
    const raw = showFile(ref, `refactorings/pr-${pr}/refactorings.json`);
    if (raw !== null) return raw;
  }
  throw new Error(`No refactorings/pr-${pr}/refactorings.json on gh-pages in ${REPO}`);
}

function main() {
  if (!fs.existsSync(path.join(REPO, '.git'))) {
    throw new Error(`rm-action-test repo not found at ${REPO} (set RM_TEST_REPO)`);
  }
  fs.rmSync(OUT, { recursive: true, force: true });

  FIXTURES.forEach(({ lang, feedPr, beforeRef, afterRef }) => {
    const feed = JSON.parse(feedPathOnPages(feedPr));
    const refactorings = feed.refactorings || [];
    const dir = path.join(OUT, lang);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(path.join(dir, 'feed.json'), JSON.stringify(feed, null, '\t'));
    const nBefore = writeTree(path.join(dir, 'before'), beforeRef, refsForSide(refactorings, 'leftSideLocations'));
    const nAfter = writeTree(path.join(dir, 'after'), afterRef, refsForSide(refactorings, 'rightSideLocations'));

    const loc = ownerRepoFromUrl(feed.url) || { owner: 'owner', repo: 'repo', prNumber: String(feedPr) };
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      JSON.stringify({ lang, feedPr, beforeRef, afterRef, ...loc, url: feed.url }, null, '\t'),
    );

    console.log(`${lang}: ${refactorings.length} refactorings, ${nBefore} before / ${nAfter} after files`);
  });

  console.log(`\nFixtures written to ${path.relative(process.cwd(), OUT)}`);
}

main();
