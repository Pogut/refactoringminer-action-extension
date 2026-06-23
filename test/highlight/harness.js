// The end-to-end harness. It reconstructs a GitHub *classic* split-diff DOM from
// a fixture's before/after trees, loads the extension's real, unmodified content
// scripts into it, stubs the feed fetch, lets the overlay paint, then reads back
// exactly which cells lit up. No browser, no network — just the production
// painting pipeline (content.js -> github.lineCells -> overlay.highlightRange)
// driven over a deterministic DOM.
//
// Classic-view fidelity is all we need: github.lineCells resolves a line via
// `document.getElementById('diff-<sha256(path)><L|R><line>')`, so a flat list of
// id'd code cells — one per source line, per side — exercises the whole path,
// including the blank-line / declaration-overshoot trimming that reads cell text.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');

const SRC = path.resolve(__dirname, '..', '..', 'src');
// Same order as manifest.json's content_scripts — load order matters because the
// files populate one shared RMX namespace and content.js self-runs on load.
const SCRIPTS = ['config.js', 'github.js', 'overlay.js', 'messaging.js', 'views.js', 'content.js'];

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

// Read every file under a fixture side-dir as { relPath: 'line\nline...' }.
function readTree(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs)) {
      const a = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(a).isDirectory()) walk(a, r);
      else out[r] = fs.readFileSync(a, 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

// Build the id'd code cells for one side from a {path: content} tree. One <div>
// per source line, id `diff-<digest><side><line>`, textContent = the raw line
// (indentation preserved, so the def/class overshoot guard sees real code). We
// mirror GitHub enough that the overlay can't tell the difference.
function mountSide(doc, container, tree, side) {
  Object.keys(tree).forEach((rel) => {
    const digest = sha256Hex(rel);
    const lines = tree[rel].split('\n');
    // A trailing newline yields one phantom empty element; drop it so line
    // counts match the file (matters for the range-exceeds-file check).
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.forEach((text, i) => {
      const cell = doc.createElement('div');
      cell.id = `diff-${digest}${side}${i + 1}`;
      cell.setAttribute('data-line-anchor', cell.id); // also lets pin code read it
      cell.textContent = text;
      container.appendChild(cell);
    });
  });
}

// Build a loaded diff world for a fixture: a jsdom window with the before/after
// cells mounted, the feed/crypto globals injected, and the extension's content
// scripts evaluated. Resolves once the first paint settles. Returns the window
// (and `sha256Hex`) so tests can poke the DOM — e.g. simulate virtualization
// recycling — and trigger re-paints. renderFixture is the thin "just give me the
// painted cells" wrapper used by the golden suite.
function buildWorld({ feed, meta, beforeDir, afterDir }) {
  const url = `https://github.com/${meta.owner}/${meta.repo}/pull/${meta.prNumber}/files`;
  const dom = new JSDOM('<!DOCTYPE html><body><div id="diff"></div></body>', {
    url,
    pretendToBeVisual: true, // provides requestAnimationFrame for the pin scheduler
    runScripts: 'outside-only',
  });
  const { window } = dom;

  // Inject the two globals the content scripts reach for: webcrypto (github.js
  // digests paths) and the extension messaging bridge (messaging.js asks the
  // service worker for the feed; we answer synchronously with the fixture).
  // jsdom's window.crypto is a read-only getter (and lacks subtle), so define
  // over it: github.js calls crypto.subtle.digest to hash file paths.
  Object.defineProperty(window, 'crypto', { value: crypto.webcrypto, configurable: true });
  window.chrome = {
    runtime: {
      lastError: null,
      sendMessage: (_msg, cb) => cb({ ok: true, feed }),
      getManifest: () => ({ version: 'test' }),
    },
  };

  const container = window.document.getElementById('diff');
  mountSide(window.document, container, readTree(beforeDir), 'L');
  mountSide(window.document, container, readTree(afterDir), 'R');

  // Resolve when content.js logs its completion line, or after a hard timeout.
  const ready = new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const origInfo = window.console.info ? window.console.info.bind(window.console) : () => {};
    window.console.info = (...args) => {
      origInfo(...args);
      // Match the render-complete line specifically (not the load stamp, which
      // also starts with [RMX]), so we collect cells only after painting.
      if (/line-spans highlighted/.test(String(args[0]))) setTimeout(finish, 30);
    };

    SCRIPTS.forEach((f) => window.eval(fs.readFileSync(path.join(SRC, f), 'utf8')));
    setTimeout(finish, 4000); // safety net if the log never fires
  });

  return { window, ready };
}

function renderFixture(opts) {
  const { window, ready } = buildWorld(opts);
  return ready.then(() => collectCells(window));
}

// Nudge the page so content.js's MutationObserver fires an additive re-paint
// (the scroll path), then resolve after its 250ms debounce settles. This is how
// a test exercises re-painting over a DOM that changed since the first paint.
function triggerRepaint(window, waitMs = 600) {
  window.document.body.appendChild(window.document.createElement('span'));
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

// Read every highlighted cell into a flat record the report/linter consume.
function collectCells(window) {
  const cells = [];
  window.document.querySelectorAll('.rmx-hl').forEach((el) => {
    const m = /^diff-[0-9a-f]{64}([LR])(\d+)$/.exec(el.id) || [];
    cells.push({
      side: el.getAttribute('data-rmx-side') || m[1] || '',
      line: Number(m[2] || 0),
      file: el.getAttribute('data-rmx-file') || '',
      category: el.getAttribute('data-rmx-cat') || '',
      indices: (el.getAttribute('data-rmx-index') || '').split(' ').filter(Boolean),
      desc: el.getAttribute('data-rmx-desc') || '',
      text: (el.textContent || ''),
    });
  });
  return cells;
}

module.exports = { renderFixture, buildWorld, triggerRepaint, collectCells, readTree, sha256Hex };
