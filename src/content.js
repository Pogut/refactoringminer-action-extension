var RMX = window.RMX || (window.RMX = {});

// Orchestrator: figure out the page, pick a view adapter, fetch the feed the
// action published, and paint the overlays. Re-runs on GitHub's soft (Turbo)
// navigations so the overlay survives tab switches within a PR.
(function () {
  async function run() {
    const loc = RMX.config.parseLocation();
    const adapter = RMX.views.pick(loc);
    if (!adapter) return; // not a page we overlay (or the adapter is disabled)

    const url = RMX.config.feedUrl(loc);
    if (!url) return;

    let feed;
    try {
      feed = await RMX.messaging.fetchFeed(url);
    } catch (e) {
      console.info(`[RMX] no feed for this page (${e.message})`);
      return;
    }

    const commit = firstCommit(feed);
    if (!commit || !Array.isArray(commit.refactorings)) return;

    render(commit.refactorings);
  }

  // The action publishes RefactoringMiner's native export, `{ url, refactorings }`.
  // Accept that and the wrapped `{ commits: [ … ] }` form interchangeably.
  function firstCommit(feed) {
    if (!feed) return null;
    if (Array.isArray(feed.commits)) return feed.commits[0] || null;
    if (Array.isArray(feed.refactorings)) return { url: feed.url, refactorings: feed.refactorings };
    return null;
  }

  function render(refactorings) {
    RMX.overlay.clearAll();
    RMX.overlay.installTooltip();

    let painted = 0;
    refactorings.forEach((r, index) => {
      const label = r.type + (r.description ? ` — ${r.description}` : '');
      painted += paintSide(r.leftSideLocations, 'L', label, index);
      painted += paintSide(r.rightSideLocations, 'R', label, index);
    });

    console.info(`[RMX] ${refactorings.length} refactorings, ${painted} lines highlighted`);
    handleDeepLink();
  }

  function paintSide(locations, side, label, index) {
    let painted = 0;
    (locations || []).forEach((cr) => {
      const anchor = RMX.github.anchorForFile(cr.filePath);
      painted += RMX.overlay.highlightRange({
        anchor,
        side,
        startLine: cr.startLine,
        endLine: cr.endLine,
        label,
        index,
      });
    });
    return painted;
  }

  // ?rm=<feedIndex> (set by the action's PR comment links) scrolls to and
  // flashes that refactoring once the overlays are painted.
  function handleDeepLink() {
    const m = /[?&#]rm=(\d+)/.exec(window.location.href);
    if (m) RMX.overlay.scrollToRefactoring(Number(m[1]));
  }

  // Turbo/PJAX soft navigation: the DOM swaps without a full reload, so re-run
  // after it settles. A short delay lets the new diff mount first.
  function schedule() {
    RMX.github.resetCache();
    setTimeout(run, 300);
  }

  document.addEventListener('turbo:load', schedule);
  document.addEventListener('pjax:end', schedule);
  window.addEventListener('popstate', schedule);
  schedule();
})();
