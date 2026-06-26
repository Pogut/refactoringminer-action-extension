# Browser end-to-end tests (Playwright)

Loads **this extension unpacked into a real Chromium** and drives the actual
`github.com` PR diffs in the [`Pogut/rm-action-test`](https://github.com/Pogut/rm-action-test)
sandbox, fetching the real RefactoringMiner feeds the action published to
gh-pages. This is the project's only test suite: it exercises the full browser
path end to end — the service-worker cross-origin feed fetch, the **real** GitHub
diff DOM (and its markup drift), Turbo nav, tooltip render, and comment-link
selection — none of which can be checked without a real browser.

> A key real-DOM detail this suite pins: on the classic diff GitHub puts the
> `diff-<digest><L\|R><line>` id on the **empty line-number `<td>`**, with the
> source in a sibling `.blob-code` cell. `src/github.js`'s `nextBlobCode`
> resolution is what makes the overlay actually paint on the real page.

## Running

```sh
npm test                    # headless (new headless mode loads the extension)
npm run test:headed         # watch it drive a real window — use when a selector breaks
npx playwright test -g java # one PR
```

First run only, install the browser build:

```sh
npx playwright install chromium
```

These tests hit the live network. Logged-out automation always receives GitHub's
**classic** table diff (the new React `/changes` diff is served only to
logged-in users and redirects to `/files` otherwise), so this suite exercises the
classic-view code path.

## What it checks

- `fixtures.js` — boots Chromium with the extension (`--load-extension`), waits
  for its MV3 service worker, mirrors `[RMX] …` console logs onto the page.
- `sandbox.js` — the PR→feed map and the `sha256(filePath)` line-anchor helper
  (mirrors how the action and `src/github.js` key diff lines).
- `highlight.spec.js`:
  - **per PR** — highlights appear, only on files the feed names, the reported
    refactoring count equals the feed's, the legend shows.
  - **colour correctness** — a hand-verified table pins specific lines to the
    exact category (colour) they must paint: Rename → `updated` (blue), Move →
    `movedOut`/`movedIn` (orange/teal), Inline → `deleted` (red), Encapsulate
    getter → `inserted` (green). A regression in `categorize()` fails the exact
    line that changed colour.
  - **click-to-pair selection** — clicking a highlighted line lights the whole
    refactoring in gold (`rmx-sel` + the blinking `rmx-on` fill) on **both**
    sides; verified with a Move Attribute whose source (left) and destination
    (right) are different files, so "both sides lit" is unambiguous.
  - **PR #14** — tooltip shows the feed description on hover; an action
    comment-link hash (`#diff-<digest>R<line>`) neon-selects the refactoring.

Most assertions are derived from the **live feed**, not hard-coded. The colour and
click-to-pair tests use a small explicit table (confirmed against the live page),
so each row doubles as readable documentation of expected behaviour.

## Adding a PR

The feed must already be published (probe
`https://pogut.github.io/rm-action-test/refactorings/pr-<n>/refactorings.json`).
Add a `{ n, lang }` row to `PRS` in [`sandbox.js`](sandbox.js).
