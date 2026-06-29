# RefactoringMiner Action — Diff Overlay

A Chrome (MV3) extension that overlays the refactorings detected by
[refactoringminer-action](../refactoringminer-action) directly onto GitHub
diffs. It does **not** run RefactoringMiner — it reuses the single run the
action already did, by fetching the JSON feed the action publishes to GitHub
Pages and rendering the highlights client-side.

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
3. Open a PR **Files changed** page on a repo whose action has published a feed.
   Changed lines involved in a refactoring get a coloured gutter; hover for the
   refactoring type/description.

## Architecture

| File | Role |
|------|------|
| `src/config.js` | URL parsing + feed-path construction (mirrors the action) |
| `src/github.js` | `filePath → diff-<pathDigest>`; locate a line cell by id |
| `src/overlay.js` | view-agnostic renderer: highlight / tooltip / scroll |
| `src/messaging.js` | content → service-worker fetch bridge |
| `src/service-worker.js` | cross-origin feed fetch + per-URL cache |
| `src/views.js` | view adapters (files = active, commit = stub) |
| `src/content.js` | orchestrator + Turbo-navigation re-render |

## Dev

```
npx playwright install chromium   # one-time: fetch the browser build
npm test                          # browser E2E: loads the extension into Chromium,
                                  # drives the live rm-action-test PRs (see test/e2e/)
```
