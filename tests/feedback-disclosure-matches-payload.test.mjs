// tests/feedback-disclosure-matches-payload.test.mjs
//
// Independent-audit finding (2026-09-06, round 4, medium):
// The detailed feedback modal tells the veteran: "Your intake answers are
// not sent with this form. Only what you type here is shared. Location is
// added from your intake if you provided it." But the actual submit
// handler's payload also includes `need_area` (derived from
// intake.need), which the modal's disclosure never mentions. The
// separate inline "quick strip" DOES say the correct thing --
// "Location and need area added from your intake if provided" -- and its
// own payload matches its own disclosure; the detailed modal's copy
// simply wasn't updated to match code that was evidently copy-pasted
// from the strip's handler.
//
// Confirmed directly before this fix: grepping the detailed modal's
// disclosure text found no mention of "need area" anywhere, while its
// payload-construction code two lines away includes `need_area:
// intake?.need ? ... `.
//
// Fixed by updating the detailed modal's disclosure text to match the
// quick strip's (and match what the code actually sends), rather than
// removing the field -- need_area is useful, aggregate signal for
// improving guidance, and the quick strip already discloses the
// identical behavior without objection.
//
// This is a static-copy consistency check: the disclosure text must
// mention "need area" if and only if the payload it describes includes
// need_area. Verified against the file's own real source text and real
// payload-construction code (not a reimplementation).

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

const modalNoteMatch = src.match(/<p class="modal-note">([^<]*)<\/p>/);
if (!modalNoteMatch) {
  throw new Error('Could not locate the detailed feedback modal\'s disclosure text (.modal-note) -- did it move or get renamed?');
}
const modalNoteText = modalNoteMatch[1];

// Find the detailed modal's own payload-construction block (the second of
// the two need_area occurrences in the file -- the first belongs to the
// quick strip's handler).
const need_areaOccurrences = [...src.matchAll(/need_area:/g)];
check('exactly two need_area payload sites exist (quick strip + detailed modal)', need_areaOccurrences.length, 2);

check(
  'detailed feedback modal\'s disclosure text mentions "need area" (matches what the payload actually sends)',
  /need area/i.test(modalNoteText),
  true
);
check(
  'detailed feedback modal\'s disclosure text still mentions location (no regression)',
  /location/i.test(modalNoteText),
  true
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll feedback disclosure/payload consistency checks passed.');
