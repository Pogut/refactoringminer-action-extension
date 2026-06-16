// RMX = RefactoringMiner-action eXtension.
//
// MV3 content scripts listed together run in one isolated world and share a
// global scope, so each file hangs its module off this single `RMX` namespace
// rather than using ES `import`/`export` (which content scripts don't support).
var RMX = window.RMX || (window.RMX = {});

RMX.config = (function () {
  // Must mirror refactoringminer-action's publish layout (publisher.js +
  // exporter.js): the feed sits one level above the interactive `list/` view.
  //   https://<owner>.github.io/<repo>/refactorings/pr-<n>/refactorings.json
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

    if (kind === 'pull' && id && sub === 'files') {
      return { owner, repo, prNumber: id, view: 'files' };
    }
    if (kind === 'pull' && id && sub === 'commits' && subId) {
      return { owner, repo, prNumber: id, commitSha: subId, view: 'commit' };
    }
    if (kind === 'commit' && id) {
      return { owner, repo, commitSha: id, view: 'commit' };
    }
    return null;
  }

  // The action publishes one feed per PR; commit-only pages (no PR number) have
  // no feed yet, so this returns null and the overlay stays off there.
  function feedUrl(loc) {
    if (!loc || !loc.prNumber) return null;
    return (
      `https://${loc.owner.toLowerCase()}.github.io/${loc.repo}` +
      `/${PAGES_ROOT}/pr-${loc.prNumber}/${FEED_FILE}`
    );
  }

  return { parseLocation, feedUrl };
})();
