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
      // TODO(phase-next): per-commit pages need a per-commit feed; today's feed
      // is the PR-aggregate one. Disabled until the action publishes per-commit
      // data (or we slice the PR feed by commit). The DOM hook is identical.
      disabled: true,
    },
  ];

  function pick(loc) {
    return adapters.find((a) => !a.disabled && a.matches(loc)) || null;
  }

  return { pick };
})();
