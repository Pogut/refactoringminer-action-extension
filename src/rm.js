var RMX = window.RMX || (window.RMX = {});

// Standalone data source. When there's no action-published feed — commit pages,
// or repos that don't run the RefactoringMiner GitHub Action — we ask a hosted
// RefactoringMiner web service to analyse the change and hand back its native
// `{ commits: [ … ] }` JSON, the same approach the Refactoring-Aware-Commit-Review
// extension uses. This runs from the content script; the default server sends
// `Access-Control-Allow-Origin: *`, so no host permission is needed. A
// self-hosted server must send permissive CORS too (configure it in options).
//
// The single `?gitURL&commitId&timeout&token` endpoint serves both granularities:
// the service treats an *integer* commitId as a pull-request number and runs
// detectAtPullRequest (aggregating every commit in the PR into one result), and a
// *sha* commitId as a single commit. So the whole-PR "Files changed" page is one
// request (no per-commit loop), and a single commit page is a separate request
// for just that sha.
RMX.rm = (function () {
  const DEFAULTS = {
    // Concordia's public RefactoringMiner server (same default as
    // Refactoring-Aware-Commit-Review). Override in the extension's options page.
    baseurl: 'https://rminer.encs.concordia.ca:8000/RefactoringMiner',
    token: '', // GitHub OAuth token for private repos (optional)
    timeout: 60, // seconds the server waits before giving up
  };

  // Analysis is expensive server-side, so memoise per request for this page
  // session (the content script — and this cache — survive Turbo navigations).
  // Keyed by gitURL + id so a PR number can't collide with a commit sha, and so
  // the same id in two different repos stays separate.
  const cache = new Map();

  function settings() {
    return new Promise((resolve) => {
      const store =
        typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
      if (!store) return resolve(Object.assign({}, DEFAULTS));
      store.get(['baseurl', 'token', 'timeout'], (r) => {
        r = r || {};
        resolve({
          baseurl: r.baseurl || DEFAULTS.baseurl,
          token: r.token || DEFAULTS.token,
          timeout: r.timeout || DEFAULTS.timeout,
        });
      });
    });
  }

  // Resolves to RefactoringMiner's `{ commits: [ … ] }`, or throws on an
  // HTTP/network error (the caller surfaces that in the report panel). `id` is a
  // commit sha (single-commit analysis) or a PR number (whole-PR analysis) — the
  // service branches on whether it parses as an integer.
  async function fetchCommit(gitUrl, id) {
    const key = `${gitUrl}@${id}`;
    if (cache.has(key)) return cache.get(key);
    const cfg = await settings();
    const url =
      `${cfg.baseurl}?gitURL=${encodeURIComponent(gitUrl)}` +
      `&commitId=${encodeURIComponent(id)}` +
      `&timeout=${encodeURIComponent(cfg.timeout)}` +
      (cfg.token ? `&token=${encodeURIComponent(cfg.token)}` : '');
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`RefactoringMiner service returned HTTP ${res.status}`);
    const data = await res.json();
    cache.set(key, data);
    return data;
  }

  return { DEFAULTS, fetchCommit };
})();
