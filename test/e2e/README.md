# Browser end-to-end tests (Playwright)

Loads **this extension unpacked into a real Chromium** and drives the actual
`github.com` PR diffs in the [`Pogut/rm-action-test`](https://github.com/Pogut/rm-action-test)
sandbox, fetching the real RefactoringMiner feeds the action published to
gh-pages. It exercises the full browser path end to end — the service-worker
cross-origin feed fetch, the **real** GitHub diff DOM (and its markup drift),
tooltip render, colour mapping, and the click-to-pair selection — none of which
can be checked without a real browser.

## One view: the logged-in "Preview" diff

GitHub serves two diff UIs, but this extension targets only the new **Preview**
`/changes` React diff — the logged-in experience you see day to day. All tests
run against it, so they need a saved GitHub session (captured once; see below).

> The classic logged-out `/files` table diff is **not supported**. (It still
> renders for logged-out visitors, but the extension does not highlight on it.)

The Preview diff keys each line cell with `data-line-anchor="diff-<digest><L|R><line>"`,
where `digest = sha256(filePath)` — the same string the action embeds in its PR
comment links. The suite mirrors that math (`sandbox.js`) to address a specific
line without scraping the DOM.

## Running

```sh
npx playwright install chromium  # first run only: fetch the browser build

npm run test:auth                # opens Chrome → sign in (+ 2FA) → session saved (once)
npm test                         # the whole suite (skips entirely if no session saved)
npm run test:headed              # watch it drive a real window
npx playwright test -g java      # one PR
npx playwright test -g "both sides"   # the click-to-pair / both-sides tests
```

## Authenticated session

The suite drives the logged-in `/changes` diff, so it needs a GitHub session,
captured once:

```sh
npm run test:auth                # opens Chrome → sign in (+ 2FA) → session saved
```

`test:auth` saves cookies to `test/e2e/.auth/github.json` (gitignored). Use an
account that has the **Preview diff enabled**. Sessions are long-lived; re-run
`npm run test:auth` only if the tests start failing on auth. Until a session
exists the whole suite is **skipped**, so `npm test` stays green when logged out.
(In CI, provide the session file as a secret, or let it skip.)

## What it checks

- `fixtures.js` — boots Chromium with the extension (`--load-extension`), waits
  for its MV3 service worker, injects the saved GitHub session, and mirrors
  `[RMX] …` console logs onto the page.
- `sandbox.js` — the PR→feed map, the `sha256(filePath)` anchor + `cellSelector`,
  the shared `COLOURS` table, and `fetchFeed()`. `auth.js` / `capture-auth.js`
  manage the saved GitHub session.
- `preview.spec.js`:
  - **per PR** — highlights paint (via the `data-line-anchor` cell path), only on
    files the feed names, the reported refactoring count equals the feed's, the
    legend shows.
  - **colour correctness** — a hand-verified table (`sandbox.js`) pins specific
    lines to the exact category (colour) they must paint: Rename → `updated`
    (blue), Move → `movedOut`/`movedIn` (orange/teal), Inline → `deleted` (red),
    Encapsulate getter → `inserted` (green). The diff is virtualized, so the test
    scrolls it in steps and accumulates each line's colour before scrolling
    unmounts it; rows GitHub never renders in headless are reported and skipped
    (with a floor so the pass can't be vacuous).
  - **click-to-pair selection** — clicking a highlighted line lights the whole
    refactoring in gold (`rmx-sel` + the blinking `rmx-on` fill) on **both** sides.
    Self-calibrating: it discovers a refactoring whose left and right cells are
    both mounted, so it doesn't depend on the diff's exact layout.
  - **left/right side colour distinction** — the left ("before") cell paints a
    hot-pink outline + fill, the right ("after") cell a violet one. Asserted with
    real *computed* CSS, so a wrong hex or a swapped L/R rule fails here even
    though the class names would still look correct.
  - **PR #14** — tooltip shows the feed description on hover; an action
    comment-link hash (`#diff-<digest>R<line>`) neon-selects the refactoring it
    points at (the test scrolls the target file into view so the virtualized row
    mounts and the re-paint's deep-link handler selects it).
  - **pinned bars** — a selected line scrolled out of view is mirrored as a
    floating bar; its stripe uses the side colour; the collapsible toggle adds/
    removes the bar rows while staying put; and the toggle DOM node survives
    scroll re-paints (a regression test for a past hover-flicker bug).

Most assertions are derived from the **live feed**, not hard-coded. The colour
and click-to-pair tests use a small explicit table / self-calibration (confirmed
against the live page), so each row doubles as readable documentation of expected
behaviour.

## Adding a PR

The feed must already be published (probe
`https://pogut.github.io/rm-action-test/refactorings.json`). Note the site now
serves a single root feed for the most-recently-deployed PR, so only that PR's
feed is live at a time — see the NOTE in [`sandbox.js`](sandbox.js).
Add a `{ n, lang }` row to `PRS` in [`sandbox.js`](sandbox.js).
