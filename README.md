# RefactoringMiner Action — Diff Overlay

A Chrome (MV3) extension that overlays the refactorings detected by
[refactoringminer-action](https://github.com/Pogut/refactoringminer-action) directly onto GitHub
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
service approach as [Refactoring-Aware-Commit-Review](https://github.com/EmpiricalSEConcordia/Refactoringminer-Astdiff-Exporter)
and needs no local Docker (a browser extension can't run one). The default server
and an optional GitHub token for private repos are set in the options page. The
extension waits for a click on its toolbar icon by default; the options page can
instead make it activate automatically on supported diffs.

Either way, a collapsible **Refactorings** panel lists every refactoring; clicking
a row blinks it on the diff — handy when you don't have the action posting a PR
comment, or don't want to leave the diff to read it. The options page sets how
fast that blink pulses, from a constant (never blinking) highlight up to a rapid
flash.

The same page picks how much of the diff the panel takes, and with it how much of
each refactoring's RefactoringMiner record it shows. All three list the same
refactorings and highlight the same lines:

| Level | Footprint | Shows |
| --- | --- | --- |
| **Compact** (default) | small card, bottom-left | type + the element it touched; the description opens on click |
| **Expanded** | the card elongated along the bottom | the full description and the files touched, on every row |
| **Detailed** | a dock across the whole bottom of the page | the above, plus every code element RefactoringMiner named (its role, kind, and `file:line`, each clickable), and a checkbox per refactoring type to show one kind at a time |

The detailed dock is the [Refactoring-Aware-Commit-Review](https://github.com/EmpiricalSEConcordia/Refactoringminer-Astdiff-Exporter)
full-width panel brought back as an option. Its type filter hides rows (and the
navigator/minimap entries that go with them) — nothing is un-analysed by it, so a
filtered-out line still blinks if you click it in the diff. Clicking the dock's
header collapses it out of the way.

### Clickable code elements

RefactoringMiner sends each refactoring's description twice: as plain prose, and
as `markup` — the same sentence in markdown with every code element linked to the
line it sits on. Wherever the panel shows a description it renders the markup, so
each element is clickable and takes you to **that** line rather than to the
refactoring's default landing spot. A feed without `markup` falls back to the
prose, unlinked.

Arriving there, the element itself is highlighted — not the whole diff row. The
row already carries the selection fill, so the element is painted in the
**complement of that fill**: the opposite hue, and the opposite end of the
lightness scale, with its own text colour so the code stays readable on it. Amber
lines get a blue element, azure lines an orange one, flipped in GitHub's dark
theme. Its extent comes from the `startColumn`/`endColumn` RefactoringMiner
reports; a multi-line element is lit from its start column to the end of that
line (its signature, or its `if (…)` clause), because RefactoringMiner's
multi-line ranges are declaration ranges whose end overshoots. The location rows
in the detailed dock light up their element the same way.

This is painted with the CSS Custom Highlight API rather than by wrapping the
characters in a span: GitHub renders a line as a run of syntax-coloured elements
that an element rarely lines up with, and the diff recycles those nodes as it
scrolls. Where the API is unavailable the whole-line highlight still works, only
without the element on top.

Clicking never navigates: the panel intercepts the click and reveals the line in
place, which is what lets it unfold a collapsed hunk, expand a file behind
"Viewed", or mount a virtualized row first — none of which a plain jump to an
anchor can do. The links stay real `<a href>`s so ⌘/Ctrl-click still opens a new
tab, and those hrefs are **retargeted onto the page you are on**. That matters
because the service takes a single `commitId` and cannot tell a standalone commit
from a commit inside a PR, so a sha request always emits `/commit/<sha>` links —
which point off a `/pull/<n>/changes/<sha>` page. Rebasing onto the current path
(rather than swapping `/commit/` for `/pull/<n>/changes/`) also keeps the classic
`/pull/<n>/files` and `/pull/<n>/commits/<sha>` URLs right.

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

1. Get the files: download **`extension.zip`** from the
   [latest release](../../releases/latest) and unzip it (it holds only the files
   the extension needs), or clone/download this repo.
2. `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select the unzipped folder (or this repo folder).
4. Open a PR **Files changed** page (on a repo whose action published a feed) or
   any **commit** page. Click a line involved in a refactoring, or a row in the
   bottom-left **Refactorings** panel, or a line link from the action's PR comment,
   and the whole refactoring blinks in neon on both sides, with its off-screen
   lines pinned to the top/bottom edge; hover a line for its type/description.
5. *(Optional)* Right-click the extension → **Options** to point commit-page
   analysis at a different RefactoringMiner server or add a token for private repos.

## Architecture

| File | Role |
|------|------|
| `src/config.js` | URL parsing + feed-path / git-URL construction (mirrors the action) |
| `src/github.js` | `filePath → diff-<pathDigest>`; locate a line cell across the diff UIs |
| `src/overlay.js` | view-agnostic renderer: tag cells / blink selection / pins / tooltip / report panel at its three detail levels |
| `src/messaging.js` | content → service-worker feed-fetch bridge |
| `src/service-worker.js` | cross-origin feed fetch + per-URL cache |
| `src/rm.js` | standalone data source: hosted RefactoringMiner service client — one call per page, `commitId` = sha (single commit) or PR number (whole PR) |
| `src/views.js` | view adapters (`files` = whole PR, `commit` = single commit) |
| `src/content.js` | orchestrator: per-page feed→service source selection, stale-navigation guard, Turbo-navigation re-render |
| `options.html` / `options.js` | activation mode, panel level, highlight colours, blink speed, page theme, and standalone-service settings |

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
