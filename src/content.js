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
    // Track every cell this pass paints, then drop highlights left on cells that
    // virtualization recycled to a non-target line (see overlay.startPass).
    RMX.overlay.startPass();
    refactorings.forEach((r, index) => {
      const summary = summarize(r);
      painted += paintSide(r.leftSideLocations, 'L', r.type, summary, index, digests, used);
      painted += paintSide(r.rightSideLocations, 'R', r.type, summary, index, digests, used);
    });
    RMX.overlay.endPass();

    RMX.overlay.showLegend(Array.from(used));
    RMX.overlay.applySelection(); // re-apply neon selection to any newly mounted cells
    console.info(`[RMX] ${refactorings.length} refactorings, ${painted} line-spans highlighted`);
    handleDeepLink();
  }

  function paintSide(locations, side, type, summary, index, digests, used) {
    const locs = locations || [];
    // Decide how each location is shown, applied identically to left and right so
    // related parts stay consistent:
    //   • A newly created declaration (added getter, extracted method/type) is
    //     genuine new code → highlight it in full.
    //   • Otherwise a big enclosing method/type declaration is context: skip it
    //     when the side has a finer location to show instead, or — when it's the
    //     only location (Rename/Pull Up/Move/Change-modifier on a whole method or
    //     type) — colour just its header line so the side still shows without
    //     flooding the diff.
    //   • Anything finer (statement, field, param, conditional…) → full range.
    const hasFiner = locs.some((cr) => !isContainer(cr));
    let painted = 0;
    locs.forEach((cr) => {
      let startLine = cr.startLine;
      let endLine = cr.endLine;
      if (isContainer(cr) && !isNewDeclaration(cr)) {
        if (hasFiner) return;
        endLine = startLine; // declaration-only refactoring → header line only
      }
      const category = categorize(type, side, cr.description);
      used.add(category); // legend reflects every category in the feed, mounted or not
      const digest = digests[cr.filePath];
      if (!digest) return;
      painted += RMX.overlay.highlightRange({
        digest,
        side,
        startLine,
        endLine,
        category,
        summary,
        index,
        filePath: cr.filePath,
      });
    });
    return painted;
  }

  // A whole enclosing method/class declaration spanning multiple lines.
  // RefactoringMiner includes these for context next to the specific changed
  // lines; highlighting their entire bodies floods the diff.
  function isContainer(loc) {
    const t = loc.codeElementType || '';
    return (t === 'METHOD_DECLARATION' || t === 'TYPE_DECLARATION') && loc.endLine - loc.startLine >= 2;
  }

  // A declaration RefactoringMiner reports as freshly created — the getter an
  // Encapsulate Attribute adds, or the method/type an Extract produces. It's
  // genuinely new code, so it should be highlighted in full rather than skipped
  // as enclosing context. ("extracted" matches the new declaration but not the
  // "before/after extraction" source/target methods, which stay context.)
  function isNewDeclaration(loc) {
    const d = (loc.description || '').toLowerCase();
    return d.indexOf('added') !== -1 || d.indexOf('extracted') !== -1;
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

  // When the user follows one of the action's PR-comment links, GitHub lands us
  // on its native line anchor — #diff-<sha256(path)><L|R><line>, which is exactly
  // our data-line-anchor. Blink that refactoring so they see where it is (and its
  // counterpart). Deduped via lastDeepLink so re-paints don't keep re-triggering
  // it and so a manual click afterwards isn't overridden.
  let lastDeepLink = '';
  function handleDeepLink() {
    const m = /#(diff-[0-9a-f]{64}[LR]\d+)/.exec(window.location.hash);
    if (!m) return;
    const anchor = m[1];
    if (anchor === lastDeepLink) return;
    const cell = document.querySelector(`[data-line-anchor="${anchor}"]`) || document.getElementById(anchor);
    const idx = cell && cell.getAttribute('data-rmx-index');
    if (!idx) return; // target not painted/mounted yet — a later re-paint retries
    lastDeepLink = anchor;
    RMX.overlay.select(idx.split(' '));
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
  // Following another comment link while already on the diff only changes the
  // hash — re-run the deep-link blink for the new anchor.
  window.addEventListener('hashchange', handleDeepLink);
  schedule();
})();
