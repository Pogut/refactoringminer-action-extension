# RefactoringMiner Action — Diff Overlay

A Chrome (MV3) extension that overlays the refactorings detected by
[refactoringminer-action](../refactoringminer-action) directly onto GitHub
diffs, and works standalone on commit pages too.

Two data sources ("dual mode"):

- **PR "Files changed" pages** reuse the single run the action already did, by
  fetching the JSON feed the action publishes to GitHub Pages — no re-analysis.
- **Commit pages** (individual commits, in or out of a PR) have no feed, so the
  extension asks a hosted **RefactoringMiner service** to analyse the commit and
  returns the same JSON shape. This is the same approach as
  [Refactoring-Aware-Commit-Review](../RefactoringAwareCommitReview) and needs no
  local Docker (a browser extension can't run one). The default server and an
  optional GitHub token for private repos are set in the extension's options page.

Either way, a collapsible **Refactorings** panel (bottom-left) lists every
refactoring; clicking a row blinks it on the diff — handy when you don't have the
action posting a PR comment, or don't want to leave the diff to read it.

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
| `src/rm.js` | standalone data source: hosted RefactoringMiner service client (commit pages) |
| `src/views.js` | view adapters (files = feed, commit = RM service) |
| `src/content.js` | orchestrator: dual-mode source selection + Turbo-navigation re-render |
| `options.html` / `options.js` | RM service URL, token, timeout for standalone mode |

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
