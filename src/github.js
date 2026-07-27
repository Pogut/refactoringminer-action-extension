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

  // Any rendered row of this file, or null when none of it is on the page.
  function anyRow(digest) {
    return document.querySelector(
      `[data-line-anchor^="diff-${digest}"], [data-grid-cell-id^="diff-${digest}"], [id^="diff-${digest}"][data-line-number]`,
    );
  }

  // The subtree to look for this file's folds in: its element when GitHub gives
  // us one, else the smallest ancestor of a mounted cell that reaches an unfold
  // control without reaching into the next file. Climbing rather than matching a
  // wrapper class is what keeps this alive across GitHub's UI rewrites.
  function fileScope(digest) {
    const byId = document.getElementById('diff-' + digest);
    if (byId) return byId;
    let el = anyRow(digest);
    if (!el) return null;
    let best = el;
    for (let n = 0; n < MAX_CLIMB && el.parentElement; n++) {
      el = el.parentElement;
      if (hasForeignRows(el, digest)) break;
      best = el;
      if (el.querySelector(EXPANDER_SEL)) break; // a control is in reach — stop widening
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

  // Resolve once (file, side, line) is in the DOM, polling briefly while the
  // clicked control's async load lands. Resolves to the cells, or [] on timeout.
  async function waitForLine(digest, side, line, tries = 20, delay = 150) {
    for (let n = tries; ; n--) {
      const cells = lineCells(digest, side, line);
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
      const cells = lineCells(digest, side, line);
      if (cells.length) return cells;
      if (!host.isConnected) host = fileScope(digest);
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
  // mounted — a single lineCells lookup.
  async function revealLine(digest, side, line) {
    let cells = lineCells(digest, side, line);
    if (cells.length) return cells;

    const file = fileContainer(digest);
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
      const scope = fileScope(digest);
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
    const root = fileContainer(digest);
    if (root && expandAll(root)) return waitForLine(digest, side, line);
    return lineCells(digest, side, line);
  }

  function resetCache() {
    // Digests are pure functions of the path; nothing to reset between renders.
  }

  return { fileDigest, lineCells, revealLine, resetCache };
})();
