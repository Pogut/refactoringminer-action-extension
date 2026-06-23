// The glitch linter: it turns "the highlighting looks off" into named, located
// findings, so you can track *where* a glitch comes from per language instead of
// eyeballing each run. It reads the structured report, the raw cells, and the
// fixture's per-side line counts (to catch ranges that point past EOF).
//
// Severity: `error` = almost certainly a rendering bug; `warn` = suspicious,
// worth a human glance. The test fails on `error` and on any *new* `warn`.

// Categories the palette intends for a given side. moved/updated are neutral
// (they legitimately appear on both), so they're never a mismatch.
const LEFT_CATS = ['deleted', 'movedOut'];
const RIGHT_CATS = ['inserted', 'movedIn'];

function lint(report, cells, sideLineCounts, feed) {
  const findings = [];
  const add = (level, code, refIndex, message) => findings.push({ level, code, refIndex, message });

  // 1. A painted cell whose source line is blank. lineHasCode() is supposed to
  //    skip these; if one slips through, the overshoot trimming has a hole.
  cells.forEach((c) => {
    if (c.text.trim() === '') {
      add('error', 'blank-line-highlight', c.indices.map(Number)[0] ?? -1,
        `blank line painted at ${c.file} ${c.side}${c.line}`);
    }
    // 2. Category that contradicts its side (e.g. an "inserted" on the left).
    if (c.side === 'L' && RIGHT_CATS.indexOf(c.category) !== -1) {
      add('warn', 'category-side-mismatch', c.indices.map(Number)[0] ?? -1,
        `right-only category "${c.category}" on left at ${c.file} L${c.line}`);
    }
    if (c.side === 'R' && LEFT_CATS.indexOf(c.category) !== -1) {
      add('warn', 'category-side-mismatch', c.indices.map(Number)[0] ?? -1,
        `left-only category "${c.category}" on right at ${c.file} R${c.line}`);
    }
  });

  report.refactorings.forEach((r) => {
    const src = (feed.refactorings || [])[r.index] || {};
    const hasLeftLoc = (src.leftSideLocations || []).length > 0;
    const hasRightLoc = (src.rightSideLocations || []).length > 0;

    // 3. The feed describes both sides but only one (or neither) got painted —
    //    the counterpart the user needs to compare against is missing.
    if (hasLeftLoc && hasRightLoc) {
      if (r.left.length && !r.right.length) {
        add('warn', 'one-sided', r.index, `${r.type}: left painted, right empty (counterpart lost)`);
      } else if (!r.left.length && r.right.length) {
        add('warn', 'one-sided', r.index, `${r.type}: right painted, left empty (counterpart lost)`);
      }
    }

    // 4. Nothing painted at all though the feed has locations.
    if ((hasLeftLoc || hasRightLoc) && !r.left.length && !r.right.length) {
      add('warn', 'nothing-painted', r.index, `${r.type}: has locations but no cells highlighted`);
    }

    // 5. A location whose line range runs past the file's end on that side, so
    //    part (or all) of it can never be painted.
    checkRange(src.leftSideLocations, 'L', sideLineCounts, r, add);
    checkRange(src.rightSideLocations, 'R', sideLineCounts, r, add);
  });

  findings.sort((a, b) => a.refIndex - b.refIndex || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
  return findings;
}

function checkRange(locations, side, counts, r, add) {
  (locations || []).forEach((loc) => {
    const n = counts[`${side} ${loc.filePath}`];
    if (n == null) return; // file absent on this side — different finding class (it just won't paint)
    if (loc.endLine > n) {
      add('warn', 'range-exceeds-file', r.index,
        `${r.type}: ${loc.filePath} ${side} range ${loc.startLine}-${loc.endLine} exceeds ${n} lines`);
    }
  });
}

function summarize(findings) {
  const by = {};
  findings.forEach((f) => (by[f.level] = (by[f.level] || 0) + 1));
  return by;
}

module.exports = { lint, summarize };
