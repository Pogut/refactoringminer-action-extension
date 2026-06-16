var RMX = window.RMX || (window.RMX = {});

// Fires the instant this script is injected, before any logic — lets us tell
// "not injected" apart from "injected but inactive/errored".
console.log('[RMX] content script injected:', location.href);

// Orchestrator: figure out the page, pick a view adapter, fetch the feed the
// action published, and paint the overlays. Re-runs on GitHub's soft (Turbo)
// navigations so the overlay survives tab switches within a PR.
(function () {
  async function run() {
    const loc = RMX.config.parseLocation();
    const adapter = RMX.views.pick(loc);
    if (!adapter) {
      console.info('[RMX] inactive on this page', loc);
      return; // not a page we overlay (or the adapter is disabled)
    }

    const url = RMX.config.feedUrl(loc);
    console.info(`[RMX] view=${loc.view} feed=${url}`);
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
    if (painted === 0) inspectChanges();
    handleDeepLink();
  }

  // Diagnostic for the new "/changes" React diff, which has no per-line ids.
  // Each file is a DIV#diff-<sha256(path)> container; this dumps the vocabulary
  // (data-* attribute names) and a markup snippet of the richest *rendered*
  // container so we can see how individual lines are marked. Runs once.
  function inspectChanges() {
    if (window.__rmxInspected) return;
    window.__rmxInspected = true;

    const containers = Array.prototype.slice
      .call(document.querySelectorAll('div[id^="diff-"]'))
      .filter((el) => /^diff-[0-9a-f]{64}$/.test(el.id));

    let best = null;
    containers.forEach((el) => {
      const n = el.querySelectorAll('*').length; // off-screen files are nearly empty (virtualized)
      if (!best || n > best.n) best = { el, n };
    });
    if (!best) {
      console.warn('[RMX] inspect: no file containers found');
      return;
    }

    const c = best.el;
    const dataAttrNames = new Set();
    c.querySelectorAll('*').forEach((el) => {
      for (let i = 0; i < el.attributes.length; i++) {
        const name = el.attributes[i].name;
        if (name.indexOf('data-') === 0) dataAttrNames.add(name);
      }
    });
    const lineEls = c.querySelectorAll('[data-line-number]');
    const sampleLines = Array.prototype.slice.call(lineEls, 0, 6).map(
      (e) => `${e.tagName}[data-line-number=${e.getAttribute('data-line-number')}].${String(e.className).slice(0, 30)}`,
    );

    const out = '[RMX] inspect ' + JSON.stringify({
      richestContainer: c.id.slice(0, 17),
      descendants: best.n,
      dataAttrNames: Array.from(dataAttrNames),
      lineNumberEls: lineEls.length,
      sampleLines,
      htmlSnippet: c.innerHTML.replace(/\s+/g, ' ').slice(0, 900),
    });
    console.warn(out);
    showDiag(out);
  }

  // Draws the diagnostic in a fixed, pre-selected textarea on the page so it can
  // be read/copied without DevTools. Temporary — removed once highlighting works.
  function showDiag(text) {
    let box = document.getElementById('rmx-diag');
    if (!box) {
      box = document.createElement('textarea');
      box.id = 'rmx-diag';
      box.readOnly = true;
      box.style.cssText =
        'position:fixed;top:8px;right:8px;z-index:2147483647;width:540px;height:240px;' +
        'background:#0d1117;color:#7ee787;border:2px solid #f0883e;border-radius:8px;' +
        'font:11px/1.4 ui-monospace,monospace;padding:8px;white-space:pre-wrap;overflow:auto;';
      document.body.appendChild(box);
    }
    box.value = text;
    box.focus();
    box.select();
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
