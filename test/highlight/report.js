// Turns the raw painted cells into a stable, human-readable record of what the
// overlay highlighted, per refactoring, on each side. The JSON form is the
// golden snapshot (diff it to see highlighting change between runs); the
// markdown form is the at-a-glance "does this make sense?" document.

// Group painted cells under every refactoring index they belong to (a cell hit
// by N refactorings appears under all N). Returns one entry per feed refactoring
// so even fully-unpainted ones are visible.
function buildReport(lang, feed, cells) {
  const refactorings = (feed.refactorings || []).map((r, index) => {
    const mine = cells.filter((c) => c.indices.indexOf(String(index)) !== -1);
    return {
      index,
      type: r.type,
      left: sideRows(mine, 'L'),
      right: sideRows(mine, 'R'),
    };
  });
  return {
    lang,
    feedUrl: feed.url || '',
    counts: {
      refactorings: refactorings.length,
      paintedCells: cells.length,
      paintedRefactorings: refactorings.filter((r) => r.left.length || r.right.length).length,
    },
    refactorings,
  };
}

function sideRows(cells, side) {
  return cells
    .filter((c) => c.side === side)
    .map((c) => ({ file: c.file, line: c.line, category: c.category, text: c.text.trim() }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function toMarkdown(report) {
  const L = [`# Highlight report — ${report.lang}`, '', `Feed: ${report.feedUrl}`, ''];
  const c = report.counts;
  L.push(`${c.refactorings} refactorings · ${c.paintedRefactorings} painted · ${c.paintedCells} cells`, '');
  report.refactorings.forEach((r) => {
    L.push(`## [${r.index}] ${r.type}`, '');
    L.push('| side | file | line | category | code |', '|---|---|---|---|---|');
    const row = (s, x) => `| ${s} | ${x.file} | ${x.line} | ${x.category} | \`${x.text.replace(/\|/g, '\\|')}\` |`;
    r.left.forEach((x) => L.push(row('L', x)));
    r.right.forEach((x) => L.push(row('R', x)));
    if (!r.left.length && !r.right.length) L.push('| — | _(nothing highlighted)_ | | | |');
    L.push('');
  });
  return L.join('\n');
}

module.exports = { buildReport, toMarkdown };
