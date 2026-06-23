// Regression test for the split /changes anchor-collision bug: GitHub gives the
// two cells of an aligned row the SAME data-line-anchor (the right line's), so a
// right-side highlight (e.g. an inserted `}` at R27) leaks onto the left-column
// cell on that row (visually "line 28 on the left lit up"). The real cells carry
// their true side/line in data-diff-side + data-line-number; the fix keys on
// those, so RMX.github.lineCells must never return the wrong-column cell.
//
// The golden harness can't catch this — it builds unique classic-view ids, where
// one anchor maps to exactly one cell — so this models the React DOM directly.
const assert = require('assert');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

const digest = sha256('kotlin/OrderProcessor.kt');

// Build one aligned diff row the way GitHub's split /changes view does: a left
// cell and a right cell that SHARE data-line-anchor (the right line's), each with
// its own data-diff-side + data-line-number.
function alignedRow(doc, tbody, { leftLine, rightLine, anchorLine, leftText, rightText }) {
  const anchor = `diff-${digest}R${anchorLine}`;
  const mk = (sideAttr, lineNo, text) => {
    const td = doc.createElement('td');
    td.className = 'diff-text-cell';
    td.setAttribute('data-diff-side', sideAttr);
    if (lineNo != null) td.setAttribute('data-line-number', String(lineNo));
    td.setAttribute('data-line-anchor', anchor); // collision: both sides, same anchor
    td.setAttribute('data-grid-cell-id', anchor);
    td.textContent = text;
    return td;
  };
  const tr = doc.createElement('tr');
  tr.appendChild(mk('left', leftLine, leftText));
  tr.appendChild(mk('right', rightLine, rightText));
  tbody.appendChild(tr);
}

const dom = new JSDOM('<!DOCTYPE html><body><table><tbody id="t"></tbody></table></body>', {
  runScripts: 'outside-only',
});
const { window } = dom;
window.eval(fs.readFileSync(path.join(SRC, 'config.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(SRC, 'github.js'), 'utf8'));

const tbody = window.document.getElementById('t');
// The exact bug row: left line 28 `}` aligned with right line 27 `}`, both
// anchored R27.
alignedRow(window.document, tbody, {
  leftLine: 28, rightLine: 27, anchorLine: 27, leftText: '    }', rightText: '    }',
});

const cellsR27 = window.RMX.github.lineCells(digest, 'R', 27);
const cellsL28 = window.RMX.github.lineCells(digest, 'L', 28);

ok(cellsR27.length === 1, 'R27 resolves to exactly one cell (not the colliding left cell)');
ok(cellsR27[0].getAttribute('data-diff-side') === 'right', 'R27 cell is the right-column cell');
ok(cellsR27[0].getAttribute('data-line-number') === '27', 'R27 cell has line number 27');

// The left cell of that row (line 28) is reachable as L28, even though GitHub
// labelled its data-line-anchor with the right line (R27).
ok(cellsL28.length === 1, 'L28 still resolves (despite its anchor being the right line)');
ok(cellsL28[0].getAttribute('data-diff-side') === 'left', 'L28 cell is the left-column cell');

// And the two never overlap — painting R27 cannot touch the left cell.
ok(cellsR27[0] !== cellsL28[0], 'R27 and L28 resolve to different cells');

console.log(`split-collision.test.js: ${passed} assertions passed`);
