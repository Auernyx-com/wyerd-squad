// tests/guided-mode-business-need.test.mjs
//
// Independent-audit finding (2026-09-06, round 3, low): direct-mode STEPS
// offers 9 need options including 'business' ("Business / Contracting...
// veteran-owned business cert, federal contracts, GSA surplus"). Guided
// mode's `guided_situation` step offered only 7 options, whose
// applyGuidedSituation() map can never produce 'business' in intake.need.
// A guided-mode veteran with a business/federal-contracting need had no
// option that mapped to it and would end up with a materially different
// (incomplete) intake.need shape than a direct-mode veteran with the
// identical real need -- the guidance they receive back would not
// address it.
//
// Confirmed directly before fixing: the union of every possible mapped
// value in applyGuidedSituation()'s map was
// {housing, medical, claims, benefits, toxic_exposure, employment, legal,
// crisis} -- 'business' was absent.
//
// Fixed by adding a guided_situation option (matching its own first-
// person phrasing style) and a corresponding applyGuidedSituation() map
// entry for 'business'.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '..', 'tool', 'index.html'), 'utf8');

const start = src.indexOf('const GUIDED_STEPS');
const end = src.indexOf('// ── Vault flow');
if (start === -1 || end === -1) {
  throw new Error('Could not locate GUIDED_STEPS/applyGuidedSituation in tool/index.html -- did it move or get renamed?');
}
const moduleSrc = `let intake = {};\nlet urgencyAutoSetByGuidedCrisis = false;\n${src.slice(start, end)}\nexport { GUIDED_STEPS, applyGuidedSituation, intake };\n`;
const moduleUrl = `data:text/javascript,${encodeURIComponent(moduleSrc)}`;
const { GUIDED_STEPS, applyGuidedSituation } = await import(moduleUrl);

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

// Re-import fresh each time so `intake` (a module-level `let`) resets
// between checks -- the data: URL is cached by content, so give each
// call its own mutable intake via a small wrapper module instead.
async function runGuidedSituation(values) {
  const wrapperSrc = `let intake = {};\nlet urgencyAutoSetByGuidedCrisis = false;\n${src.slice(start, end)}\napplyGuidedSituation(${JSON.stringify(values)});\nexport default intake;\n`;
  const wrapperUrl = `data:text/javascript,${encodeURIComponent(wrapperSrc)}`;
  const mod = await import(wrapperUrl);
  return mod.default;
}

// The guided step must offer a business/contracting option at all.
const guidedSituationStep = GUIDED_STEPS.find(s => s.id === 'guided_situation');
const optionValues = guidedSituationStep.options.map(o => o.value);
check('guided_situation offers a business-related option', optionValues.includes('business'), true);

// That option must actually map to the same 'business' need direct-mode uses.
{
  const intake = await runGuidedSituation(['business']);
  check('selecting the business option produces need=["business"]', intake.need, ['business']);
}

// Combining with another need must still work (additive, no regression).
{
  const intake = await runGuidedSituation(['business', 'legal']);
  check('business + legal both survive together', [...intake.need].sort(), ['business', 'legal']);
}

// No regression for existing guided options.
{
  const intake = await runGuidedSituation(['housing']);
  check('housing option still maps correctly (no regression)', intake.need, ['housing']);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll guided-mode business-need checks passed.');
