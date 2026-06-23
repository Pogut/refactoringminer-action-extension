# Highlight end-to-end tests

Drives the **real** overlay code over a reconstructed GitHub diff, per language,
and records exactly which lines light up on the left (before) and right (after)
sides — so highlighting glitches are tracked and documented instead of found by
re-running the action and eyeballing each PR.

## How it works

For each language in [`fixtures.config.js`](fixtures.config.js) there's a real PR
captured under `fixtures/<lang>/`:

- `feed.json` — the `refactorings.json` the action published.
- `before/` and `after/` — the source trees the diff was computed from (left/right).
- `meta.json` — owner/repo/PR, used to build the page URL.

[`harness.js`](harness.js) rebuilds GitHub's classic split-diff DOM from those
trees (one id'd cell per source line per side), injects a stubbed feed fetch +
webcrypto, loads the unmodified `src/*.js`, and lets `content.js` paint. It then
reads back every `.rmx-hl` cell. No browser, no network.

[`report.js`](report.js) turns the painted cells into a per-refactoring record
(`golden/<lang>.report.json` + a readable `.md` table). [`lint.js`](lint.js)
flags suspicious highlighting (`golden/<lang>.findings.json`).

## Running

```sh
npm run test:highlight          # gate: fail on any error finding or golden drift
npm run test:highlight:update   # rewrite goldens after an intended change, then review the diff
npm run fixtures:capture        # re-snapshot fixtures from the rm-action-test repo
```

`fixtures:capture` reads from `../../../rm-action-test` by default; override with
`RM_TEST_REPO=/path/to/rm-action-test`.

The goldens are committed. **A change in highlighting on any language shows up as
a golden diff** — that diff is the documentation of what moved.

## Glitch codes

| code | level | meaning |
|---|---|---|
| `blank-line-highlight` | error | A blank source line got painted — the blank/overshoot trim has a hole. |
| `one-sided` | warn | Feed has both sides but only one was painted; the counterpart is missing. |
| `nothing-painted` | warn | Refactoring has locations but nothing highlighted. |
| `range-exceeds-file` | warn | A feed line range runs past EOF on that side, so part of it can't paint. |
| `category-side-mismatch` | warn | A right-only colour on the left (or vice versa). |

The build fails on any `error` and on any drift from the committed findings, so
new warnings can't sneak in unreviewed.

## Known, catalogued glitches

- **Python ranges overshoot by one line** (`range-exceeds-file`, 9 cases in
  `pr-14`). RefactoringMiner's inclusive declaration ranges trail one phantom
  line past EOF in indent-based languages; Java/Kotlin/TypeScript show none. The
  overlay's `lineHasCode` / `startsDeclaration` trimming absorbs these, so no
  blank line is actually painted (0 errors) — but the source overshoot is real
  and documented here.

## Adding a language

1. Add a `{ lang, feedPr, beforeRef, afterRef }` row to `fixtures.config.js`
   (the before/after refs are the PR's base/head branches in the test repo).
2. `npm run fixtures:capture` then `npm run test:highlight:update`.
3. Review `golden/<lang>.report.md` and `findings.json`, then commit.
