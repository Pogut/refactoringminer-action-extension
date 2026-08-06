// A refactoring reported on a whole declaration — Rename Method, Move Method,
// Change Modifier — is tagged on that declaration's header line alone. But
// RefactoringMiner's first line is the first line of the DECLARATION, so on an
// annotated member it lands on `@Override`: the reported bug was that both sides
// lit up an annotation, identical before and after, while the signature that
// actually got renamed stayed dark one line below.
//
// content.js now plans the whole window the signature can be in and marks those
// lines with a header group; overlay.js keeps exactly one of them, skipping the
// annotations (and decorators, javadoc and blank padding) above it. These tests
// drive that choice against mounted cells, with no network and no live GitHub.
const path = require('path');
const { test, expect } = require('@playwright/test');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const { digest } = require('./sandbox');

const PATH = 'src/main/java/org/jabref/logic/net/ssl/SSLPreferences.java';
const DIGEST = digest(PATH);
const START = 10; // where RefactoringMiner says the declaration starts

test.beforeEach(async ({ page }) => {
  await page.goto('about:blank');
  await page.addScriptTag({ path: path.join(SRC, 'github.js') });
  await page.addScriptTag({ path: path.join(SRC, 'overlay.js') });
});

// Mount `source` (one entry per line, starting at START; null = a row the
// virtualizer hasn't mounted), hand the overlay the plan content.js compiles for
// a declaration-only refactoring covering that window, and report which lines
// came back tagged.
async function taggedLines(page, source) {
  return page.evaluate(({ d, start, source, filePath }) => {
    source.forEach((code, n) => {
      if (code === null) return;
      const cell = document.createElement('div');
      cell.setAttribute('data-line-anchor', `diff-${d}R${start + n}`);
      cell.setAttribute('data-diff-side', 'right');
      cell.setAttribute('data-line-number', String(start + n));
      cell.textContent = code;
      document.body.appendChild(cell);
    });

    // The shape buildPlan() emits: every line of the header window planned, all
    // of them carrying the same header group, none of them `trailing`.
    const group = RMX.github.cellKey(d, 'R', start);
    const byKey = new Map();
    source.forEach((_, n) => {
      byKey.set(RMX.github.cellKey(d, 'R', start + n), {
        filePath,
        contribs: [{ index: '0', summary: 'Rename Method: old() → new()', header: group, trailing: false }],
      });
    });
    const headerGroups = new Map([
      [group, { digest: d, side: 'R', startLine: start, endLine: start + source.length - 1 }],
    ]);

    RMX.overlay.setPlan({ byKey, headerGroups, descByIndex: { 0: 'Rename Method' } });
    RMX.overlay.paintAll();
    return Array.from(document.querySelectorAll('.rmx-hl'))
      .map((el) => parseInt(el.getAttribute('data-line-number'), 10))
      .sort((a, b) => a - b);
  }, { d: DIGEST, start: START, source, filePath: PATH });
}

test('an annotated method is tagged on its signature, not on @Override', async ({ page }) => {
  const lines = await taggedLines(page, [
    '  @Override',
    '  public void renamedMethod(String name) {',
    '    return;',
  ]);
  expect(lines).toEqual([START + 1]);
});

test('a stack of annotations is stepped over, however many there are', async ({ page }) => {
  const lines = await taggedLines(page, [
    '  @Override',
    '  @Deprecated',
    '  @SuppressWarnings("unchecked")',
    '  public void renamedMethod() {',
  ]);
  expect(lines).toEqual([START + 3]);
});

test("an annotation's argument list spilling over lines is not mistaken for the signature", async ({ page }) => {
  const lines = await taggedLines(page, [
    '  @RequestMapping(value = "/x",',
    '      method = RequestMethod.GET)',
    '  public void renamedMethod() {',
  ]);
  expect(lines).toEqual([START + 2]);
});

test('javadoc and blank padding are stepped over too', async ({ page }) => {
  const lines = await taggedLines(page, [
    '  /**',
    '   * Does a thing.',
    '   */',
    '  @Override',
    '',
    '  public void renamedMethod() {',
  ]);
  expect(lines).toEqual([START + 5]);
});

test('a Python decorator is stepped over onto the def', async ({ page }) => {
  const lines = await taggedLines(page, [
    '  @property',
    '  def renamed_method(self):',
    '    return 1',
  ]);
  expect(lines).toEqual([START + 1]);
});

test('an unannotated declaration still tags its own first line, and nothing below it', async ({ page }) => {
  const lines = await taggedLines(page, [
    '  public void renamedMethod(String name) {',
    '    int x = 1;',
    '    return;',
  ]);
  expect(lines).toEqual([START]);
});

test('a window the diff has not mounted falls back to the declaration line', async ({ page }) => {
  // The virtualizer hasn't rendered the annotation yet, so the signature can't
  // be identified — and guessing would tag a body line. Nothing below the
  // declaration line is tagged; a later re-paint decides once the row mounts.
  const lines = await taggedLines(page, [
    null,
    '  public void renamedMethod() {',
    '    return;',
  ]);
  expect(lines).toEqual([]);
});
