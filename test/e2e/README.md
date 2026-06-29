# Browser end-to-end tests (Playwright)

Loads **this extension unpacked into a real Chromium** and drives the actual
`github.com` PR diffs in the [`Pogut/rm-action-test`](https://github.com/Pogut/rm-action-test)
sandbox, fetching the real RefactoringMiner feeds the action published to
gh-pages. It exercises the full browser path end to end — the service-worker
cross-origin feed fetch, the **real** GitHub diff DOM (and its markup drift),
tooltip render, colour mapping, and the click-to-pair selection — none of which
can be checked without a real browser.

GitHub serves two different diff UIs, so there are **two suites**:

| Suite | File | Session | GitHub view |
|---|---|---|---|
| **classic** | `highlight.spec.js` | logged out | the old `/files` table diff |
| **preview** | `preview.spec.js` | logged **in** | the new `/changes` React diff (image you see day-to-day) |

Logged-out automation always gets the classic table (`/changes` redirects to
`/files`); the Preview diff requires an authenticated session.

> A key real-DOM detail the classic suite pins: GitHub puts the
> `diff-<digest><L\|R><line>` id on the **empty line-number `<td>`**, with the
> source in a sibling `.blob-code` cell. `src/github.js`'s `nextBlobCode`
> resolution is what makes the overlay actually paint there. The Preview diff
> instead carries that anchor on `data-line-anchor`.

## Running

```sh
npx playwright install chromium  # first run only: fetch the browser build

npm test                         # everything (Preview tests skip unless a session is saved)
npm run test:headed              # watch it drive a real window
npx playwright test highlight    # classic suite only
npx playwright test preview      # Preview suite only (needs a session — see below)
npx playwright test -g java      # one PR
```

## Authenticated Preview-diff tests

`preview.spec.js` drives the logged-in `/changes` diff, covering what the classic
suite can't: the `data-line-anchor` cell path, the virtualized diff, and the
**pinned-line bars** that appear when a selected line scrolls off-screen. It needs
a GitHub session, captured once:

```sh
npm run test:auth                # opens Chrome → sign in (+ 2FA) → session saved
npx playwright test preview      # now runs against the Preview diff
```

`test:auth` saves cookies to `test/e2e/.auth/github.json` (gitignored). Use an
account that has the **Preview diff enabled**. Sessions are long-lived; re-run
`npm run test:auth` only if the Preview tests start failing on auth. Until a
session exists the Preview file is **skipped**, so `npm test` stays green when
logged out. (In CI, provide the session file as a secret, or let it skip.)

## What it checks

- `fixtures.js` — boots Chromium with the extension (`--load-extension`), waits
  for its MV3 service worker, mirrors `[RMX] …` console logs onto the page. One
  factory yields both the logged-out `test` and the authenticated `authedTest`.
- `highlight.spec.js` (logged out):
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
- `preview.spec.js` (logged in) — the same colour + click-to-pair contract on the
  `/changes` React diff, plus Preview-only paths: painting via `data-line-anchor`,
  and the **pinned bars** for selected lines scrolled out of view. The
  click-to-pair test is self-calibrating (it discovers a both-sides refactoring
  from the live DOM), so it doesn't depend on the Preview diff's exact layout.
- `sandbox.js` — the PR→feed map, the `sha256(filePath)` anchor + `cellSelector`
  (works in both views), and the shared `COLOURS` table. `auth.js` /
  `capture-auth.js` manage the saved GitHub session.

Most assertions are derived from the **live feed**, not hard-coded. The colour and
click-to-pair tests use a small explicit table (confirmed against the live page),
so each row doubles as readable documentation of expected behaviour.

## Adding a PR

The feed must already be published (probe
`https://pogut.github.io/rm-action-test/refactorings/pr-<n>/refactorings.json`).
Add a `{ n, lang }` row to `PRS` in [`sandbox.js`](sandbox.js).
