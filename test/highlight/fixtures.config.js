// Per-language fixtures, captured from the rm-action-test repo. Each language is
// a real PR: the feed RefactoringMiner published (on the repo's gh-pages branch)
// plus the before/after source trees the diff was computed from. `before` feeds
// the left (L) diff cells, `after` feeds the right (R) cells — exactly what the
// extension overlays in GitHub's split diff.
//
// Regenerate the snapshots with `npm run fixtures:capture` (capture-fixtures.js),
// which reads these refs out of the test repo via git. Mapping verified by
// matching each feed's line references to the branch contents.
module.exports = [
  { lang: 'java', feedPr: 9, beforeRef: 'before', afterRef: 'after' },
  { lang: 'kotlin', feedPr: 12, beforeRef: 'kotlin-1', afterRef: 'kotlin-2' },
  { lang: 'typescript', feedPr: 13, beforeRef: 'typescript-1', afterRef: 'typescript-2' },
  { lang: 'python', feedPr: 14, beforeRef: 'python-1', afterRef: 'python-2' },
];
