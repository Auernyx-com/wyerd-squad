// tests/stale-urgency-crisis-deselect.test.mjs
//
// Independent-audit finding (2026-09-08, round 6, medium):
// applyGuidedSituation() unconditionally REBUILDS intake.need from
// scratch every time the guided_situation step is left, but only
// CONDITIONALLY sets intake.urgency = 'tonight' when 'crisis' is
// present -- it never cleared it when crisis was later deselected.
// urgency has no `skip` predicate (it's always asked, at the end of the
// wizard), so clearFieldsForNowSkippedSteps() can't reach it either.
//
// Confirmed directly before this fix: select ['housing','crisis'] ->
// intake.urgency = 'tonight' (correct). Go back and deselect crisis
// (keep only ['housing']) -> intake.urgency is STILL 'tonight'. A
// veteran who is not in crisis (they explicitly said so) could have
// urgency: 'tonight' submitted to the backend -- real risk of being
// routed to crisis-tier messaging instead of what they actually need.
//
// Fixed by having applyGuidedSituation() own intake.urgency
// deterministically based on the CURRENT crisis selection: set to
// 'tonight' when crisis is selected, cleared when it's not -- but only
// clearing a value THIS function is responsible for (tracked via a
// dedicated flag, reset whenever the veteran directly/manually answers
// the real urgency question), so a genuine manual "tonight" answer to
// the real urgency question is never silently wiped out by an unrelated
// guided_situation re-submission.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '..', 'tool', 'index.html'), 'utf8');

const start = src.indexOf('function applyGuidedSituation');
const end = src.indexOf('// ── Vault flow');
if (start === -1 || end === -1) {
  throw new Error('Could not locate applyGuidedSituation in tool/index.html -- did it move or get renamed?');
}
const moduleBody = src.slice(start, end);

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

let _nonce = 0;
async function freshModule() {
  // data: URLs are cached by content -- a unique per-call comment forces a
  // genuinely fresh module instance each time (fresh module-level state),
  // not a reused one from an earlier call with identical source text.
  const moduleSrc = `// nonce:${_nonce++}\nlet intake = {};\nlet urgencyAutoSetByGuidedCrisis = false;\n${moduleBody}\nexport { applyGuidedSituation, intake };\n`;
  const url = `data:text/javascript,${encodeURIComponent(moduleSrc)}`;
  return import(url);
}

{
  const { applyGuidedSituation, intake } = await freshModule();
  applyGuidedSituation(['housing', 'crisis']);
  check('crisis selected: urgency auto-set to tonight', intake.urgency, 'tonight');
  applyGuidedSituation(['housing']); // deselect crisis
  check('crisis deselected: urgency is cleared, not stale "tonight"', intake.urgency, undefined);
}

{
  // Regression guard: re-selecting crisis after deselecting still works.
  const { applyGuidedSituation, intake } = await freshModule();
  applyGuidedSituation(['crisis']);
  applyGuidedSituation([]);
  applyGuidedSituation(['legal', 'crisis']);
  check('re-selecting crisis after deselecting still sets tonight', intake.urgency, 'tonight');
}

{
  // Never selected crisis at all -- urgency must never be touched.
  const { applyGuidedSituation, intake } = await freshModule();
  applyGuidedSituation(['housing']);
  check('crisis never selected: urgency stays unset', intake.urgency, undefined);
}

{
  // A genuine manual answer to the real urgency question must survive a
  // LATER, unrelated re-submission of guided_situation with crisis not
  // selected (simulates the single-select click handler's
  // urgencyAutoSetByGuidedCrisis = false side effect).
  const { applyGuidedSituation, intake } = await freshModule();
  applyGuidedSituation(['housing']); // no crisis
  intake.urgency = 'tonight'; // veteran manually answers the real question "tonight"
  applyGuidedSituation(['housing']); // goes back, re-submits guided_situation, still no crisis
  check('a genuine manual "tonight" answer is not silently wiped by an unrelated re-submission', intake.urgency, 'tonight');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll stale-urgency crisis-deselect checks passed.');
