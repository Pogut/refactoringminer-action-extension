// Standalone-mode end-to-end test: a plain commit page (NOT in a PR, no action
// feed) must overlay from the hosted RefactoringMiner service. Uses the
// logged-out fixture — commit pages are public and render the classic diff — and
// hits the live default RM server, so it's slow (server-side analysis up to ~60s)
// and depends on that server being reachable. It proves the whole standalone
// path: RMX.rm → content.js → tagged cells → report panel → click-to-blink.
const { test, expect } = require('./fixtures');
const sb = require('./sandbox');

// A commit on the sandbox repo known to contain refactorings (Rename/Move/…),
// confirmed against the RM service.
const COMMIT = 'b65346600e43fad70b02f037dda796f86015f0c6';

test('commit page overlays + report come from the RefactoringMiner service', async ({ page }) => {
  test.setTimeout(180_000); // server-side RM analysis can take up to the configured timeout

  await page.goto(`https://github.com/${sb.OWNER}/${sb.REPO}/commit/${COMMIT}`, {
    waitUntil: 'domcontentloaded',
  });

  // The report panel appears immediately (loading), then fills with one row per
  // refactoring once the service responds. Wait for the rows (the terminal state).
  await expect(page.locator('#rmx-report')).toBeVisible({ timeout: 30_000 });
  await page.locator('#rmx-report .rmx-rp-row').first().waitFor({ timeout: 150_000 });

  const rowCount = await page.locator('#rmx-report .rmx-rp-row').count();
  expect(rowCount, 'the service should report at least one refactoring for this commit').toBeGreaterThan(0);

  // The overlay logged a count, and tagged cells exist on the classic commit diff
  // (element-id cell path, not the React data-line-anchor one).
  const reported = page.rmxLogs.find((l) => l.includes('refactorings'));
  expect(reported, `expected an [RMX] log; got ${JSON.stringify(page.rmxLogs)}`).toBeTruthy();
  expect(await page.locator('.rmx-hl').count()).toBeGreaterThan(0);

  // Click-to-blink works exactly like the PR diff: clicking a tagged line selects
  // it (and its counterpart) in neon.
  const cell = page.locator('.rmx-hl[data-rmx-index]').first();
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  await expect(page.locator('.rmx-hl.rmx-sel').first()).toBeVisible({ timeout: 10_000 });

  // And a report-row click selects too (the panel is a live index into the diff).
  await page.locator('#rmx-report .rmx-rp-row').first().click();
  await expect(page.locator('.rmx-hl.rmx-sel').first()).toBeVisible({ timeout: 10_000 });
});
