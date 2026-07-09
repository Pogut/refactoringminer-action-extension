var RMX = window.RMX || (window.RMX = {});

// Standalone data source. When there's no action-published feed — commit pages,
// or repos that don't run the RefactoringMiner GitHub Action — we ask a hosted
// RefactoringMiner web service to analyse the commit and hand back its native
// `{ commits: [ … ] }` JSON, the same approach the Refactoring-Aware-Commit-Review
// extension uses. This runs from the content script; the default server sends
// `Access-Control-Allow-Origin: *`, so no host permission is needed. A
// self-hosted server must send permissive CORS too (configure it in options).
RMX.rm = (function () {
  const DEFAULTS = {
    // Concordia's public RefactoringMiner server (same default as
    // Refactoring-Aware-Commit-Review). Override in the extension's options page.
    baseurl: 'https://rminer.encs.concordia.ca:8000/RefactoringMiner',
    token: '', // GitHub OAuth token for private repos (optional)
    timeout: 60, // seconds the server waits before giving up
  };

  // Analysis is expensive server-side, so memoise per commit for this page
  // session (the content script — and this cache — survive Turbo navigations).
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

  // Resolves to RefactoringMiner's `{ commits: [ … ] }` for the commit, or throws
  // on an HTTP/network error (the caller surfaces that in the report panel).
  async function fetchCommit(gitUrl, commitId) {
    if (cache.has(commitId)) return cache.get(commitId);
    const cfg = await settings();
    const url =
      `${cfg.baseurl}?gitURL=${encodeURIComponent(gitUrl)}` +
      `&commitId=${encodeURIComponent(commitId)}` +
      `&timeout=${encodeURIComponent(cfg.timeout)}` +
      (cfg.token ? `&token=${encodeURIComponent(cfg.token)}` : '');
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`RefactoringMiner service returned HTTP ${res.status}`);
    const data = await res.json();
    cache.set(commitId, data);
    return data;
  }

  return { DEFAULTS, fetchCommit };
})();
