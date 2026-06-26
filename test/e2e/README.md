# Browser end-to-end tests (Playwright)

Loads **this extension unpacked into a real Chromium** and drives the actual
`github.com` PR diffs in the [`Pogut/rm-action-test`](https://github.com/Pogut/rm-action-test)
sandbox, fetching the real RefactoringMiner feeds the action published to
gh-pages. This is the layer the offline [`test/highlight`](../highlight) jsdom
harness **can't** reach:

| Path | jsdom harness | this suite |
|---|---|---|
| `config.js` / `github.js` digest + feed-URL logic | ✅ | ✅ |
| overlay painting over a *modelled* classic DOM | ✅ | — |
| service-worker cross-origin feed fetch | stubbed | ✅ real |
| **real GitHub diff DOM** (id on the line-number `<td>`, code in the sibling `.blob-code`) | ❌ modelled wrong | ✅ |
| live GitHub markup drift | ❌ | ✅ |
| tooltip render + comment-link hash selection | partial | ✅ |

> The jsdom harness models each diff line as a single id'd cell that *contains*
> the code. Real classic GitHub puts the `diff-<digest><L\|R><line>` id on the
> empty line-**number** `<td>` and the source in a sibling `.blob-code` cell.
> That mismatch is why this suite exists — and `src/github.js`'s `nextBlobCode`
> resolution is what makes the overlay paint on the real page.

## Running

```sh
npm run test:e2e           # headless (new headless mode loads the extension)
npm run test:e2e:headed    # watch it drive a real window — use when a selector breaks
npx playwright test -g java   # one PR
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
- `highlight.spec.js` — per PR: highlights appear, only on files the feed names,
  the reported refactoring count equals the feed's, the legend shows. On PR #14:
  tooltip shows the feed description on hover, and an action comment-link hash
  (`#diff-<digest>R<line>`) neon-selects the refactoring it points at.

Assertions are derived from the **live feed**, not hard-coded, so a feed change
surfaces as a behaviour change rather than a stale number.

## Adding a PR

The feed must already be published (probe
`https://pogut.github.io/rm-action-test/refactorings/pr-<n>/refactorings.json`).
Add a `{ n, lang }` row to `PRS` in [`sandbox.js`](sandbox.js).
