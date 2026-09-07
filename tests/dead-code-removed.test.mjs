// tests/dead-code-removed.test.mjs
//
// Independent-audit findings (2026-09-07, round 5, low), both re-verified
// directly against the current code (not trusting a prior round's note):
//
// 1. showResults(text, isRestore = false) -- isRestore has exactly one
//    call site in the whole file (showResults(data.response), never
//    passing a second argument) and is referenced zero times inside the
//    function body. Pure dead signature cruft that misleads a reader into
//    thinking a restore-vs-fresh code path exists. Removed.
//
// 2. buildIntakeSummary() referenced 5 fields (is_chronically_homeless,
//    active_criminal_case, criminal_case_type, claiming_self_defense,
//    va_facility_obstruction) that no STEPS or GUIDED_STEPS question ever
//    writes into `intake` -- confirmed via grep, each appears exactly once
//    in the whole file (its own usage site here). Since `intake` is
//    entirely client-constructed from the step arrays (never merged with
//    backend response data), these branches could never render under any
//    current input. Removed as dead code that could mislead a future
//    maintainer into thinking this data is being collected.
//
// This is a static-source check: confirms the removed identifiers are
// genuinely gone (not just moved) and that showResults' single real call
// site and buildIntakeSummary's still-real branches are untouched.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '..', 'tool', 'index.html'), 'utf8');

let failures = 0;
function check(description, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

check('showResults no longer declares an isRestore parameter', /function showResults\(text, isRestore/.test(src), false);
check('showResults is still declared with just (text)', /function showResults\(text\)/.test(src), true);

for (const deadField of [
  'is_chronically_homeless', 'active_criminal_case', 'criminal_case_type',
  'claiming_self_defense', 'va_facility_obstruction',
]) {
  check(`dead field "${deadField}" no longer appears anywhere in the file`, src.includes(deadField), false);
}

// Still-real fields buildIntakeSummary uses must be untouched.
for (const realField of ['va_facility_issues', 'housing_status', 'disability_rating']) {
  check(`real field "${realField}" is still present`, src.includes(realField), true);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll dead-code-removed checks passed.');
