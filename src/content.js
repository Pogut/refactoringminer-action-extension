window.RMX = window.RMX || {};

// Orchestrator: figure out the page, pick a view adapter, fetch the feed the
// action published, and paint the overlays. Re-paints on GitHub's soft (Turbo)
// navigations and as the virtualized diff mounts more rows on scroll.
//
// Injected two ways, both narrowed to the diff URLs in the manifest:
//   • declaratively, when a diff URL is loaded as a DOCUMENT, and
//   • on demand by the service worker, when GitHub pushState-navigates INTO one
//     from a page this script doesn't cover (the repo page, the pull list, a
//     notification). No document loads on those, so nothing would be injected
//     otherwise — see ensureInjected in service-worker.js.
// `window.__rmxLoaded` below is what the second path checks to avoid injecting
// over a copy that is already running.
(function () {
  // Both injection paths can land on the same page — the service worker checks
  // this flag before injecting, but a declarative injection racing an on-demand
  // one would otherwise start a second copy: two URL pollers, two sets of
  // listeners, two analyses of the same page. Bail rather than double up.
  if (window.__rmxLoaded) return;
  window.__rmxLoaded = true;

  const RMX = window.RMX;
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

  // The paint plan is pure data compiled from the feed ONCE per page: every
  // (file digest, side, line) any refactoring paints on, keyed for O(1) lookup
  // while the overlay scans the mounted cells. Memoized on the refactorings
  // array's identity, so the scroll repaints (which used to re-derive every
  // range and re-query the document per line) reuse it as-is. This is what
  // keeps a 1000-refactoring page painting at the same cost as a 2-refactoring
  // one: the per-paint work depends only on how many cells are on screen.
  let planCache = { source: null, promise: null };
  function planFor(refactorings) {
    if (planCache.source !== refactorings) {
      planCache = { source: refactorings, promise: buildPlan(refactorings) };
    }
    return planCache.promise;
  }

  async function buildPlan(refactorings) {
    // Precompute each file's digest (sha256(path)) once so key building is sync.
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

    const byKey = new Map();
    // Declaration header windows, keyed the same way their contributions are
    // marked: one entry per declaration, shared by every refactoring reported on
    // it, since which line holds the signature doesn't depend on who is asking.
    const headerGroups = new Map();
    const descByIndex = {};
    refactorings.forEach((r, index) => {
      const summary = summarize(r);
      descByIndex[String(index)] = summary;
      effectiveRanges(r, digests).forEach((range) => {
        const header = range.header
          ? RMX.github.cellKey(range.digest, range.side, range.startLine)
          : null;
        if (header && !headerGroups.has(header)) {
          headerGroups.set(header, {
            digest: range.digest,
            side: range.side,
            startLine: range.startLine,
            endLine: range.endLine,
          });
        }
        for (let line = range.startLine; line <= range.endLine; line++) {
          const key = RMX.github.cellKey(range.digest, range.side, line);
          let entry = byKey.get(key);
          if (!entry) {
            entry = { filePath: range.filePath, contribs: [] };
            byKey.set(key, entry);
          }
          // `header` marks a line that MIGHT be the declaration's signature —
          // the overlay keeps exactly one of them (see headerLine) and drops the
          // annotations above it. `trailing` marks the closing line of a
          // multi-line range, which the overlay trims when it lands on the NEXT
          // declaration (the inclusive ranges RefactoringMiner emits overshoot
          // in indent-based languages); a header window has no such closing line.
          entry.contribs.push({
            index: String(index),
            summary,
            header,
            trailing: !header && line === range.endLine && line !== range.startLine,
            // `accent` marks a line that is only REACHED BY the refactoring —
            // a call site, a statement that mentions the renamed variable —
            // rather than part of the change itself (see isAccentLocation).
            // `role` carries RefactoringMiner's own words for what the location
            // is ("extracted method invocation"), which is the whole content of
            // the hover on such a line: it can't be clicked, so the tooltip is
            // the only thing it has to offer. Only set where it's used, so the
            // plan doesn't carry a string per line for the common case.
            accent: !!range.accent,
            role: range.accent ? range.role || '' : '',
          });
        }
      });
    });

    return {
      byKey,
      headerGroups,
      descByIndex,
      // Every line a selection has to make visible before it can blink whole:
      // the overlay walks these through GitHub's reveal controls (see selectTargets).
      targets: selectTargets(refactorings, digests),
    };
  }

  // `additive` re-paints without clearing first: used by the mutation observer
  // so the tagged cells and the neon selection (and its fade) aren't disturbed
  // as the virtualized diff mounts new rows.
  async function render(refactorings, additive) {
    if (!additive) RMX.overlay.clearAll();
    RMX.overlay.installTooltip();

    const plan = await planFor(refactorings);
    RMX.overlay.setTargets(plan.targets);
    RMX.overlay.setPlan(plan);
    const tagged = RMX.overlay.paintAll();
    RMX.overlay.applySelection(); // re-apply neon selection to any newly mounted cells
    if (!additive) console.info(`[RMX] ${refactorings.length} refactorings, ${tagged} lines tagged`);
    handleDeepLink();
  }

  // How far below a declaration's first line its signature can be, i.e. how many
  // annotation/decorator (and javadoc, and blank) lines the overlay is willing to
  // step over before giving up and tagging that first line after all.
  const HEADER_SCAN_LINES = 8;

  // The line ranges one refactoring actually paints on, both sides, as
  // { digest, side, startLine, endLine, filePath, header, accent, role }. Single source of
  // truth for the two things that have to agree about a refactoring's extent:
  // what gets tagged, and what a selection must unfold before it CAN be tagged.
  //
  // Which lines a location contributes, applied identically to left and right so
  // related parts stay consistent:
  //   • A newly created declaration (added getter, extracted method/type) is
  //     genuine new code → tag it in full.
  //   • Otherwise a big enclosing method/type declaration is context: skip it
  //     when the side has a finer location to tag instead, or — when it's the
  //     only location (Rename/Pull Up/Move/Change-modifier on a whole method or
  //     type) — tag just its header line so the side is still selectable without
  //     flooding the diff.
  //   • Anything finer (statement, field, param, conditional…) → full range.
  //
  // Right side first, so the "after" side leads wherever the order shows: the
  // navigator's accent colour, and which line a reveal opens first.
  function effectiveRanges(r, digests) {
    const ranges = [];
    [['R', r.rightSideLocations], ['L', r.leftSideLocations]].forEach(([side, locations]) => {
      const locs = locations || [];
      const hasFiner = locs.some((cr) => !isContainer(cr));
      locs.forEach((cr) => {
        let startLine = cr.startLine;
        let endLine = cr.endLine;
        let header = false;
        if (isContainer(cr) && !isNewDeclaration(cr)) {
          if (hasFiner) return;
          // Declaration-only refactoring → header line only. WHICH line that is
          // can't be decided here: RefactoringMiner's startLine is the first
          // line of the declaration, so on an annotated member it lands on
          // `@Override` — tagging that lights up an annotation on both sides and
          // says nothing about the method that was renamed, while the signature
          // just below it stays dark. Plan the window the signature can be in
          // and let the overlay pick the line once the source text is on the
          // page (see headerLine in overlay.js).
          endLine = Math.min(endLine, startLine + HEADER_SCAN_LINES);
          header = true;
        }
        const digest = digests[cr.filePath];
        if (!digest) return;
        const accent = isAccentLocation(cr);
        ranges.push({
          digest, side, startLine, endLine, filePath: cr.filePath, header,
          accent,
          // The location's own description, kept only where the overlay shows it.
          role: accent ? cr.description || '' : '',
        });
      });
    });
    return ranges;
  }

  // index → the { digest, side, line } list a selection has to make visible:
  // the first and last line of every range it paints on. The overlay walks these
  // through GitHub's own reveal controls ("Load diff", the per-hunk unfold
  // arrows) before selecting, so a refactoring lights up whole — including the
  // lines GitHub folded away because IT reads them as unchanged context, and the
  // files it collapsed entirely. Interior lines need no entry of their own: an
  // unfold opens the block around a line, not the single line.
  //
  // For a declaration header that means both ends of the search window, so the
  // signature line is on the page for headerLine to find even when GitHub folded
  // the annotations above it away as unchanged context.
  function selectTargets(refactorings, digests) {
    const targets = {};
    refactorings.forEach((r, index) => {
      const seen = {};
      const list = [];
      effectiveRanges(r, digests).forEach((range) => {
        [range.startLine, range.endLine].forEach((line) => {
          const key = range.digest + range.side + line;
          const hit = seen[key];
          // One line can be covered by two ranges of the same refactoring — a
          // call site sitting inside the code that was extracted. Being part of
          // the change wins, so a second, non-accent range clears the flag on
          // the entry the first one made rather than adding a duplicate.
          if (hit) {
            if (!range.accent) hit.accent = false;
            return;
          }
          // filePath rides along so a file collapsed behind "Viewed" can still
          // be identified: with none of its rows rendered, the path is the only
          // handle GitHub's markup reliably offers.
          const entry = {
            digest: range.digest, side: range.side, line, filePath: range.filePath,
            // Reached-by lines are still revealed and still light up — they're
            // how the refactoring's reach is visible — but a jump prefers a line
            // that IS the change (see primaryTarget in overlay.js).
            accent: !!range.accent,
          };
          seen[key] = entry;
          list.push(entry);
        });
      });
      if (list.length) targets[index] = list;
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

  // A location the refactoring only REACHES: the call sites an Extract or Inline
  // leaves behind, and the statements that merely mention a variable that was
  // renamed or retyped. RefactoringMiner names them in the location's own
  // `description` — "extracted method invocation", "inlined method invocation",
  // "statement referencing the renamed variable" (and the original / changed-type
  // variants) — and that description is the ONLY thing that separates them from
  // the changed code: their codeElementType and line ranges look identical.
  //
  // They earn their own accent colour rather than the side's fill, because they
  // answer a different question — not "what changed" but "what else this touches"
  // — and for the same reason they don't count toward the off-screen line totals
  // the edge chips report (see overlay.js: the accent class, and refreshEdges).
  //
  // Substring matching rather than the five literals: RefactoringMiner phrases
  // these per refactoring type, and a new one worded the same way should be
  // picked up without a change here.
  function isAccentLocation(loc) {
    const d = (loc.description || '').toLowerCase();
    return d.indexOf('invocation') !== -1 || d.indexOf('referencing') !== -1;
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

  // Report rows. One row carries everything any of the panel's three detail
  // levels needs, so switching level is a re-render of the same data rather than
  // a re-analysis (see RMX.overlay.setPanelView):
  //   • `summary`     — type-free element summary, the compact level's one-liner
  //   • `detail`      — the full RefactoringMiner sentence, split into clauses
  //                     for the expandable card (every level)
  //   • `description` — that same sentence verbatim, shown inline on the row
  //                     from the expanded level up
  //   • `markup`      — the same sentence as RefactoringMiner's markdown, with
  //                     every code element carrying a link to the exact line it
  //                     sits on. Retargeted onto this page (see retargetMarkup).
  //   • `files`       — the distinct paths the refactoring touches
  //   • `locations`   — every left/right code element RefactoringMiner reported,
  //                     with its own per-location description and type. This is
  //                     the part the compact panel never surfaces; the detailed
  //                     level lists it in full.
  // `index` links a row back to its tagged cells so a click selects/blinks it.
  function reportRows(refactorings) {
    return refactorings.map((r, index) => {
      const locations = locationRows(r);
      return {
        index,
        type: r.type,
        summary: elementSummary(r),
        detail: r.description || '',
        description: r.description || '',
        markup: retargetMarkup(r.markup),
        files: distinctFiles(locations),
        locations,
      };
    });
  }

  // Point every link in RefactoringMiner's markup at the page it is being shown
  // on, keeping only the query and the `#diff-<digest><L|R><line>` fragment —
  // which is the part that identifies the line, and the only part the panel
  // actually uses.
  //
  // The rewrite is needed because the service is called with a single
  // `commitId`, and an integer means "pull request" while a sha means "commit" —
  // it cannot tell a standalone commit from a commit that happens to sit inside
  // a PR, so a sha request always emits regular-commit links:
  //     …/<owner>/<repo>/commit/<sha>?diff=split#diff-<digest>R591
  // On a commit-within-a-PR page those point off the page the reader is on.
  // Rebasing onto the current path rather than swapping `/commit/` for
  // `/pull/<n>/changes/` also keeps the classic URLs right: GitHub serves the
  // same diffs at /pull/<n>/files and /pull/<n>/commits/<sha>, and a link should
  // land back where the reader already is.
  //
  // Clicking a link never navigates anyway — the panel intercepts it and reveals
  // the line in place (RMX.overlay) — but the href is what a middle-click, a
  // "copy link address", or a failed intercept falls back to, so it has to be
  // a URL that works.
  function retargetMarkup(markup) {
    const text = markup || '';
    if (!text) return '';
    const base = window.location.origin + window.location.pathname;
    return text.replace(/\]\((https?:\/\/[^)\s]+)\)/g, (whole, url) => {
      let u;
      try {
        u = new URL(url);
      } catch (_) {
        return whole; // not a URL we can reason about — leave the markup as it came
      }
      if (u.hostname !== 'github.com') return whole;
      return '](' + base + u.search + u.hash + ')';
    });
  }
  function elementSummary(r) {
    const left = firstCodeElement(r.leftSideLocations);
    const right = firstCodeElement(r.rightSideLocations);
    if (left && right && left !== right) return `${shorten(left)} → ${shorten(right)}`;
    return shorten(right || left || r.description || '');
  }

  // RefactoringMiner's raw locations, flattened to one list in the order a reader
  // wants them: the "before" side first, then "after". `side` is the L/R the diff
  // itself uses, so a location row can be matched back to a tagged cell.
  function locationRows(r) {
    const out = [];
    [['L', r.leftSideLocations], ['R', r.rightSideLocations]].forEach(([side, list]) => {
      (list || []).forEach((l) => {
        out.push({
          side,
          filePath: l.filePath || '',
          startLine: l.startLine,
          endLine: l.endLine,
          // 1-based columns of the code element within its start/end lines. This
          // is what lets a click highlight the element itself rather than the
          // whole diff row (see RMX.overlay segment highlighting).
          startColumn: l.startColumn,
          endColumn: l.endColumn,
          codeElement: l.codeElement || '',
          // RefactoringMiner's own words for what this location IS within the
          // refactoring ("original attribute declaration", "extracted method
          // declaration"), which is the single most useful field the compact
          // panel throws away.
          role: l.description || '',
          kind: l.codeElementType || '',
        });
      });
    });
    return out;
  }

  function distinctFiles(locations) {
    const seen = [];
    locations.forEach((l) => {
      if (l.filePath && seen.indexOf(l.filePath) === -1) seen.push(l.filePath);
    });
    return seen;
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

  // A selection unfolds the hidden lines of its refactoring; this lets it tag
  // them the moment they mount, instead of leaving them dark until the scroll
  // observer's debounce below catches up.
  RMX.overlay.setRepaint(() => (currentRefactorings ? render(currentRefactorings, true) : null));

  // The /changes diff is virtualized: rows mount, unmount, and get RECYCLED (an
  // existing node rewritten to show a different line) as you scroll. Re-paints
  // are coalesced to one per animation frame (each is a single scan of the
  // mounted cells against the plan Map, cheap enough to run at frame rate), so
  // newly mounted lines light up immediately instead of after the old 250ms
  // debounce (the "late/blinking highlights while scrolling" artifact). The
  // attribute filter catches recycling, which rewrites a cell's identity
  // attributes without any childList change; our own writes (class, data-rmx-*)
  // are outside the filter, so painting never re-triggers the observer.
  let observer = null;
  let paintQueued = false;
  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      if (currentRefactorings) render(currentRefactorings, true);
    });
  }

  // Mutations inside our own UI (the report panel, navigator, minimap, tooltip)
  // can't contain diff cells; skipping them keeps hover/typing in the panel from
  // scheduling pointless repaints.
  const OWN_UI = '#rmx-report, #rmx-nav, #rmx-minimap, .rmx-edge, .rmx-tip';
  function isOwnNode(n) {
    return n.nodeType === 1 && typeof n.matches === 'function' &&
      n.matches('[id^="rmx-"], [class*="rmx-"]');
  }
  function relevantMutation(m) {
    const t = m.target;
    if (t && t.nodeType === 1 && t.closest && t.closest(OWN_UI)) return false;
    if (m.type === 'childList') {
      const nodes = [];
      m.addedNodes.forEach((n) => nodes.push(n));
      m.removedNodes.forEach((n) => nodes.push(n));
      return nodes.some((n) => !isOwnNode(n));
    }
    return true;
  }

  // Watch for the diff mounting more rows (virtualization, unfolds) so they get
  // tagged too. Re-attached whenever the body it was watching is no longer the
  // page's: a Turbo visit swaps the whole <body> element out, which leaves the
  // observer bound to a detached node — still "set", so the old `if (observer)
  // return;` guard meant it was never rebound and rows mounted after such a
  // navigation silently stopped being tagged.
  let observedBody = null;
  function observe() {
    if (observer && observedBody === document.body) return;
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
      if (!currentRefactorings) return;
      for (let i = 0; i < mutations.length; i++) {
        if (relevantMutation(mutations[i])) return schedulePaint();
      }
    });
    observedBody = document.body;
    observer.observe(observedBody, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-line-number', 'data-line-anchor', 'data-grid-cell-id', 'data-diff-side', 'id'],
    });
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
