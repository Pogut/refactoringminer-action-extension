// Regression test for the /changes virtualization glitch: React recycles a diff
// DOM node to render a different line as you scroll, and our highlight class +
// data-rmx-* attributes ride along onto a line no refactoring references. The
// scroll re-paint is additive (never clearAll), so without reconciliation the
// stale highlight sticks — exactly the "line 28 lit up out of nowhere" bug.
//
// The golden suite never caught this because it paints a static, fully-mounted
// DOM once. Here we mount a fixture, then mutate a painted node the way React's
// reconciler would (rewrite the text + data-line-anchor it manages, leave our
// attributes) and force an additive re-paint, asserting the stale paint is gone.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { buildWorld, triggerRepaint, sha256Hex } = require('./harness');

const FIXDIR = path.join(__dirname, 'fixtures');
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

function loadFixture(lang) {
  const dir = path.join(FIXDIR, lang);
  return {
    feed: JSON.parse(fs.readFileSync(path.join(dir, 'feed.json'), 'utf8')),
    meta: JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')),
    beforeDir: path.join(dir, 'before'),
    afterDir: path.join(dir, 'after'),
  };
}

async function main() {
  // Kotlin pr-12: OrderProcessor.kt L27 is painted (Inline Method's return
  // statement); L28 (`}`) is referenced only by a skipped container, so it must
  // never be painted. This is the real case from the bug report.
  const { window, ready } = buildWorld(loadFixture('kotlin'));
  await ready;

  const digest = sha256Hex('kotlin/OrderProcessor.kt');
  const at = (side, line) => window.document.getElementById(`diff-${digest}${side}${line}`);
  const painted = (el) => !!el && el.classList.contains('rmx-hl');

  ok(painted(at('L', 27)), 'baseline: OrderProcessor.kt L27 is painted');
  ok(!painted(at('L', 28)), 'baseline: OrderProcessor.kt L28 (}) is not painted');

  // React recycles the L27 node to display line 28: it rewrites the managed
  // text + anchor, but our class/attributes are left behind.
  const node = at('L', 27);
  node.setAttribute('data-line-anchor', `diff-${digest}L28`);
  node.id = `diff-${digest}L28`;
  node.textContent = '    }';

  await triggerRepaint(window);

  const recycled = at('L', 28);
  ok(!painted(recycled), 'after recycle + re-paint: the recycled L28 node carries no stale highlight');
  ok(recycled && recycled.getAttribute('data-rmx-cat') === null, 'stale data-rmx-cat is cleared too');

  // Guard the happy path: a node recycled to a line that IS a paint target must
  // still end up highlighted (reconciliation must not over-clear). L30 is a
  // paint target (Rename Method header); recycle an unpainted node onto it.
  const spare = at('L', 13) || window.document.createElement('div'); // L13 is unpainted
  spare.setAttribute('data-line-anchor', `diff-${digest}L30`);
  spare.id = `diff-${digest}L30b`; // distinct id so we don't collide with the real L30
  spare.textContent = window.document.getElementById(`diff-${digest}L30`).textContent;
  await triggerRepaint(window);
  ok(painted(at('L', 30)), 'a valid paint target is still highlighted after re-paint (no over-clear)');

  console.log(`recycle.test.js: ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
