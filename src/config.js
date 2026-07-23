// RMX = RefactoringMiner-action eXtension.
//
// MV3 content scripts listed together run in one isolated world and share a
// global scope, so each file hangs its module off this single `RMX` namespace
// rather than using ES `import`/`export` (which content scripts don't support).
window.RMX = window.RMX || {};

window.RMX.config = (function () {
  // Must mirror refactoringminer-action's publish layout: the Actions-based Pages
  // deploy bundles every PR's exported view under refactorings/pr-<n>/, so each
  // PR's feed sits one level above its interactive `list/` view.
  //   https://<owner>.github.io/<repo>/refactorings/pr-<n>/refactorings.json
  // content.js still verifies the fetched feed is for the PR on screen before
  // painting (see feedIsForPr).
  const PAGES_ROOT = 'refactorings';
  const FEED_FILE = 'refactorings.json';

  // Recognise the three pages we can overlay and extract owner/repo/PR/commit.
  // Returns null for any other GitHub page so the content script stays inert.
  function parseLocation(href) {
    let u;
    try {
      u = new URL(href || window.location.href);
    } catch (_) {
      return null;
    }
    if (u.hostname !== 'github.com') return null;

    const [owner, repo, kind, id, sub, subId] = u.pathname.split('/').filter(Boolean);
    if (!owner || !repo) return null;

    // GitHub serves the PR diff at /files (classic) or /changes (the newer
    // "Preview" diff experience); both are the whole-PR "Files changed" view.
    // The Preview UI also deep-links a *single* commit as /changes/<sha> — when
    // that trailing sha is present it's one commit, not the whole PR, so route
    // it to the commit view (this is what stops a single-commit page from being
    // analysed — and overlaid — as the entire pull request).
    if (kind === 'pull' && id && (sub === 'files' || sub === 'changes')) {
      if (subId) return { owner, repo, prNumber: id, commitSha: subId, view: 'commit' };
      return { owner, repo, prNumber: id, view: 'files' };
    }
    // Classic single-commit-within-a-PR page: /pull/<n>/commits/<sha>.
    if (kind === 'pull' && id && sub === 'commits' && subId) {
      return { owner, repo, prNumber: id, commitSha: subId, view: 'commit' };
    }
    // Standalone commit page (not inside a PR): /commit/<sha>.
    if (kind === 'commit' && id) {
      return { owner, repo, commitSha: id, view: 'commit' };
    }
    return null;
  }

  // The action publishes one feed per PR under refactorings/pr-<n>/; commit-only
  // pages (no PR number) never carry one, so this returns null and the overlay
  // falls back to the RefactoringMiner service (see RMX.rm) for those.
  function feedUrl(loc) {
    if (!loc || !loc.prNumber) return null;
    return (
      `https://${loc.owner.toLowerCase()}.github.io/${loc.repo}` +
      `/${PAGES_ROOT}/pr-${loc.prNumber}/${FEED_FILE}`
    );
  }

  // The `.git` clone URL the RefactoringMiner service analyses (standalone mode).
  function gitUrl(loc) {
    if (!loc || !loc.owner || !loc.repo) return null;
    return `https://github.com/${loc.owner}/${loc.repo}.git`;
  }

  return { parseLocation, feedUrl, gitUrl };
})();
