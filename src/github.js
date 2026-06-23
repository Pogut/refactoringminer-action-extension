var RMX = window.RMX || (window.RMX = {});

// Maps a RefactoringMiner CodeRange to GitHub diff line cells across both diff
// UIs. In both, the file digest is sha256(filePath), so we never scrape the DOM
// to resolve a file:
//   - classic /files: each line cell has id `diff-<digest><L|R><line>`.
//   - new /changes (React): cells carry `data-line-anchor="diff-<digest><L|R><line>"`.
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
    const sideAttr = side === 'L' ? 'left' : 'right';
    const candidates = document.querySelectorAll(
      `[data-diff-side="${sideAttr}"][data-line-number="${line}"]`,
    );
    const inFile = Array.prototype.filter.call(candidates, (el) => {
      const key = el.getAttribute('data-line-anchor') || el.getAttribute('data-grid-cell-id') || '';
      return key.indexOf('diff-' + digest) === 0;
    });
    if (inFile.length) return inFile;

    const byId = document.getElementById(`diff-${digest}${side}${line}`);
    return byId ? [byId] : [];
  }

  function resetCache() {
    // Digests are pure functions of the path; nothing to reset between renders.
  }

  return { fileDigest, lineCells, resetCache };
})();
