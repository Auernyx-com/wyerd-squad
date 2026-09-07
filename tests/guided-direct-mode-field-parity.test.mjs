// tests/guided-direct-mode-field-parity.test.mjs
//
// Independent-audit finding (2026-09-07, round 5, medium): guided and
// direct mode collected materially different data for an identical real
// situation. Confirmed by diffing the two step-id lists before this fix:
//   Only in STEPS (direct):  need, housing_status, current_programs, income
//   Only in GUIDED_STEPS:    guided_situation, va_facility_issues
// (need/guided_situation are the same question by design, different ids --
// not a gap.) The real gap: a guided-mode veteran who flagged "I don't
// have a stable place to stay" was never asked their actual housing
// situation, current program enrollment, or income; a direct-mode veteran
// was never asked about VA facility obstruction even though
// buildIntakeSummary() and the diff screen are written to display it.
//
// Fixed by adding va_facility_issues to STEPS (unconditional, matching its
// guided-mode skip condition exactly) and adding housing_status/
// current_programs/income to GUIDED_STEPS, gated on relevance to the
// guided_situation answer (housing/crisis for housing_status; money/
// service/transition for current_programs; money for income) rather than
// shown unconditionally, matching guided mode's own adaptive-flow
// character while closing the actual gap.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '..', 'tool', 'index.html'), 'utf8');

const start = src.indexOf('const STEPS');
const end = src.indexOf('// Map guided_situation selections');
if (start === -1 || end === -1) {
  throw new Error('Could not locate STEPS/GUIDED_STEPS in tool/index.html -- did it move or get renamed?');
}
const moduleSrc = `${src.slice(start, end)}\nexport { STEPS, GUIDED_STEPS };\n`;
const moduleUrl = `data:text/javascript,${encodeURIComponent(moduleSrc)}`;
const { STEPS, GUIDED_STEPS } = await import(moduleUrl);

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

const stepsIds = new Set(STEPS.map((s) => s.id));
const guidedIds = new Set(GUIDED_STEPS.map((s) => s.id));

check(
  'direct mode now asks va_facility_issues',
  stepsIds.has('va_facility_issues'),
  true
);
check(
  'guided mode now asks housing_status',
  guidedIds.has('housing_status'),
  true
);
check(
  'guided mode now asks current_programs',
  guidedIds.has('current_programs'),
  true
);
check(
  'guided mode now asks income',
  guidedIds.has('income'),
  true
);

// The only remaining asymmetry should be the by-design need/guided_situation
// id difference (same question, different id per mode) -- nothing else.
const onlyInSteps = [...stepsIds].filter((id) => !guidedIds.has(id));
const onlyInGuided = [...guidedIds].filter((id) => !stepsIds.has(id));
check('only remaining direct-only field is "need" (by design)', onlyInSteps, ['need']);
check('only remaining guided-only field is "guided_situation" (by design)', onlyInGuided, ['guided_situation']);

// Skip-condition behavior for the new guided-mode questions.
const housingStatusStep = GUIDED_STEPS.find((s) => s.id === 'housing_status');
check(
  'guided housing_status is asked when "housing" was flagged',
  housingStatusStep.skip({ guided_situation: ['housing'] }),
  false
);
check(
  'guided housing_status is asked when "crisis" was flagged',
  housingStatusStep.skip({ guided_situation: ['crisis'] }),
  false
);
check(
  'guided housing_status is skipped when neither housing nor crisis was flagged',
  housingStatusStep.skip({ guided_situation: ['legal'] }),
  true
);

const incomeStep = GUIDED_STEPS.find((s) => s.id === 'income');
check('guided income is asked when "money" was flagged', incomeStep.skip({ guided_situation: ['money'] }), false);
check('guided income is skipped otherwise', incomeStep.skip({ guided_situation: ['legal'] }), true);

const currentProgramsStep = GUIDED_STEPS.find((s) => s.id === 'current_programs');
check(
  'guided current_programs is asked when "service" was flagged',
  currentProgramsStep.skip({ guided_situation: ['service'] }),
  false
);
check(
  'guided current_programs is skipped when no relevant need was flagged',
  currentProgramsStep.skip({ guided_situation: ['legal'] }),
  true
);

// va_facility_issues in direct mode must match its guided-mode skip
// condition exactly (same underlying rule, both modes).
const directFacilityStep = STEPS.find((s) => s.id === 'va_facility_issues');
check(
  'direct-mode va_facility_issues is skipped when va_history is "never" (matches guided)',
  directFacilityStep.skip({ va_history: 'never' }),
  true
);
check(
  'direct-mode va_facility_issues is asked otherwise',
  directFacilityStep.skip({ va_history: 'receiving_comp' }),
  false
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll guided/direct mode field-parity checks passed.');
