var RMX = window.RMX || (window.RMX = {});

// Maps a RefactoringMiner CodeRange to GitHub diff line cells across GitHub's
// diff UIs. In all of them the file digest is sha256(filePath), so we never
// scrape the DOM to resolve a file:
//   - classic /files: each line cell has id `diff-<digest><L|R><line>`.
//   - PR /changes (React split): cells carry `data-diff-side` + `data-line-number`
//     (the anchor is shared across the aligned row, so we can't key on it alone).
//   - commit React diff: each cell has a UNIQUE `data-line-anchor` /
//     `data-grid-cell-id` = `diff-<digest><L|R><line>` and a side class
//     (`left-side-diff-cell` / `right-side-diff-cell`), but no `data-diff-side`.
RMX.github = (function () {
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

  function resetCache() {
    // Digests are pure functions of the path; nothing to reset between renders.
  }

  return { fileDigest, lineCells, resetCache };
})();
