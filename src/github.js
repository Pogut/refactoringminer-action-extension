window.RMX = window.RMX || {};

// Maps a RefactoringMiner CodeRange to GitHub diff line cells across GitHub's
// diff UIs. In all of them the file digest is sha256(filePath), so we never
// scrape the DOM to resolve a file:
//   - classic /files: each line cell has id `diff-<digest><L|R><line>`.
//   - PR /changes (React split): cells carry `data-diff-side` + `data-line-number`
//     (the anchor is shared across the aligned row, so we can't key on it alone).
//   - commit React diff: each cell has a UNIQUE `data-line-anchor` /
//     `data-grid-cell-id` = `diff-<digest><L|R><line>` and a side class
//     (`left-side-diff-cell` / `right-side-diff-cell`), but no `data-diff-side`.
window.RMX.github = (function () {
  const digestCache = new Map();

  async function fileDigest(filePath) {
    if (digestCache.has(filePath)) return digestCache.get(filePath);
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(filePath));
    const hex = Array.prototype.map
      .call(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0'))
      .join('');
    digestCache.set(filePath, hex);
    return hex;
  }

  // --- cell identity, both directions ---------------------------------------
  // lineCells answers "where are the cells for (file, side, line)?", a lookup
  // BY identity. cellIdentity answers the inverse, "which (file, side, line) is
  // this mounted cell showing?", parsed OUT of the cell, so a single scan of
  // the page can be matched against a precomputed plan instead of running one
  // document query per refactoring line (the O(refactorings × document) walk
  // that made big pages crawl).

  // Shared key for anything stored per (file, side, line).
  function cellKey(digest, side, line) {
    return digest + '|' + side + '|' + line;
  }

  // Every element that could be a diff line cell in any of the three UIs. The
  // `[id^="diff-"]` arm also matches file containers and anchor links, but those
  // fail cellIdentity's parse and drop out.
  const CANDIDATE_CELL_SEL =
    '[data-diff-side][data-line-number], [data-line-anchor^="diff-"], [data-grid-cell-id^="diff-"], [id^="diff-"]';

  function candidateCells() {
    return document.querySelectorAll(CANDIDATE_CELL_SEL);
  }

  // The (digest, side, line) a mounted cell is currently showing, or null when
  // the element isn't a line cell. Mirrors lineCells' keying schemes exactly:
  //   • /changes React split: data-diff-side + data-line-number are the truth
  //     (the row anchor is shared and carries only the file digest);
  //   • commit React diff / classic: parse the unique diff-<digest><L|R><line>
  //     anchor, rejecting a side-class contradiction (the defensive scoping
  //     lineCells applies for a split view that shares anchors).
  function cellIdentity(el) {
    const ds = el.getAttribute('data-diff-side');
    if (ds) {
      const line = parseInt(el.getAttribute('data-line-number'), 10);
      if (!line) return null;
      const anchor = el.getAttribute('data-line-anchor') || el.getAttribute('data-grid-cell-id') || '';
      const m = /^diff-([0-9a-f]{64})/.exec(anchor);
      if (!m) return null;
      return { digest: m[1], side: ds === 'left' ? 'L' : 'R', line };
    }
    const key = el.getAttribute('data-line-anchor') || el.getAttribute('data-grid-cell-id') || el.id || '';
    const m = /^diff-([0-9a-f]{64})([LR])(\d+)$/.exec(key);
    if (!m) return null;
    if (el.classList.contains('left-side-diff-cell') && m[2] !== 'L') return null;
    if (el.classList.contains('right-side-diff-cell') && m[2] !== 'R') return null;
    return { digest: m[1], side: m[2], line: parseInt(m[3], 10) };
  }

  // Resolved cells, memoized by cellKey. The reveal/selection paths re-ask for
  // the same lines constantly (every unfold poll, every visibility probe), and
  // each miss costs up to three document-wide queries. Entries are revalidated
  // by IDENTITY, not just isConnected: the React diff recycles nodes (a still-
  // connected cell may have been rewritten to show a different line), so a
  // cached cell must parse back to the same (digest, side, line) before it can
  // be trusted. Only non-empty results are stored: an empty [] means "not
  // mounted yet" (folded / virtualized / collapsed), and revealLine may mount
  // it later, so caching the miss would pin the line dark forever.
  const cellCache = new Map();

  function cellStillShows(el, digest, side, line) {
    if (!el.isConnected) return false;
    const id = cellIdentity(el);
    return !!id && id.digest === digest && id.side === side && id.line === line;
  }

  // The diff cells for one (file, side, line), or [] if that line isn't mounted
  // (the React diff virtualizes off-screen rows).
  //
  // The new /changes (React) split view is the tricky one: GitHub gives the two
  // cells of an aligned row the SAME `data-line-anchor` (the right line's), so a
  // `[data-line-anchor=...]` lookup for R<n> also matches the LEFT cell on that
  // row — and painting it bleeds a right-side highlight into the left column.
  // Each cell does, however, carry its TRUE side and line in `data-diff-side`
  // ("left"/"right") and `data-line-number`, so we match on those instead and
  // scope to the file via the digest prefix on data-line-anchor / data-grid-cell-id.
  // The classic /files view (unique element id per cell) is the fallback.
  function lineCells(digest, side, line) {
    const key = cellKey(digest, side, line);
    const cached = cellCache.get(key);
    if (cached && cached.every((el) => cellStillShows(el, digest, side, line))) return cached;
    const cells = resolveLineCells(digest, side, line);
    if (cells.length) cellCache.set(key, cells);
    else cellCache.delete(key);
    return cells;
  }

  function resolveLineCells(digest, side, line) {
    // PR /changes (React split): disambiguate the shared row anchor via the
    // cell's own side + line, scoped to the file by the digest prefix.
    const sideAttr = side === 'L' ? 'left' : 'right';
    const candidates = document.querySelectorAll(
      `[data-diff-side="${sideAttr}"][data-line-number="${line}"]`,
    );
    const inFile = Array.prototype.filter.call(candidates, (el) => {
      const key = el.getAttribute('data-line-anchor') || el.getAttribute('data-grid-cell-id') || '';
      return key.indexOf('diff-' + digest) === 0;
    });
    if (inFile.length) return inFile;

    // Commit React diff: the anchor/grid-cell-id is unique and already encodes
    // side+line. Scope to the matching side class in case a split view ever
    // shares the anchor across the row; fall back to all matches otherwise.
    const key = `diff-${digest}${side}${line}`;
    const direct = document.querySelectorAll(
      `[data-line-anchor="${key}"], [data-grid-cell-id="${key}"]`,
    );
    if (direct.length) {
      const sideClass = side === 'L' ? 'left-side-diff-cell' : 'right-side-diff-cell';
      const scoped = Array.prototype.filter.call(direct, (el) => el.classList.contains(sideClass));
      return scoped.length ? scoped : Array.prototype.slice.call(direct);
    }

    // Classic /files: unique element id per cell.
    const byId = document.getElementById(key);
    return byId ? [byId] : [];
  }

  // --- making off-DOM lines resolvable -------------------------------------
  // lineCells only sees rendered rows. Three states hide a target line and never
  // resolve on their own:
  //   • a large diff GitHub collapsed behind a "Load diff" button,
  //   • the whole file folded behind "Expand all",
  //   • and — by far the common one — unchanged context folded behind the
  //     per-hunk unfold arrows. GitHub only renders a few lines of context
  //     around the text IT sees as changed, while RefactoringMiner routinely
  //     points at lines GitHub considers untouched: the field an Encapsulate
  //     Attribute wraps, the signature a Rename kept. Those parts of the
  //     refactoring sit inside a fold, so they tag nothing and stay dark while
  //     the rest of the same refactoring lights up.
  // revealLine drives GitHub's OWN controls to materialise the line, then waits
  // for it to mount — the content script's MutationObserver re-tags it.
  // We click rather than replay GitHub's fetch so a change to that endpoint
  // keeps working (the same choice CodeTracker's authors made).

  // Cells that can carry a (file, side, line) identity, in either diff UI.
  const CELL_SEL = '[data-line-number],[data-line-anchor],[data-grid-cell-id],[id^="diff-"]';

  // Controls that unfold hidden context. Matched by role + accessible name +
  // Primer icon rather than by class name: the classic diff ships
  // `a.js-expand`/`.directional-expander`, the React diff ships icon-only
  // buttons, and GitHub rewrites those class names often — but the label
  // ("Expand Up" / "Expand all") and the octicon (`octicon-unfold`,
  // `octicon-fold-up`/`-down`) have stayed put across both. The selector can
  // land on the <svg> inside a button, so every match goes through expanderOf.
  const EXPANDER_SEL = [
    'a.js-expand', 'button.js-expand', '.directional-expander',
    '[aria-label*="expand" i]', '[title*="expand" i]', '[data-testid*="expand" i]',
    'svg[class*="octicon-unfold"]', 'svg[class*="octicon-fold"]',
  ].join(',');

  const MAX_UNFOLD_ROUNDS = 6; // a long fold opens ~20 lines a click; bound the walk
  const MAX_CLIMB = 10;

  // --- files the reviewer has collapsed ------------------------------------
  // Ticking "Viewed" collapses a file, and a reviewer part-way through a PR has
  // most of them collapsed. That hides a refactoring in two different ways:
  //   • the classic diff keeps the rows in the DOM but display:none, so
  //     lineCells still resolves them and the selection paints its neon onto
  //     cells nobody can see, while the scroll lands on a zero-height element;
  //   • the React diff renders no rows at all, so every lookup that starts from
  //     a mounted cell (which, before this, was all of them) comes back empty
  //     and the refactoring is simply unreachable.
  // Both are fixed by expanding the file first.
  //
  // We expand it WITHOUT touching the "Viewed" checkbox. That state is the
  // reviewer's own bookkeeping, persisted on GitHub across sessions and used to
  // track how far through a PR they are; clicking a refactoring has no business
  // rewriting it. GitHub keeps the two controls separate (the chevron collapses
  // and expands locally, the checkbox records review progress), so driving the
  // chevron gets the lines on screen and leaves the file still marked viewed.
  // This is also why we don't need RefactoringMiner's GraphQL markFileAsViewed
  // path: that exists to reach GitHub from RefactoringMiner's own page, whereas
  // we already run inside github.com under the reviewer's session.

  // Escape a value for use inside a quoted attribute selector.
  function attrValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  // Present in the DOM is not the same as on screen: a collapsed classic file
  // keeps every row, at display:none. Only a rendered box means we can highlight.
  function isRendered(el) {
    return !!el && !!el.getClientRects && el.getClientRects().length > 0;
  }

  // The cells for a line, but only once they're actually rendered.
  function visibleCells(digest, side, line) {
    const cells = lineCells(digest, side, line);
    return cells.some(isRendered) ? cells : [];
  }

  // The file box around an element we matched on (a header, an anchor link, the
  // span that spells out the path). The classic diff gives us a container to
  // close on; the React header is a plain wrapper, so fall back to climbing
  // until an ancestor actually holds a control that could open the file. Bounded,
  // and it stops short of <body> so a miss can never hand back half the page
  // (and with it some other file's toggle).
  function fileBoxOf(el) {
    const known = el.closest('[data-details-container-group="file"], .js-file, .file, [data-diff-anchor]');
    if (known) return known;
    let node = el;
    for (let n = 0; n < MAX_CLIMB && node && node !== document.body; n++) {
      if (expandControl(node)) return node;
      node = node.parentElement;
    }
    return el;
  }

  // Identify a file from sha256(path) with NONE of its rows on the page, which
  // is the state a collapsed file is in and the reason it used to be
  // unreachable. Ordered most certain first, and every step is just a lookup:
  // a miss falls through to the next, and a total miss returns what the old
  // code would have returned, so nothing regresses when GitHub moves things.
  //   1. id="diff-<digest>"          — the classic file box.
  //   2. data-anchor / data-diff-anchor — the file's OWN container, in the
  //                                    classic header and the React diff alike.
  //   3. the file path, which the feed gives us, against the attributes GitHub
  //      renders it into (data-tagsearch-path and data-path on the classic
  //      header) or a title/aria-label that spells it out.
  //   4. a link pointing at the file — the file-tree entry or a permalink.
  //   5. the old climb from a mounted cell.
  //
  // Step 4 has to stay LAST. It used to share step 2's querySelector, and since
  // the file tree is rendered before the diff, that one call always returned the
  // sidebar entry: a link with no "Load diff" button, no chevron and no rows
  // under it. Every caller below then searched inside that link and found
  // nothing, which is what made a large file — the ones GitHub parks behind
  // "Large diffs are not rendered by default" — permanently unreachable.
  function fileBox(digest) {
    const anchor = 'diff-' + digest;
    return document.getElementById(anchor) ||
      document.querySelector(`[data-anchor="${anchor}"], [data-diff-anchor="${anchor}"]`);
  }

  function fileRoot(digest, filePath) {
    const anchor = 'diff-' + digest;
    const byId = document.getElementById(anchor);
    if (byId) return byId;
    const byAnchor = document.querySelector(
      `[data-anchor="${anchor}"], [data-diff-anchor="${anchor}"]`,
    );
    if (byAnchor) return fileBoxOf(byAnchor);
    if (filePath) {
      const p = attrValue(filePath);
      const byPath = document.querySelector(
        `[data-tagsearch-path="${p}"], [data-path="${p}"], [data-file-path="${p}"], [title="${p}"], [aria-label="${p}"]`,
      );
      if (byPath) return fileBoxOf(byPath);
    }
    const byHref = document.querySelector(`a[href$="#${anchor}"]`);
    if (byHref) return fileBoxOf(byHref);
    return fileContainer(digest);
  }

  // The "Viewed" checkbox and anything wrapping it. Never clicked: unchecking it
  // would rewrite the reviewer's review progress on GitHub.
  function isViewedControl(el) {
    return !!el.querySelector('input[type="checkbox"]') ||
      el.getAttribute('type') === 'checkbox' ||
      /viewed/i.test(labelOf(el));
  }

  // The chevron that opens and closes a file: `octicon-chevron-*` on the classic
  // `button.js-details-target` (confirmed against live github.com) and the > / v
  // in the React file row. Deliberately NOT octicon-fold/unfold — those are the
  // in-diff context expanders, a different control with a different job.
  const CHEVRON_ICON = /octicon-(chevron|triangle)/;

  // Everything that sits beside the chevron in a file header and must never be
  // mistaken for it. The comment button is the one that bit: it carries
  // aria-expanded="false" exactly like a collapsed toggle does, so scanning for
  // that attribute alone opened "Add comment on file" instead of the file.
  const NOT_EXPAND = /comment|review|resolve|menu|more|options|copy|link|permalink|viewed|unviewed|suggest/i;

  // Controls that turned out not to open the file. GitHub's headers differ
  // between UIs and we only infer which control is the chevron, so a wrong guess
  // is possible; remembering it means one harmless misfire instead of one per
  // line of the refactoring.
  const duds = new WeakSet();

  // Does this control positively look like the file's expand chevron? An
  // aria-expanded="false" is NOT sufficient on its own (that was the bug): it
  // has to be the known classic button, carry a chevron icon, or say so in its
  // label. Anything unrecognised is left alone, so the failure mode is "the file
  // does not open" rather than "some other button gets pressed".
  function isExpandCandidate(el) {
    if (!isRendered(el) || duds.has(el) || isViewedControl(el)) return false;
    const label = labelOf(el);
    const icon = iconClass(el);
    if (NOT_EXPAND.test(label) || NOT_EXPAND.test(icon)) return false;
    const looksLikeToggle =
      el.classList.contains('js-details-target') ||
      CHEVRON_ICON.test(icon) ||
      /^(toggle diff contents|show diff|hide diff|expand file|collapse file|expand|collapse)$/i.test(label);
    if (!looksLikeToggle) return false;
    return el.getAttribute('aria-expanded') !== 'true'; // already open ⇒ nothing to do
  }

  function expandControl(root) {
    return Array.prototype.find.call(
      root.querySelectorAll('button, summary, [role="button"]'),
      isExpandCandidate,
    );
  }

  // Expand a file the reviewer collapsed, leaving "Viewed" as they set it.
  // Returns the control it clicked, so the caller can retire it if the file
  // stayed shut.
  function expandFile(root) {
    const control = root && expandControl(root);
    if (!control) return null;
    control.click();
    return control;
  }

  // A stable per-file root to search for the load/expand controls. Classic
  // /files & /commit hang id="diff-<digest>" on the file element; the React
  // diffs don't, so derive it from any mounted cell of the file.
  // NOTE: verify the React ancestor selector against live GitHub if the React
  // load-diff case ever regresses — GitHub churns these wrappers.
  function fileContainer(digest) {
    const byId = document.getElementById('diff-' + digest);
    if (byId) return byId;
    const cell = document.querySelector(
      `[data-line-anchor^="diff-${digest}"], [data-grid-cell-id^="diff-${digest}"]`,
    );
    return cell ? cell.closest('[data-diff-anchor], .file, [class*="Diff"]') : null;
  }

  // True when `el` also holds rows belonging to some OTHER file — the stop
  // condition for the climb below, so an unfold click can never be aimed at a
  // neighbouring file's fold.
  function hasForeignRows(el, digest) {
    return Array.prototype.some.call(
      el.querySelectorAll('[data-line-anchor^="diff-"], [data-grid-cell-id^="diff-"]'),
      (c) => {
        const key = c.getAttribute('data-line-anchor') || c.getAttribute('data-grid-cell-id');
        return key.indexOf('diff-' + digest) !== 0;
      },
    );
  }

  function rowSelector(digest) {
    return `[data-line-anchor^="diff-${digest}"], [data-grid-cell-id^="diff-${digest}"], [id^="diff-${digest}"][data-line-number]`;
  }

  // Any row of this file present in the DOM, or null when none of it is there.
  function anyRow(digest) {
    return document.querySelector(rowSelector(digest));
  }

  // At least one row of this file actually on screen. This is the test for "the
  // file is open": a collapsed classic file has all its rows but renders none of
  // them, and a collapsed React file has none to begin with. Gating the expand
  // step on this keeps it away from files that are already showing, where a
  // stray aria-expanded="false" control (a collapsed comment thread, a
  // dropdown) would otherwise be a tempting and quite wrong thing to click.
  function anyRenderedRow(digest) {
    return Array.prototype.some.call(document.querySelectorAll(rowSelector(digest)), isRendered);
  }

  // Does `el` hold a line cell of this file on the side we're unfolding? The
  // stop condition below needs it: a scope with no line of that side gives
  // foldGaps nothing to measure against, so every fold in it collapses into one
  // 0..Infinity "gap" and the control choice is a guess.
  function hasSideCell(el, digest, side) {
    return Array.prototype.some.call(
      el.querySelectorAll(CELL_SEL),
      (c) => cellLine(c, digest, side) > 0,
    );
  }

  // The subtree to look for this file's folds in: its element when GitHub gives
  // us one, else the smallest ancestor of a mounted cell that reaches an unfold
  // control without reaching into the next file. Climbing rather than matching a
  // wrapper class is what keeps this alive across GitHub's UI rewrites.
  //
  // Stopping at the first ancestor holding ANY expander was too eager: on a
  // large commit the climb starts at a cell whose own <tr> is the hunk header
  // carrying the expand buttons, so it stopped one row up. That row has no line
  // of the target side in it, so foldGaps saw a single 0..Infinity gap and the
  // walk clicked whichever expander was there — the wrong end of the file,
  // burning one of the six rounds. So a scope only counts as "wide enough" once
  // it also holds a line of that side to place the fold against.
  function fileScope(digest, side) {
    const byId = document.getElementById('diff-' + digest);
    if (byId) return byId;
    let el = anyRow(digest);
    if (!el) return null;
    let best = el;
    for (let n = 0; n < MAX_CLIMB && el.parentElement; n++) {
      el = el.parentElement;
      if (hasForeignRows(el, digest)) break;
      best = el;
      // A control is in reach AND we can tell where the fold sits — stop widening.
      if (el.querySelector(EXPANDER_SEL) && (!side || hasSideCell(el, digest, side))) break;
    }
    return best;
  }

  // A control's accessible name, however GitHub spelled it on this element.
  function labelOf(el) {
    return (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
  }

  // Find a clickable control inside `root` by its LABEL rather than a class name.
  // Reads aria-label/title as well as the text, because GitHub's icon-only
  // buttons ("Load diff" aside, most of them) carry no text at all.
  function controlByLabel(root, re) {
    return Array.prototype.find.call(
      root.querySelectorAll('button, a, summary'),
      (el) => re.test(labelOf(el)),
    );
  }

  // The clickable ancestor of a matched node, or null when it isn't a live
  // unfold control (the hidden "Collapse expanded lines" twin sits in the same
  // markup and would fold the diff back up).
  function expanderOf(node) {
    const el = node.closest && node.closest('a, button, summary');
    if (!el) return null;
    if (/collapse/i.test(labelOf(el))) return null;
    if (el.hidden || !el.getClientRects().length) return null;
    return el;
  }

  // The Primer icon a control renders, which names its direction when the label
  // doesn't (`octicon-unfold` = the whole gap, `octicon-fold-up`/`-down` = one
  // step from that end).
  function iconClass(el) {
    const svg = el.querySelector('svg');
    return (svg && svg.getAttribute('class')) || '';
  }

  // The source line a cell shows for (file, side), or 0 when it isn't a cell of
  // that file and side. Mirrors lineCells's two keying schemes.
  function cellLine(el, digest, side) {
    const key = el.getAttribute('data-line-anchor') || el.getAttribute('data-grid-cell-id') || el.id || '';
    const ds = el.getAttribute('data-diff-side');
    if (ds) {
      if (ds !== (side === 'L' ? 'left' : 'right')) return 0;
      if (key && key.indexOf('diff-' + digest) !== 0) return 0;
      return parseInt(el.getAttribute('data-line-number'), 10) || 0;
    }
    const m = new RegExp('^diff-' + digest + side + '(\\d+)$').exec(key);
    return m ? parseInt(m[1], 10) : 0;
  }

  // This file+side's folded regions, in document order. A gap is the run of
  // unfold controls between two mounted lines: `before` is the last line above
  // it (0 = top of file), `after` the first below (Infinity = end of file), so a
  // hidden line belongs to the gap it falls strictly between.
  function foldGaps(scope, digest, side) {
    const gaps = [];
    let before = 0;
    let pending = [];
    scope.querySelectorAll(CELL_SEL + ',' + EXPANDER_SEL).forEach((node) => {
      const line = cellLine(node, digest, side);
      if (line) {
        if (pending.length) gaps.push({ controls: pending, before, after: line });
        pending = [];
        before = Math.max(before, line);
        return;
      }
      const btn = expanderOf(node);
      if (btn && pending.indexOf(btn) === -1) pending.push(btn);
    });
    if (pending.length) gaps.push({ controls: pending, before, after: Infinity });
    return gaps;
  }

  function gapFor(scope, digest, side, line) {
    return foldGaps(scope, digest, side).find((g) => line > g.before && line < g.after) || null;
  }

  // GitHub's expanders declare the lines they will reveal as data-left-range /
  // data-right-range ("1-12"). Only the classic diff sets them, so it's a bonus
  // signal — never a requirement.
  function inRange(range, line) {
    const m = /^(\d+)-(\d+)$/.exec(range || '');
    return !!m && line >= +m[1] && line <= +m[2];
  }

  // How good a click this control is for reaching `line`: one that says it will
  // reveal the line beats the whole-gap unfold, which beats the arrow pointing
  // at the target's end of the gap. "Expand Up" sits at a hunk's top and walks
  // upward, so it reaches lines near `after`; "Expand Down" reaches `before`'s end.
  function controlScore(el, gap, side, line) {
    if (inRange(el.getAttribute(side === 'L' ? 'data-left-range' : 'data-right-range'), line)) return 3;
    const label = labelOf(el);
    const icon = iconClass(el);
    if (/\ball\b/i.test(label) || /octicon-unfold/.test(icon)) return 2;
    const nearerBottom = gap.after !== Infinity && line - gap.before > gap.after - line;
    if (/up/i.test(label) || /octicon-fold-up/.test(icon)) return nearerBottom ? 1 : 0;
    if (/down/i.test(label) || /octicon-fold-down/.test(icon)) return nearerBottom ? 0 : 1;
    return 0;
  }

  function pickControl(gap, side, line) {
    let best = null;
    let bestScore = -1;
    gap.controls.forEach((el) => {
      const score = controlScore(el, gap, side, line);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    });
    return best;
  }

  // --- files the virtualized diff has not mounted --------------------------
  // A diff with hundreds of files is virtualized per FILE, not just per row:
  // GitHub sizes a placeholder for every file and keeps only the handful around
  // the viewport in the DOM (a 1000-file commit mounts about five). For all the
  // others there is no row, no id="diff-<digest>" box and no fold control, so
  // every step of revealLine below (they all start from one of those) finds
  // nothing, the selection tags no cells, and clicking the refactoring looks
  // completely dead.
  //
  // GitHub mounts a file on demand when its own anchor is navigated to. Drive
  // that (the file-tree entry, or the bare #diff-<digest> hash when the tree is
  // hidden) and the rows appear at their real position in the document, where
  // the rest of the machinery, and the caller's scroll, can reach them.
  // The FILE anchor, never a line anchor: `#diff-<digest><L|R><line>` is what
  // the action's own comment deep links use, and firing one here would re-enter
  // content.js's hashchange handler in the middle of a selection.

  // The file's own in-page anchor. Matched exactly, so this can only ever be a
  // jump within the view being read: a tree entry that spells out a path
  // (`…/pull/1/files#diff-<digest>`) would navigate away, and the hash fallback
  // reaches the same file without that risk.
  function fileAnchorLink(digest) {
    return document.querySelector(`a[href="#diff-${digest}"]`);
  }

  // Drive the file's anchor. A plain click() is enough on a settled page, but a
  // huge diff hydrates for many seconds and a bare synthetic click fired in that
  // window gets swallowed; the full pointer sequence (what a real click emits)
  // is what got through in testing against a 1,000-file commit, so retries use it.
  function driveAnchor(link, thorough) {
    if (!thorough) return link.click();
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      link.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
    });
  }

  // Enough of the file is on the page to work with: either its rows, or just its
  // container. The container alone counts because a file GitHub parked behind
  // "Load diff" mounts with NO line cells at all, and waiting for rows there
  // would burn the whole polling budget on a file that is already as mounted as
  // it is going to get without that button being pressed.
  function filePresent(digest) {
    return !!(anyRow(digest) || fileBox(digest));
  }

  // Ask GitHub to mount a file it has virtualized away, and wait for it to land.
  // Retried: against the live 1,000-file commit a mount was measured taking over
  // 4s (past a single 2s poll), and a click can be lost outright while the page
  // is still measuring itself — so the anchor is driven up to `attempts` times.
  async function mountFile(digest, tries = 20, delay = 100, attempts = 3) {
    if (filePresent(digest)) return true;
    const hash = '#diff-' + digest;
    for (let a = 0; a < attempts; a++) {
      const link = fileAnchorLink(digest);
      if (link) driveAnchor(link, a > 0);
      else if (window.location.hash !== hash) window.location.hash = hash;
      else return false; // already pointed here and still not mounted: nothing left to drive
      for (let n = tries; n > 0; n--) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (filePresent(digest)) return true;
      }
    }
    return false;
  }

  // Resolve once (file, side, line) is rendered, polling briefly while the
  // clicked control's async load lands. Resolves to the cells, or [] on timeout.
  // Rendered, not merely present: a collapsed file's rows are in the DOM at
  // display:none, and resolving on those would report success while the line
  // stays invisible.
  async function waitForLine(digest, side, line, tries = 20, delay = 150) {
    for (let n = tries; ; n--) {
      const cells = visibleCells(digest, side, line);
      if (cells.length || n <= 0) return cells;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Wait out ONE unfold click: resolve as soon as the target mounts, or as soon
  // as the fold merely moved (GitHub reveals a slice at a time, so a long fold
  // needs several rounds and mustn't pay the full timeout on each one).
  // Returns the cells, or [] to tell the caller to look again. `scope` is reused
  // between polls and only re-derived once GitHub has replaced it, so watching a
  // fold doesn't re-walk the page every 100ms.
  async function waitForUnfold(digest, side, line, sig, scope) {
    let host = scope;
    for (let n = 12; ; n--) {
      const cells = visibleCells(digest, side, line);
      if (cells.length) return cells;
      if (!host.isConnected) host = fileScope(digest, side);
      const gap = host && gapFor(host, digest, side, line);
      if (!gap || gapSig(gap) !== sig || n <= 0) return [];
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  function gapSig(gap) {
    return gap.before + '-' + gap.after;
  }

  // Click "Load diff" on a diff GitHub collapsed for size. Nothing else can be
  // revealed until this lands, so it runs before any unfolding.
  function loadDiff(file) {
    const el = controlByLabel(file, /^load diff$/i);
    if (!el) return false;
    el.click();
    return true;
  }

  // Unfold the entire file in one go. The blunt fallback for when the targeted
  // walk can't place the line (an unfamiliar control layout, a fold too long to
  // step through), so a reveal degrades to "show everything" rather than failing.
  function expandAll(file) {
    const el = file.querySelector('.js-expand-full') || controlByLabel(file, /^expand all( lines)?$/i);
    if (!el) return false;
    el.click();
    return true;
  }

  // Force GitHub to render (side, line) so it becomes taggable, then resolve to
  // its cells (or [] if it stays unavailable). Cheap when the line is already
  // on screen — a single lineCells lookup. `filePath` is optional and only
  // widens how a collapsed file can be identified.
  async function revealLine(digest, side, line, filePath) {
    let cells = visibleCells(digest, side, line);
    if (cells.length) return cells;

    // A file the reviewer marked "Viewed" is collapsed, and nothing below can
    // work until it is open: the React diff has no rows to unfold, and the
    // classic diff's rows are present but display:none. Expanding leaves the
    // "Viewed" tick exactly as they set it. Skipped entirely for a file that is
    // already showing, so a merely folded or virtualized line takes the same
    // route it always did.
    const root = anyRenderedRow(digest) ? null : fileRoot(digest, filePath);
    const opener = root && expandFile(root);
    if (opener) {
      // Short wait: expanding is local and near-instant, and if the line turns
      // out to ALSO be folded inside the file we just opened, the walk below is
      // what places it. No reason to sit out a long timeout first.
      cells = await waitForLine(digest, side, line, 10, 100);
      if (cells.length) return cells;
      // Still nothing of the file on screen, so that control was not the
      // chevron. Retire it rather than press it again for every remaining line.
      if (!anyRenderedRow(digest)) duds.add(opener);
    }

    // Still not a single row of this file anywhere: the diff has virtualized the
    // whole file away, so there is nothing here to expand, load or unfold yet.
    // Have GitHub mount it first, then take the normal route. Runs after the
    // expand attempt above so a file that is merely collapsed (its rows present)
    // never pays for this.
    if (!anyRow(digest)) {
      await mountFile(digest);
      cells = visibleCells(digest, side, line);
      if (cells.length) return cells;
    }

    // Re-resolved rather than reusing `root`: that was looked up before
    // mountFile ran, when a virtualized file had no container on the page yet.
    // fileContainer needs a mounted cell, which a "Load diff" file has none of,
    // so fileRoot's container lookup is what finds those.
    const file = fileContainer(digest) || fileRoot(digest, filePath) || root;
    if (file) {
      // Bring the file to the viewport only when NONE of it is rendered — a
      // virtualized page mounts nothing for a file that's far off screen. Doing
      // it for a file already on screen would yank the page around on every
      // target of a multi-line reveal, before the caller has scrolled anywhere.
      if (!anyRow(digest)) file.scrollIntoView({ block: 'center' });
      if (loadDiff(file)) {
        cells = await waitForLine(digest, side, line);
        if (cells.length) return cells;
      }
    }

    // Walk the fold open a click at a time, re-reading the DOM each round —
    // GitHub replaces the expander row with the lines it fetched, so both the
    // gap and its controls are new nodes every time.
    let lastSig = '';
    for (let round = 0; round < MAX_UNFOLD_ROUNDS; round++) {
      const scope = fileScope(digest, side);
      const gap = scope && gapFor(scope, digest, side, line);
      if (!gap) break;
      const sig = gapSig(gap);
      if (sig === lastSig) break; // the previous click moved nothing — stop clicking
      lastSig = sig;
      const control = pickControl(gap, side, line);
      if (!control) break;
      control.click();
      cells = await waitForUnfold(digest, side, line, sig, scope);
      if (cells.length) return cells;
    }

    // Targeted unfolding didn't place it — fall back to opening the whole file.
    const whole = file || fileContainer(digest) || root;
    if (whole && expandAll(whole)) return waitForLine(digest, side, line);
    return visibleCells(digest, side, line);
  }

  function resetCache() {
    // Digests are pure functions of the path, so digestCache never goes stale.
    // The cell cache does: a navigation replaces the whole diff DOM, and though
    // identity revalidation would reject every stale entry, clearing here keeps
    // the map from carrying dead keys (and detached nodes) across pages.
    cellCache.clear();
  }

  return { fileDigest, lineCells, cellKey, cellIdentity, candidateCells, revealLine, resetCache };
})();
