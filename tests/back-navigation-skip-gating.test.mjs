// tests/back-navigation-skip-gating.test.mjs
//
// Independent-audit findings (2026-09-06), medium, both confirmed with a
// probe against the real STEPS skip predicates before this fix:
//
// 1. Back navigation never re-checked skip() the way forward navigation
//    (advance()'s while loop) does -- going Back from a later step could
//    land directly on a step meant to be skipped for the current intake
//    (e.g. a surviving-family respondent landing on "era").
// 2. Re-answering an earlier gating question (service_status, va_history)
//    never cleared fields belonging to steps that are now skipped. A
//    veteran who answers discharge/branch/component/era, then goes Back
//    and changes service_status to "surviving_family", kept all four
//    stale values in `intake` -- a self-contradictory submitted profile.
//    Normal use ("wait, I need to redo this for my father"), not an
//    attack.
//
// This extracts stepBackIndex/clearFieldsForNowSkippedSteps from
// tool/index.html's own source and tests them as pure functions against
// a trimmed set of real skip predicates copied verbatim from STEPS (not
// reimplemented) -- no DOM/jsdom needed since both functions only touch
// (steps, intake), not the page.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '..', 'tool', 'index.html'), 'utf8');

const start = src.indexOf('function stepBackIndex');
const end = src.indexOf('async function advance()');
if (start === -1 || end === -1) {
  throw new Error('Could not locate stepBackIndex/clearFieldsForNowSkippedSteps in tool/index.html -- did it move or get renamed?');
}
const moduleSrc = `${src.slice(start, end)}\nexport { stepBackIndex, clearFieldsForNowSkippedSteps };\n`;
const moduleUrl = `data:text/javascript,${encodeURIComponent(moduleSrc)}`;
const { stepBackIndex, clearFieldsForNowSkippedSteps } = await import(moduleUrl);

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

// Real skip predicates, copied verbatim from tool/index.html's STEPS array
// (id order matches the real questionnaire: service_status, discharge,
// branch, component, era, ...).
const STEPS = [
  { id: 'service_status' },
  { id: 'discharge', skip: (i) => ['surviving_family', 'caregiver', 'active_duty'].includes(i.service_status) },
  { id: 'branch', skip: (i) => ['surviving_family', 'caregiver'].includes(i.service_status) },
  { id: 'component', skip: (i) => ['surviving_family', 'caregiver'].includes(i.service_status) },
  { id: 'era', skip: (i) => ['surviving_family', 'caregiver'].includes(i.service_status) },
  { id: 'need' },
];

// --- stepBackIndex ---------------------------------------------------------

{
  // A veteran (not surviving_family) at "need" (index 5) clicking Back
  // must land on "era" (index 4) -- nothing skipped.
  const intake = { service_status: 'veteran' };
  check('ordinary veteran: back from need lands on era', stepBackIndex(STEPS, 5, intake), 4);
}

{
  // A surviving_family respondent at "need" (index 5) clicking Back must
  // skip past era/component/branch (all skipped for surviving_family) and
  // land on discharge (also skipped) then service_status (index 0) --
  // never stopping on a step whose own skip() is true.
  const intake = { service_status: 'surviving_family' };
  const result = stepBackIndex(STEPS, 5, intake);
  check('surviving_family: back from need does not land on a skipped step', STEPS[result].skip ? STEPS[result].skip(intake) : false, false);
  check('surviving_family: back from need lands on service_status', result, 0);
}

{
  // Must never go below index 0.
  const intake = { service_status: 'surviving_family' };
  check('back from service_status itself stays at 0, does not go negative', stepBackIndex(STEPS, 1, intake), 0);
}

// --- clearFieldsForNowSkippedSteps ------------------------------------------

{
  // The exact scenario: a veteran answers discharge/branch/component/era,
  // then re-answers service_status to surviving_family (a value that skips
  // all four). Those four stale fields must be cleared.
  const intake = {
    service_status: 'surviving_family',
    discharge: 'honorable',
    branch: ['army'],
    component: ['enlisted'],
    era: ['post_911'],
  };
  clearFieldsForNowSkippedSteps(STEPS, intake);
  check('stale discharge cleared', 'discharge' in intake, false);
  check('stale branch cleared', 'branch' in intake, false);
  check('stale component cleared', 'component' in intake, false);
  check('stale era cleared', 'era' in intake, false);
  check('service_status itself is untouched', intake.service_status, 'surviving_family');
}

{
  // No regression: an ordinary veteran's answers must survive untouched.
  const intake = {
    service_status: 'veteran',
    discharge: 'honorable',
    branch: ['army'],
    component: ['enlisted'],
    era: ['post_911'],
  };
  clearFieldsForNowSkippedSteps(STEPS, intake);
  check('ordinary veteran: discharge survives', intake.discharge, 'honorable');
  check('ordinary veteran: branch survives', intake.branch, ['army']);
  check('ordinary veteran: component survives', intake.component, ['enlisted']);
  check('ordinary veteran: era survives', intake.era, ['post_911']);
}

{
  // Fields never answered in the first place must not error (no `in`
  // check assumed present).
  const intake = { service_status: 'surviving_family' };
  clearFieldsForNowSkippedSteps(STEPS, intake);
  check('no error / no-op when nothing was answered yet', intake, { service_status: 'surviving_family' });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll back-navigation skip-gating checks passed.');
