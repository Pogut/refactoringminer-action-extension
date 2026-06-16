var RMX = window.RMX || (window.RMX = {});

// Orchestrator: figure out the page, pick a view adapter, fetch the feed the
// action published, and paint the overlays. Re-paints on GitHub's soft (Turbo)
// navigations and as the virtualized diff mounts more rows on scroll.
(function () {
  let currentRefactorings = null;

  async function run() {
    const loc = RMX.config.parseLocation();
    if (!RMX.views.pick(loc) || !RMX.config.feedUrl(loc)) return deactivate();

    let feed;
    try {
      feed = await RMX.messaging.fetchFeed(RMX.config.feedUrl(loc));
    } catch (e) {
      return deactivate(); // no feed published for this PR
    }
    const commit = firstCommit(feed);
    if (!commit || !Array.isArray(commit.refactorings)) return deactivate();

    currentRefactorings = commit.refactorings;
    await render(currentRefactorings);
    observe();
  }

  // Tear down overlays + legend when we land on a page with nothing to show
  // (e.g. navigating away from the PR diff via Turbo).
  function deactivate() {
    currentRefactorings = null;
    RMX.overlay.clearAll();
    RMX.overlay.hideLegend();
  }

  // The action publishes RefactoringMiner's native export `{ url, refactorings }`;
  // also accept the wrapped `{ commits: [ … ] }` form.
  function firstCommit(feed) {
    if (!feed) return null;
    if (Array.isArray(feed.commits)) return feed.commits[0] || null;
    if (Array.isArray(feed.refactorings)) return { url: feed.url, refactorings: feed.refactorings };
    return null;
  }

  // --- rendering ------------------------------------------------------------

  // `additive` re-paints without clearing first — used by the scroll observer so
  // existing highlights and the neon selection (and its fade) aren't disturbed
  // as the virtualized diff mounts new rows.
  async function render(refactorings, additive) {
    if (!additive) RMX.overlay.clearAll();
    RMX.overlay.installTooltip();

    // Precompute each file's digest (sha256(path)) once so painting is sync.
    const paths = new Set();
    refactorings.forEach((r) => {
      (r.leftSideLocations || []).forEach((cr) => paths.add(cr.filePath));
      (r.rightSideLocations || []).forEach((cr) => paths.add(cr.filePath));
    });
    const digests = {};
    await Promise.all(
      Array.from(paths).map(async (p) => {
        digests[p] = await RMX.github.fileDigest(p);
      }),
    );

    const used = new Set();
    let painted = 0;
    refactorings.forEach((r, index) => {
      const summary = summarize(r);
      painted += paintSide(r.leftSideLocations, 'L', r.type, summary, index, digests, used);
      painted += paintSide(r.rightSideLocations, 'R', r.type, summary, index, digests, used);
    });

    RMX.overlay.showLegend(Array.from(used));
    RMX.overlay.applySelection(); // re-apply neon selection to any newly mounted cells
    console.info(`[RMX] ${refactorings.length} refactorings, ${painted} line-spans highlighted`);
    handleDeepLink();
  }

  function paintSide(locations, side, type, summary, index, digests, used) {
    let painted = 0;
    (locations || []).forEach((cr) => {
      if (isContext(cr)) return;
      const category = categorize(type, side, cr.description);
      used.add(category); // legend reflects every category in the feed, mounted or not
      const digest = digests[cr.filePath];
      if (!digest) return;
      painted += RMX.overlay.highlightRange({
        digest,
        side,
        startLine: cr.startLine,
        endLine: cr.endLine,
        category,
        summary,
        index,
      });
    });
    return painted;
  }

  // RefactoringMiner includes the enclosing source/target method or type as a
  // location for context; highlighting those whole bodies floods the diff. Skip
  // them so only the elements that actually changed get coloured.
  const CONTEXT_DESC = [
    'source method declaration',
    'target method declaration',
    'original method declaration',
    'method declaration with',
    'original type declaration',
    'sub-type declaration',
    'type declaration after',
    'type declaration before',
  ];
  function isContext(loc) {
    if ((loc.endLine - loc.startLine) < 2) return false; // small ranges are specific enough
    const d = (loc.description || '').toLowerCase();
    return CONTEXT_DESC.some((s) => d.indexOf(s) !== -1);
  }

  // Map a location to one of RefactoringMiner's legend colours. Approximated
  // from the refactoring type, the diff side, and the location's role (the
  // action-level kind isn't carried in this feed).
  function categorize(type, side, desc) {
    const d = (desc || '').toLowerCase();
    const t = (type || '').toLowerCase();
    if (d.indexOf('moved') !== -1 || d.indexOf('pulled up') !== -1 || t.indexOf('move') === 0 || t.indexOf('pull up') === 0) {
      return side === 'R' ? 'movedIn' : 'movedOut';
    }
    if (d.indexOf('inlined') !== -1) return side === 'R' ? 'inserted' : 'deleted';
    if (d.indexOf('extracted') !== -1 || d.indexOf('added') !== -1 || t.indexOf('extract') === 0) {
      return side === 'R' ? 'inserted' : 'updated';
    }
    if (d.indexOf('renamed') !== -1 || t.indexOf('rename') === 0 || t.indexOf('change') === 0 || d.indexOf('referencing') !== -1) {
      return 'updated';
    }
    return side === 'R' ? 'inserted' : 'deleted';
  }

  // Concise one-liner, e.g. "Rename Attribute: _full_name → _display_name".
  function summarize(r) {
    const left = firstCodeElement(r.leftSideLocations);
    const right = firstCodeElement(r.rightSideLocations);
    if (left && right && left !== right) return `${r.type}: ${shorten(left)} → ${shorten(right)}`;
    return `${r.type}: ${shorten(right || left || '')}`.replace(/: $/, '');
  }
  function firstCodeElement(locations) {
    const hit = (locations || []).find((l) => l.codeElement);
    return hit ? hit.codeElement : null;
  }
  function shorten(s) {
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  }

  // ?rm=<feedIndex> (set by the action's PR comment links) scrolls to + flashes.
  function handleDeepLink() {
    const m = /[?&#]rm=(\d+)/.exec(window.location.href);
    if (m) RMX.overlay.scrollToRefactoring(Number(m[1]));
  }

  // --- lifecycle ------------------------------------------------------------

  // The /changes diff is virtualized: rows mount as you scroll. Re-paint
  // (debounced) when the diff DOM grows, so newly mounted lines get coloured.
  // We observe childList only, so our own class/attribute writes don't re-trigger.
  let observer = null;
  let repaintTimer = null;
  function observe() {
    if (observer) return;
    observer = new MutationObserver(() => {
      clearTimeout(repaintTimer);
      repaintTimer = setTimeout(() => {
        if (currentRefactorings) render(currentRefactorings, true);
      }, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function schedule() {
    RMX.github.resetCache();
    setTimeout(run, 300);
  }

  document.addEventListener('turbo:load', schedule);
  document.addEventListener('pjax:end', schedule);
  window.addEventListener('popstate', schedule);
  schedule();
})();
