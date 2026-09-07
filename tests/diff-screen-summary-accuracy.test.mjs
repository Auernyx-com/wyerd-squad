// tests/diff-screen-summary-accuracy.test.mjs
//
// Independent-audit findings (2026-09-06, round 4), both in
// buildIntakeSummary()/_DIFF_LABELS -- the "here's what we have on file,
// has anything changed?" screen shown to every returning veteran:
//
// 1. (High) `if (data.va_facility_obstruction || data.va_facility_issues)`
//    is a truthiness test, not a value test. va_facility_issues is a
//    single-select field whose "no problem" answer is the JS string 'no'
//    -- truthy. A veteran who explicitly answered "No issues with the
//    facility" was shown "VA facility: Issues / complaints on file" on
//    the one screen whose entire purpose is confirming their own record
//    is accurate.
//
// 2. (Medium) _DIFF_LABELS is stale against STEPS' real option values --
//    written against an older/different value vocabulary. _diffLabel()
//    falls back to the raw stored value when a map entry is missing, so
//    real current values like 'marines', 'general_uhc', 'activated', and
//    'unsheltered' render as raw internal slugs instead of plain-language
//    labels, disproportionately affecting veterans in an active housing
//    crisis (unsheltered/car/shelter/couch).
//
// Confirmed with direct probes before this fix: data.va_facility_issues
// = 'no' produced the false-positive "Issues / complaints on file" row;
// buildIntakeSummary() against a record using real STEPS values
// (branch: ['marines'], discharge: 'general_uhc', service_status:
// 'activated', housing_status: 'unsheltered') rendered all four as raw
// slugs, not plain-language labels.
//
// This extracts _DIFF_LABELS/_diffLabel/buildIntakeSummary from
// tool/index.html's own source and calls the real, unmodified function --
// no DOM needed, buildIntakeSummary is a pure (data) -> rows function.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '..', 'tool', 'index.html'), 'utf8');

const start = src.indexOf('const _DIFF_LABELS');
const end = src.indexOf('function showDiffScreen');
if (start === -1 || end === -1) {
  throw new Error('Could not locate _DIFF_LABELS/buildIntakeSummary in tool/index.html -- did it move or get renamed?');
}
const moduleSrc = `${src.slice(start, end)}\nexport { buildIntakeSummary, _DIFF_LABELS };\n`;
const moduleUrl = `data:text/javascript,${encodeURIComponent(moduleSrc)}`;
const { buildIntakeSummary, _DIFF_LABELS } = await import(moduleUrl);

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

function rowFor(rows, label) {
  const row = rows.find(r => r[0] === label);
  return row ? row[1] : undefined;
}

// --- Finding 1: 'no' must not read as "issues on file" -------------------
{
  const rows = buildIntakeSummary({ va_facility_issues: 'no' });
  check('va_facility_issues="no" does NOT produce a "VA facility" row', rowFor(rows, 'VA facility'), undefined);
}
{
  const rows = buildIntakeSummary({ va_facility_issues: 'obstruction' });
  check('va_facility_issues="obstruction" DOES produce a "VA facility" row', rowFor(rows, 'VA facility'), 'Issues / complaints on file');
}
{
  const rows = buildIntakeSummary({ va_facility_issues: 'complaints' });
  check('va_facility_issues="complaints" DOES produce a "VA facility" row', rowFor(rows, 'VA facility'), 'Issues / complaints on file');
}
// Independent-audit finding (2026-09-07, round 5, low): the
// va_facility_obstruction field this test previously exercised was
// confirmed dead code -- no STEPS or GUIDED_STEPS question ever writes it
// into `intake` (grepped the whole file). It was removed from
// buildIntakeSummary() as part of that fix; this "no regression" case no
// longer applies to a field that can never actually be set.

// --- Finding 2: _DIFF_LABELS must resolve real, current STEPS values ------
{
  const rows = buildIntakeSummary({
    branch: ['marines'],
    discharge: 'general_uhc',
    service_status: 'activated',
    housing_status: 'unsheltered',
  });
  check('branch "marines" resolves to a plain-language label, not the raw slug', rowFor(rows, 'Branch'), 'Marine Corps');
  check('discharge "general_uhc" resolves to a plain-language label', rowFor(rows, 'Discharge'), 'General — Under Honorable Conditions');
  check('service_status "activated" resolves to a plain-language label', rowFor(rows, 'Status'), 'Reserve/Guard — currently activated');
  check('housing_status "unsheltered" resolves to a plain-language label', rowFor(rows, 'Housing'), 'Currently unhoused');
}
{
  // branch is multi-select; two selections used to coerce to the object key
  // "army,navy" (no match in any map), falling through to the raw array.
  const rows = buildIntakeSummary({ branch: ['army', 'navy'] });
  check('multi-select branch resolves every element, not just a lone one', rowFor(rows, 'Branch'), 'Army, Navy');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll diff-screen summary accuracy checks passed.');
