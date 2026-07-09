var RMX = window.RMX || (window.RMX = {});

// View adapters. The line-id scheme (diff-<digest><L|R><line>) is the same on
// the PR "Files changed" page and the per-commit pages, so the adapters mostly
// differ in which URLs they claim — keeping the door open for view-specific
// tweaks (different headers, virtualization quirks) without touching the
// renderer.
RMX.views = (function () {
  const adapters = [
    {
      name: 'files',
      matches: (loc) => !!loc && loc.view === 'files',
    },
    {
      name: 'commit',
      matches: (loc) => !!loc && loc.view === 'commit',
      // Per-commit pages have no action feed (it's PR-aggregate), so content.js
      // sources their refactorings from the RefactoringMiner service (RMX.rm)
      // instead. The DOM hook (diff-<digest><L|R><line>) is identical.
    },
  ];

  function pick(loc) {
    return adapters.find((a) => !a.disabled && a.matches(loc)) || null;
  }

  return { pick };
})();
