// End-to-end highlight test, one case per language fixture. For each it renders
// the real overlay over a reconstructed GitHub diff (harness.js), records what
// lit up (report.js), and flags suspicious highlighting (lint.js). Two ways the
// build fails:
//
//   • any `error`-level finding (e.g. a blank line painted) — always a bug;
//   • the report or findings drift from the committed golden — so *any* change
//     in highlighting, on any language, shows up as a reviewable golden diff.
//
// Run `UPDATE=1 node test/highlight/highlight.test.js` to (re)write the goldens
// after an intentional change; review that diff to see exactly what moved. The
// goldens double as living documentation of current per-language behaviour and
// of the known glitches the linter has catalogued.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const FIXTURES = require('./fixtures.config');
const { renderFixture, readTree } = require('./harness');
const { buildReport, toMarkdown } = require('./report');
const { lint, summarize } = require('./lint');

const FIXDIR = path.join(__dirname, 'fixtures');
const GOLDDIR = path.join(__dirname, 'golden');
const UPDATE = process.env.UPDATE === '1';

// Lines available per (side, file) — lets the linter spot ranges past EOF.
function lineCounts(tree, side) {
  const out = {};
  Object.keys(tree).forEach((rel) => {
    const lines = tree[rel].split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    out[`${side} ${rel}`] = lines.length;
  });
  return out;
}

function readGolden(name) {
  const p = path.join(GOLDDIR, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function writeGolden(name, content) {
  fs.mkdirSync(GOLDDIR, { recursive: true });
  fs.writeFileSync(path.join(GOLDDIR, name), content);
}

async function runCase({ lang }) {
  const dir = path.join(FIXDIR, lang);
  const feed = JSON.parse(fs.readFileSync(path.join(dir, 'feed.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const beforeDir = path.join(dir, 'before');
  const afterDir = path.join(dir, 'after');

  const cells = await renderFixture({ feed, meta, beforeDir, afterDir });
  const report = buildReport(lang, feed, cells);
  const counts = { ...lineCounts(readTree(beforeDir), 'L'), ...lineCounts(readTree(afterDir), 'R') };
  const findings = lint(report, cells, counts, feed);

  const reportJson = JSON.stringify(report, null, 2);
  const findingsJson = JSON.stringify(findings, null, 2);
  const md = toMarkdown(report);

  const errors = findings.filter((f) => f.level === 'error');

  if (UPDATE) {
    writeGolden(`${lang}.report.json`, reportJson);
    writeGolden(`${lang}.findings.json`, findingsJson);
    writeGolden(`${lang}.report.md`, md);
  }

  return { lang, reportJson, findingsJson, errors, summary: summarize(findings) };
}

async function main() {
  let failures = 0;
  for (const fx of FIXTURES) {
    const r = await runCase(fx);
    const counts = `errors=${r.summary.error || 0} warns=${r.summary.warn || 0}`;

    // Hard rule: error-level findings are bugs regardless of the golden.
    if (r.errors.length) {
      failures++;
      console.error(`✗ ${r.lang}: ${r.errors.length} error finding(s)`);
      r.errors.forEach((f) => console.error(`    [${f.code}] #${f.refIndex} ${f.message}`));
    }

    if (UPDATE) {
      console.log(`↻ ${r.lang}: goldens written (${counts})`);
      continue;
    }

    // Golden comparison: any drift in what's highlighted or what's flagged fails.
    const goldReport = readGolden(`${r.lang}.report.json`);
    const goldFindings = readGolden(`${r.lang}.findings.json`);
    if (goldReport === null || goldFindings === null) {
      failures++;
      console.error(`✗ ${r.lang}: no golden — run UPDATE=1 to create it`);
      continue;
    }
    try {
      assert.strictEqual(r.reportJson, goldReport, `${r.lang} report drifted from golden`);
      assert.strictEqual(r.findingsJson, goldFindings, `${r.lang} findings drifted from golden`);
      if (!r.errors.length) console.log(`✓ ${r.lang}: matches golden (${counts})`);
    } catch (e) {
      failures++;
      console.error(`✗ ${e.message} — review diff or run UPDATE=1 if intended`);
    }
  }

  if (failures) {
    console.error(`\nhighlight.test.js: ${failures} case(s) failed`);
    process.exit(1);
  }
  console.log(`\nhighlight.test.js: all ${FIXTURES.length} language cases passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
