# RefactoringMiner Action — Diff Overlay

A Chrome (MV3) extension that overlays the refactorings detected by
[refactoringminer-action](../refactoringminer-action) directly onto GitHub
diffs, and works standalone on commit pages too.

Two data sources ("dual mode"), chosen per page. Every page prefers the action's
published feed and falls back to a hosted **RefactoringMiner service** only when
the repo doesn't run the action — so the extension works on any repo, not just
ones with the action installed:

- **PR "Files changed" pages** reuse the single run the action already did, by
  fetching the JSON feed the action publishes to GitHub Pages — no re-analysis.
  No feed? The extension analyses the **whole PR in one service call**: the
  service treats an integer `commitId` as a pull-request number and runs
  `detectAtPullRequest`, so there's no per-commit loop.
- **Commit pages** (a standalone `/commit/<sha>`, or a single commit inside a PR)
  overlay **only that commit**. They ask the service to analyse just that sha, so
  a commit's page never shows the PR's entire refactoring set. (If a per-commit
  feed listing that sha exists it's used instead; the action's current feed is
  PR-aggregate, so in practice this is a direct single-commit analysis.)

Each page runs **only** the analysis for what it shows — opening one commit in a
PR analyses that commit, not all of the PR's commits. This is the same hosted-
service approach as [Refactoring-Aware-Commit-Review](../RefactoringAwareCommitReview)
and needs no local Docker (a browser extension can't run one). The default server
and an optional GitHub token for private repos are set in the options page. The
extension waits for a click on its toolbar icon by default; the options page can
instead make it activate automatically on supported diffs.

Either way, a collapsible **Refactorings** panel (bottom-left) lists every
refactoring; clicking a row blinks it on the diff — handy when you don't have the
action posting a PR comment, or don't want to leave the diff to read it. The
options page sets how fast that blink pulses, from a constant (never blinking)
highlight up to a rapid flash.

## How it works

```
GitHub Action (CI)                         This extension (browser)
------------------                         ------------------------
runs RefactoringMiner once   ── feed ──▶   fetches refactorings.json
publishes refactorings.json                resolves filePath → diff-<digest>
to gh-pages                                highlights leftSide/rightSide lines
```

The action publishes the feed at a path the extension can construct from the
page URL alone (no API calls, no second analysis):

```
https://<owner>.github.io/<repo>/refactorings/pr-<N>/refactorings.json
```

Feed shape (RefactoringMiner's classic `-json` output):

```json
{ "commits": [ {
  "url": "https://github.com/<owner>/<repo>/pull/<N>",
  "refactorings": [ {
    "type": "Extract Method",
    "description": "...",
    "leftSideLocations":  [ { "filePath": "...", "startLine": 5, "endLine": 9, "codeElementType": "..." } ],
    "rightSideLocations": [ { "filePath": "...", "startLine": 5, "endLine": 12, "codeElementType": "..." } ]
  } ]
} ] }
```

## Load it (unpacked)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open a PR **Files changed** page (on a repo whose action published a feed) or
   any **commit** page. Click a line involved in a refactoring — or a row in the
   bottom-left **Refactorings** panel, or a line link from the action's PR comment
   — and the whole refactoring blinks in neon on both sides, with its off-screen
   lines pinned to the top/bottom edge; hover a line for its type/description.
4. *(Optional)* Right-click the extension → **Options** to point commit-page
   analysis at a different RefactoringMiner server or add a token for private repos.

## Architecture

| File | Role |
|------|------|
| `src/config.js` | URL parsing + feed-path / git-URL construction (mirrors the action) |
| `src/github.js` | `filePath → diff-<pathDigest>`; locate a line cell across the diff UIs |
| `src/overlay.js` | view-agnostic renderer: tag cells / blink selection / pins / tooltip / report panel |
| `src/messaging.js` | content → service-worker feed-fetch bridge |
| `src/service-worker.js` | cross-origin feed fetch + per-URL cache |
| `src/rm.js` | standalone data source: hosted RefactoringMiner service client — one call per page, `commitId` = sha (single commit) or PR number (whole PR) |
| `src/views.js` | view adapters (`files` = whole PR, `commit` = single commit) |
| `src/content.js` | orchestrator: per-page feed→service source selection, stale-navigation guard, Turbo-navigation re-render |
| `options.html` / `options.js` | activation mode, highlight colours, blink speed, page theme, and standalone-service settings |

## Dev

```
npx playwright install chromium   # one-time: fetch the browser build
npm test                          # full suite (see test/e2e/)
```

Test suites:
- `logic.spec.js` — fast, deterministic unit tests for URL parsing / feed + git
  URL / RM request shape (no extension, no auth, no server).
- `commit.spec.js` — standalone mode end to end: a live commit page overlays from
  the RefactoringMiner service, with the report panel + click-to-blink (needs the
  RM server reachable; no GitHub session required).
- `preview.spec.js` — PR `/changes` overlays + report panel + selection/pins
  (needs a saved GitHub session — run `npm run test:auth` once).
