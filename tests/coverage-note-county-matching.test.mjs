// tests/coverage-note-county-matching.test.mjs
//
// Independent-audit finding (2026-09-06, round 3, high): getCoverageNote()
// matched a veteran-typed county against the verified-coverage list with
// `county.includes(c)` -- a substring containment check, not an exact
// match. "Rio Grande" (a real, distinct Colorado county in the San Luis
// Valley, genuinely NOT part of the Western Slope region and with no
// confirmed local data) contains the Western Slope region's "grand" entry
// (meant to match Grand County) as a literal substring. The coverage-gap
// disclosure banner was suppressed entirely for a genuinely uncovered
// county -- the opposite of the intended behavior.
//
// Confirmed directly before fixing: getCoverageNote({state:"CO",
// county:"Rio Grande"}) returned null ("fully covered"), same as a
// genuinely-covered county like "Grand" or "Mesa".
//
// Fixed by normalizing a trailing "county"/"co."/"co" suffix (same
// normalization pattern SQUAD's own MODULES/_shared/local_resources.py
// already uses for county matching) and then requiring an EXACT match
// against the list, not substring containment -- "mesa county" still
// correctly matches "mesa" after suffix-stripping, but "rio grande"
// no longer spuriously matches "grand".

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '..', 'tool', 'index.html'), 'utf8');

const start = src.indexOf('const _COVERAGE_REGIONS');
const end = src.indexOf('function showResults');
if (start === -1 || end === -1) {
  throw new Error('Could not locate _COVERAGE_REGIONS/getCoverageNote in tool/index.html -- did it move or get renamed?');
}
const moduleSrc = `${src.slice(start, end)}\nexport { getCoverageNote };\n`;
const moduleUrl = `data:text/javascript,${encodeURIComponent(moduleSrc)}`;
const { getCoverageNote } = await import(moduleUrl);

let failures = 0;
function check(description, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

function isFullyCovered(state, county) {
  return getCoverageNote({ state, county }) === null;
}

// The exact regression: Rio Grande must NOT be treated as covered.
check('Rio Grande, CO (real, uncovered county) is NOT treated as covered', isFullyCovered('CO', 'Rio Grande'), false);
check('a made-up county containing "el paso" as a substring is NOT covered', isFullyCovered('CO', 'El Pasoville'), false);

// Genuinely covered counties must still be recognized, including with a
// "County" suffix a veteran might plausibly type.
check('Grand, CO (real Western Slope county) is still covered', isFullyCovered('CO', 'Grand'), true);
check('Mesa, CO is still covered', isFullyCovered('CO', 'Mesa'), true);
check('"Mesa County" (with suffix) is still covered', isFullyCovered('CO', 'Mesa County'), true);
check('"mesa co" (abbreviated suffix) is still covered', isFullyCovered('CO', 'mesa co'), true);
check('El Paso, CO (real Front Range county) is still covered', isFullyCovered('CO', 'El Paso'), true);

// Uncovered state/county combinations still correctly show the gap note.
check('an uncovered state shows a gap note, not null', getCoverageNote({ state: 'WY', county: 'Laramie' }) !== null, true);
check('no location at all shows the national-only note', getCoverageNote({}) !== null, true);

// Independent-audit finding (2026-09-08, round 6, medium):
// _normalizeCountyForCoverageMatch() only trims leading/trailing
// whitespace -- it never collapsed repeated/irregular internal
// whitespace within a multi-word county name. A veteran who fat-fingers
// an extra space in a real, confirmed-covered multi-word county (San
// Miguel, Rio Blanco -- both genuinely covered Western Slope counties)
// was shown the "not yet confirmed" coverage-gap disclaimer instead of
// clean, confirmed guidance -- same failure class as the Rio Grande fix
// above, opposite direction (false negative, not false positive).
// Confirmed directly before this fix: isFullyCovered('CO', 'San Miguel')
// was true, isFullyCovered('CO', 'San  Miguel') (double internal space)
// was false.
check('San Miguel, CO (single space) is covered', isFullyCovered('CO', 'San Miguel'), true);
check('San  Miguel, CO (double internal space) is STILL covered', isFullyCovered('CO', 'San  Miguel'), true);
check('Rio Blanco, CO (single space) is covered', isFullyCovered('CO', 'Rio Blanco'), true);
check('Rio   Blanco, CO (triple internal space) is STILL covered', isFullyCovered('CO', 'Rio   Blanco'), true);
check('a tab character between words is STILL covered', isFullyCovered('CO', 'San\tMiguel'), true);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll coverage-note county-matching checks passed.');
