var RMX = window.RMX || (window.RMX = {});

// Bridges a RefactoringMiner CodeRange ({ filePath, startLine, endLine, side })
// to the GitHub diff DOM. GitHub gives every diff line-number cell an id of
//   diff-<pathDigest><L|R><lineNumber>
// (the permalink anchor). So once we know a file's pathDigest, every line is a
// direct getElementById lookup — the same hook RefactoringAwareCommitReview
// matched on (`columnId == dataAnchor + side + line`).
RMX.github = (function () {
  let embeddedCache = null;

  // GitHub embeds a JSON payload describing the diff in a <script> tag; it maps
  // each file path to its pathDigest and works whether or not you're logged in.
  function embeddedData() {
    if (embeddedCache !== null) return embeddedCache;
    const script = document.querySelector('script[data-target="react-app.embeddedData"]');
    try {
      embeddedCache = script ? JSON.parse(script.textContent) : false;
    } catch (_) {
      embeddedCache = false;
    }
    return embeddedCache;
  }

  // Resolve a file path to its `diff-<pathDigest>` anchor, trying the cheap
  // DOM attributes first and the embedded payload as the reliable fallback.
  function anchorForFile(filePath) {
    for (const header of document.querySelectorAll('[data-path]')) {
      if (header.getAttribute('data-path') === filePath) {
        const a = header.getAttribute('data-anchor');
        if (a) return a;
      }
    }
    const data = embeddedData();
    const entries = data && data.payload && data.payload.diffEntryData;
    if (Array.isArray(entries)) {
      const hit = entries.find((e) => e.path === filePath);
      if (hit && hit.pathDigest) return `diff-${hit.pathDigest}`;
    }
    return null;
  }

  // The line-number cell for (anchor, side, line), or null if that line isn't
  // mounted. NOTE: the virtualized React diff only mounts rows near the
  // viewport, so a line outside it returns null until scrolled into view — the
  // re-render-on-scroll handling lives in content.js (phase-next).
  function lineCell(anchor, side, line) {
    return anchor ? document.getElementById(`${anchor}${side}${line}`) : null;
  }

  // The row we visibly highlight, given a line-number cell.
  function rowFor(cell) {
    return cell ? cell.closest('tr') || cell.parentElement : null;
  }

  function resetCache() {
    embeddedCache = null;
  }

  return { anchorForFile, lineCell, rowFor, resetCache };
})();
