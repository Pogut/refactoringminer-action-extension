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
  // (the React diff virtualizes off-screen rows). Prefers the new view's
  // data-line-anchor; falls back to the classic view's element id.
  function lineCells(digest, side, line) {
    const anchor = `diff-${digest}${side}${line}`;
    const byData = document.querySelectorAll(`[data-line-anchor="${anchor}"]`);
    if (byData.length) return Array.prototype.slice.call(byData);
    const byId = document.getElementById(anchor);
    return byId ? [byId] : [];
  }

  function resetCache() {
    // Digests are pure functions of the path; nothing to reset between renders.
  }

  return { fileDigest, lineCells, resetCache };
})();
