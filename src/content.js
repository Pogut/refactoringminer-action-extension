var RMX = window.RMX || (window.RMX = {});

// Orchestrator: figure out the page, pick a view adapter, fetch the feed the
// action published, and paint the overlays. Re-paints on GitHub's soft (Turbo)
// navigations and as the virtualized diff mounts more rows on scroll.
(function () {
  let currentRefactorings = null;
  let autoTrigger = false;
  // Bumped on every run() so an in-flight analysis from a page we've since
  // navigated away from can detect it's stale and drop its result instead of
  // painting the old refactorings onto the new page (the "panel stays there when
  // I move between pages" bug).
  let gen = 0;

  // Load stamp: logged once per injection so you can confirm at a glance which
  // build is actually running in the tab (reloading the *page* re-injects the
  // cached build; only reloading the *extension* picks up new src). Bump the
  // version in manifest.json when you change code. Guarded for the test harness,
  // where chrome.runtime is a stub without getManifest.
  const build = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || 'dev';
  console.info(`[RMX] content script loaded — build ${build}`);

  // Each page overlays ONLY what it shows, and every page prefers the action's
  // published feed, falling back to the hosted RefactoringMiner service when the
  // repo doesn't run the action:
  //   • "Files changed" (whole PR)  → PR-aggregate feed, else one PR-level RM call
  //   • a commit (standalone or in a PR) → that commit's feed entry, else one
  //                                        single-commit RM call for that sha
  // All paths land as a plain refactorings array feeding the same renderer +
  // report panel.
  async function run() {
    const myGen = ++gen;
    const loc = RMX.config.parseLocation();
    if (!RMX.views.pick(loc)) return deactivate();

    // Tear the previous page's overlay/panel down *before* the (possibly slow)
    // analysis starts, so nothing stale lingers on screen and the scroll
    // observer can't repaint the old page's refactorings while we load.
    resetForLoad();

    const refactorings =
      loc.view === 'files'
        ? await filesRefactorings(loc)
        : await commitRefactorings(loc);

    if (myGen !== gen) return; // navigated away mid-analysis — this result is stale
    if (refactorings === null) return; // hard failure — report already shows the error

    currentRefactorings = refactorings;
    await render(currentRefactorings);
    if (myGen !== gen) return;
    RMX.overlay.showReport(reportRows(currentRefactorings));
    observe();
  }

  // Whole-PR "Files changed" page. The action's feed is PR-aggregate, so it maps
  // straight onto this view; without it, analyse the entire PR in ONE service
  // call (integer commitId ⇒ detectAtPullRequest), never a per-commit loop.
  async function filesRefactorings(loc) {
    const fromFeed = await feedRefactorings(loc);
    if (fromFeed) return fromFeed;
    RMX.overlay.reportLoading('Analysing pull request with RefactoringMiner…');
    return minerRefactorings(loc, loc.prNumber);
  }

  // A single commit's page (standalone /commit/<sha>, or a commit inside a PR).
  // It shows one commit's diff, so we only ever want THAT commit's refactorings —
  // never the PR aggregate (which is the "shows all refactorings within the PR on
  // one commit" bug). Use the feed only if it's a per-commit export listing this
  // sha; otherwise analyse just this commit.
  async function commitRefactorings(loc) {
    const fromFeed = await feedRefactorings(loc, loc.commitSha);
    if (fromFeed) return fromFeed;
    RMX.overlay.reportLoading('Analysing commit with RefactoringMiner…');
    return minerRefactorings(loc, loc.commitSha);
  }

  // Read the action's published feed. Returns the refactorings array, or null
  // when there's no feed / it can't be fetched (repo doesn't run the action) / it
  // isn't for this page. `wantSha` scopes the lookup to a single commit's entry;
  // omit it to take the PR-aggregate object (files page).
  async function feedRefactorings(loc, wantSha) {
    const url = RMX.config.feedUrl(loc);
    if (!url) return null; // no PR number ⇒ standalone commit, no feed exists
    let feed;
    try {
      feed = await RMX.messaging.fetchFeed(url);
    } catch (_) {
      return null; // 404 etc. ⇒ caller falls back to the RefactoringMiner service
    }
    const commit = wantSha ? commitForSha(feed, wantSha) : firstCommit(feed);
    if (!commit || !Array.isArray(commit.refactorings)) return null;
    // Files page: confirm the feed really is for the PR on screen, so a wrong
    // feed published under this PR's path can't overlay another PR's data.
    if (!wantSha && commit.url && !feedIsForPr(commit.url, loc)) return null;
    return commit.refactorings;
  }

  // Analyse via the RefactoringMiner service. `id` is a commit sha (single-commit
  // analysis) or a PR number (whole-PR analysis). Returns the refactorings array
  // (possibly empty), or null on a service/network error — in which case the
  // report panel is left showing that error and the caller stops.
  async function minerRefactorings(loc, id) {
    let data;
    try {
      data = await RMX.rm.fetchCommit(RMX.config.gitUrl(loc), id);
    } catch (e) {
      RMX.overlay.clearAll();
      RMX.overlay.reportError(e.message || 'RefactoringMiner service unavailable.');
      return null;
    }
    const commit = firstCommit(data);
    if (!commit || !Array.isArray(commit.refactorings)) return [];
    // On a single-commit request, confirm the service echoed the sha we asked
    // about before painting. A PR-number request echoes the PR, not a sha, so
    // only apply this guard when we actually requested this page's commit.
    if (id === loc.commitSha && !commitMatches(commit, loc)) return [];
    return commit.refactorings;
  }

  // Find a specific commit in a `{ commits: [ … ] }` feed by sha1 (prefix match).
  // The action currently publishes a PR-aggregate feed — a single object keyed by
  // the PR, not per commit — so this normally returns null on a commit page, and
  // the caller then analyses that one commit directly. (If the action ever starts
  // exporting a per-commit feed, commit pages pick it up here for free.)
  function commitForSha(feed, sha) {
    const list = feed && Array.isArray(feed.commits) ? feed.commits : [];
    const want = (sha || '').toLowerCase();
    return (
      list.find((c) => {
        const s = (c.sha1 || '').toLowerCase();
        return s && (s.startsWith(want) || want.startsWith(s));
      }) || null
    );
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
    ++gen; // invalidate an analysis that may still be awaiting a response
    currentRefactorings = null;
    RMX.overlay.clearSelection();
    RMX.overlay.clearAll();
    RMX.overlay.hideReport();
  }

  // Same teardown, but for a page we *are* going to overlay: clear the previous
  // page's state up front so it can't show through (or be repainted by the scroll
  // observer, which is gated on currentRefactorings) while this page analyses. The
  // report panel is removed here and recreated by the loading/result step, so it
  // never briefly displays the prior page's rows.
  function resetForLoad() {
    currentRefactorings = null;
    RMX.overlay.clearSelection();
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

    // Hand the overlay a representative line per refactoring so a selection can
    // reveal a collapsed/folded file whose lines tagged nothing this pass.
    RMX.overlay.setTargets(selectTargets(refactorings, digests));

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

  // A representative { digest, side, line } per refactoring — the first location
  // on the right side, else the left. The overlay reveals this file (clicking
  // "Load diff" / "Expand all") before selecting, so a report-row or deep-link
  // selection lands even when the target file was collapsed and tagged nothing.
  function selectTargets(refactorings, digests) {
    const targets = {};
    refactorings.forEach((r, index) => {
      const right = (r.rightSideLocations || [])[0];
      const loc = right || (r.leftSideLocations || [])[0];
      const digest = loc && digests[loc.filePath];
      if (!digest) return;
      targets[index] = { digest, side: right ? 'R' : 'L', line: loc.startLine };
    });
    return targets;
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

  let scheduleTimer = null;
  function schedule() {
    RMX.github.resetCache();
    clearTimeout(scheduleTimer); // collapse the burst of events one nav emits
    if (!autoTrigger) {
      deactivate();
      return;
    }
    scheduleTimer = setTimeout(run, 300);
  }

  // Everything above the hash: the page identity we care about. Hash-only
  // changes are deep links into the *same* page and are handled by
  // handleDeepLink, so they must not trigger a full re-run.
  function pageKey() {
    return window.location.origin + window.location.pathname + window.location.search;
  }

  // Fire schedule() on any real page change, however GitHub performed it.
  //
  // GitHub's newer PR UI navigates with history.pushState (React Router) and
  // emits none of the events below: no turbo:load, no popstate (that's only for
  // back/forward). Nor can we intercept it — a content script's `history` is its
  // isolated world's own object, so patching pushState here never sees the
  // page's calls. Polling the URL is the one signal that catches every case, and
  // a string compare every 250ms is free next to what the page itself is doing.
  //
  // Without this, moving from the diff to a page we don't overlay (the PR's
  // Commits list, Conversation, …) left the previous page's report panel and
  // tags on screen, because run() — and the deactivate() that tears them down —
  // never fired.
  let lastKey = pageKey();
  function watchUrl() {
    const key = pageKey();
    if (key === lastKey) return;
    lastKey = key;
    lastDeepLink = ''; // new page ⇒ its hash is a fresh deep link
    schedule();
  }
  setInterval(watchUrl, 250);

  // Still listen for the framework events: on the pages GitHub serves with
  // Turbo they land sooner than the next poll tick.
  document.addEventListener('turbo:load', watchUrl);
  document.addEventListener('pjax:end', watchUrl);
  window.addEventListener('popstate', watchUrl);
  // Following another comment link while already on the diff only changes the
  // hash — re-run the deep-link blink for the new anchor.
  window.addEventListener('hashchange', handleDeepLink);

  // Click-to-activate is the default. Only an explicitly stored true value runs
  // automatically; otherwise the content script waits for the toolbar button.
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'RMX_ACTIVATE') run();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.autoTrigger) return;
    autoTrigger = changes.autoTrigger.newValue === true;
    if (autoTrigger) schedule();
    else {
      clearTimeout(scheduleTimer);
      deactivate();
    }
  });
  chrome.storage.sync.get(['autoTrigger'], (settings) => {
    autoTrigger = !!settings && settings.autoTrigger === true;
    if (autoTrigger) schedule();
  });
})();
