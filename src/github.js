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
  // lineCells only sees rendered rows. Two states hide a target line and never
  // resolve on their own: a large diff GitHub collapsed behind a "Load diff"
  // button, and context folded behind the unfold / "Expand all" controls.
  // revealLine drives GitHub's OWN buttons to materialise the file, then waits
  // for the line to mount — the content script's MutationObserver re-tags it.
  // We click rather than replay GitHub's fetch so a change to that endpoint
  // keeps working (the same choice CodeTracker's authors made).

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

  // Find a clickable control inside `root` by its VISIBLE LABEL rather than a
  // class name — GitHub rewrites these classes often, and the label is the
  // stable anchor across both the classic and React diff UIs.
  function controlByText(root, re) {
    return Array.prototype.find.call(
      root.querySelectorAll('button, a, summary'),
      (el) => re.test((el.textContent || '').trim()),
    );
  }

  // Click the first reveal control present: "Load diff" (collapsed large diff)
  // or "Expand all" (folded context hunks). Returns true if one was clicked.
  function revealFile(file) {
    const load = controlByText(file, /^load diff$/i);
    if (load) { load.click(); return true; }
    const expand = controlByText(file, /^expand all$/i);
    if (expand) { expand.click(); return true; }
    return false;
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

  // Force GitHub to render the file that owns (side, line) so the line becomes
  // taggable, then resolve to its cells (or [] if it stays unavailable). Cheap
  // when the line is already mounted — a single lineCells lookup.
  async function revealLine(digest, side, line) {
    let cells = lineCells(digest, side, line);
    if (cells.length) return cells;
    const file = fileContainer(digest);
    if (file) {
      file.scrollIntoView({ block: 'center' });
      // A collapsed file needs "Load diff" first; the context around the target
      // may then still be folded, so re-find (the node can be replaced by the
      // load) and click "Expand all" before the final wait.
      if (revealFile(file)) {
        cells = await waitForLine(digest, side, line);
        if (cells.length) return cells;
        const reloaded = fileContainer(digest);
        if (reloaded) revealFile(reloaded);
      }
    }
    return waitForLine(digest, side, line);
  }

  function resetCache() {
    // Digests are pure functions of the path; nothing to reset between renders.
  }

  return { fileDigest, lineCells, revealLine, resetCache };
})();
