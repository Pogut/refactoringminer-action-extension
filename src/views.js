window.RMX = window.RMX || {};

// View adapters. The line-id scheme (diff-<digest><L|R><line>) is the same on
// the PR "Files changed" page and the per-commit pages, so the adapters mostly
// differ in which URLs they claim — keeping the door open for view-specific
// tweaks (different headers, virtualization quirks) without touching the
// renderer.
window.RMX.views = (function () {
  const adapters = [
    {
      name: 'files',
      matches: (loc) => !!loc && loc.view === 'files',
    },
    {
      name: 'commit',
      matches: (loc) => !!loc && loc.view === 'commit',
      // A single commit's page — standalone /commit/<sha>, or a commit inside a
      // PR (/pull/<n>/commits/<sha> and the Preview /pull/<n>/changes/<sha>). The
      // action's feed is PR-aggregate, so content.js overlays only this commit,
      // sourced from a matching per-commit feed entry if one exists, otherwise
      // from a single-commit RefactoringMiner service call. DOM hook is identical.
    },
  ];

  function pick(loc) {
    return adapters.find((a) => !a.disabled && a.matches(loc)) || null;
  }

  return { pick };
})();
