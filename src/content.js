var RMX = window.RMX || (window.RMX = {});

// Orchestrator: figure out the page, pick a view adapter, fetch the feed the
// action published, and paint the overlays. Re-paints on GitHub's soft (Turbo)
// navigations and as the virtualized diff mounts more rows on scroll.
(function () {
  let currentRefactorings = null;

  // Load stamp: logged once per injection so you can confirm at a glance which
  // build is actually running in the tab (reloading the *page* re-injects the
  // cached build; only reloading the *extension* picks up new src). Bump the
  // version in manifest.json when you change code. Guarded for the test harness,
  // where chrome.runtime is a stub without getManifest.
  const build = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || 'dev';
  console.info(`[RMX] content script loaded — build ${build}`);

  // Dual data sources: PR "Files changed" pages read the action's published
  // per-PR feed; commit pages (which have no feed) fall back to the hosted
  // RefactoringMiner service. Both land as a plain refactorings array that feeds
  // the same renderer + report panel.
  async function run() {
    const loc = RMX.config.parseLocation();
    if (!RMX.views.pick(loc)) return deactivate();

    let refactorings;
    if (loc.commitSha) {
      refactorings = await commitRefactorings(loc);
      if (refactorings === null) return; // hard failure — report already shows the error
    } else if (loc.prNumber) {
      refactorings = await prRefactorings(loc);
      if (refactorings === null) return deactivate();
    } else {
      return deactivate();
    }

    currentRefactorings = refactorings;
    await render(currentRefactorings);
    RMX.overlay.showReport(reportRows(currentRefactorings));
    observe();
  }

  // Commit page: ask the RefactoringMiner service (RMX.rm). Returns the array
  // (possibly empty) on success, or null when the service errored — in which case
  // the report panel is left showing that error and the caller stops.
  async function commitRefactorings(loc) {
    RMX.overlay.reportLoading('Analysing commit with RefactoringMiner…');
    let data;
    try {
      data = await RMX.rm.fetchCommit(RMX.config.gitUrl(loc), loc.commitSha);
    } catch (e) {
      RMX.overlay.clearAll();
      RMX.overlay.reportError(e.message || 'RefactoringMiner service unavailable.');
      return null;
    }
    const commit = firstCommit(data);
    if (!commit || !commitMatches(commit, loc) || !Array.isArray(commit.refactorings)) return [];
    return commit.refactorings;
  }

  // PR page: use the action's published per-PR feed. Returns the array, or null
  // when there's no usable feed (so the overlay stays off — the repo may not run
  // the action, in which case there's no PR-aggregate source to fall back to).
  async function prRefactorings(loc) {
    const url = RMX.config.feedUrl(loc);
    if (!url) return null;
    let feed;
    try {
      feed = await RMX.messaging.fetchFeed(url);
    } catch (e) {
      feed = await RMX.rm.fetchCommit(RMX.config.gitUrl(loc), loc.commitSha ? loc.commitSha : loc.prNumber);
      // condition ? expressionIfTrue : expressionIfFalse
    }
    const commit = firstCommit(feed);
    // Sanity guard: confirm the fetched feed really is for the PR on screen, so a
    // wrong feed published under this PR's path can't overlay another PR's data.
    if (!commit || !Array.isArray(commit.refactorings)) return null;
    return commit.refactorings;
  }

  // The RefactoringMiner service echoes the commit it analysed; confirm it's the
  // one on screen before painting. Unverifiable (no sha1) → don't block.
  function commitMatches(commit, loc) {
    const sha = (commit.sha1 || '').toLowerCase();
    const want = (loc.commitSha || '').toLowerCase();
    if (!sha || !want) return true;
    return sha.startsWith(want) || want.startsWith(sha);
  }

  // True when the fetched feed's PR url matches the PR we're viewing. `firstCommit`
  // carries `feed.url` for the native export and the per-commit url for the wrapped
  // form, so this covers both. Case-insensitive: GitHub owner/repo aren't case
  // sensitive, and the feed echoes whatever casing the PR was analysed under.
  function feedIsForPr(url, loc) {
    if (!url || !loc || !loc.prNumber) return false;
    try {
      return (
        new URL(url).pathname.toLowerCase() ===
        `/${loc.owner}/${loc.repo}/pull/${loc.prNumber}`.toLowerCase()
      );
    } catch (_) {
      return false;
    }
  }

  // Tear down tagged cells, the report panel, and any selection when we land on a
  // page with nothing to show (e.g. navigating away from the diff via Turbo).
  function deactivate() {
    currentRefactorings = null;
    RMX.overlay.clearAll();
    RMX.overlay.hideReport();
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
  // the tagged cells and the neon selection (and its fade) aren't disturbed as
  // the virtualized diff mounts new rows.
  async function render(refactorings, additive) {
    if (!additive) RMX.overlay.clearAll();
    RMX.overlay.installTooltip();

    // Precompute each file's digest (sha256(path)) once so tagging is sync.
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

    let tagged = 0;
    // Track every cell this pass tags, then drop tags left on cells that
    // virtualization recycled to a non-target line (see overlay.startPass).
    RMX.overlay.startPass();
    refactorings.forEach((r, index) => {
      const summary = summarize(r);
      tagged += paintSide(r.leftSideLocations, 'L', summary, index, digests);
      tagged += paintSide(r.rightSideLocations, 'R', summary, index, digests);
    });
    RMX.overlay.endPass();

    RMX.overlay.applySelection(); // re-apply neon selection to any newly mounted cells
    console.info(`[RMX] ${refactorings.length} refactorings, ${tagged} line-spans tagged`);
    handleDeepLink();
  }

  // Tags the diff cells for each of a side's locations so the click/deep-link
  // selection can find and blink them. Cells carry no visible style until
  // selected — only the refactoring index, side, file, and hover summary.
  function paintSide(locations, side, summary, index, digests) {
    const locs = locations || [];
    // Decide which lines a location contributes, applied identically to left and
    // right so related parts stay consistent:
    //   • A newly created declaration (added getter, extracted method/type) is
    //     genuine new code → tag it in full.
    //   • Otherwise a big enclosing method/type declaration is context: skip it
    //     when the side has a finer location to tag instead, or — when it's the
    //     only location (Rename/Pull Up/Move/Change-modifier on a whole method or
    //     type) — tag just its header line so the side is still selectable without
    //     flooding the diff.
    //   • Anything finer (statement, field, param, conditional…) → full range.
    const hasFiner = locs.some((cr) => !isContainer(cr));
    let tagged = 0;
    locs.forEach((cr) => {
      let startLine = cr.startLine;
      let endLine = cr.endLine;
      if (isContainer(cr) && !isNewDeclaration(cr)) {
        if (hasFiner) return;
        endLine = startLine; // declaration-only refactoring → header line only
      }
      const digest = digests[cr.filePath];
      if (!digest) return;
      tagged += RMX.overlay.highlightRange({
        digest,
        side,
        startLine,
        endLine,
        summary,
        index,
        filePath: cr.filePath,
      });
    });
    return tagged;
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

  // Report rows: the type (shown bold) plus a type-free element summary, and the
  // full description as the row's hover title. `index` links a row back to its
  // tagged cells so a click selects/blinks it.
  function reportRows(refactorings) {
    return refactorings.map((r, index) => ({
      index,
      type: r.type,
      summary: elementSummary(r),
      detail: r.description || '',
    }));
  }
  function elementSummary(r) {
    const left = firstCodeElement(r.leftSideLocations);
    const right = firstCodeElement(r.rightSideLocations);
    if (left && right && left !== right) return `${shorten(left)} → ${shorten(right)}`;
    return shorten(right || left || r.description || '');
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

  // The /changes diff is virtualized: rows mount as you scroll. Re-tag
  // (debounced) when the diff DOM grows, so newly mounted lines get tagged.
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
  // to run when you move between pages
  document.addEventListener('turbo:load', schedule);
  document.addEventListener('pjax:end', schedule);
  window.addEventListener('popstate', schedule);
  // Following another comment link while already on the diff only changes the
  // hash — re-run the deep-link blink for the new anchor.
  window.addEventListener('hashchange', handleDeepLink);
  schedule();
})();
