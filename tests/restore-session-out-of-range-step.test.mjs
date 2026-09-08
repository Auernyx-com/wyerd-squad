// tests/restore-session-out-of-range-step.test.mjs
//
// Independent-audit finding (2026-09-08, round 13, medium): restoreSession()
// never validated session.currentStep against whichever steps array it just
// picked (activeSteps). A saved currentStep past the end of that array --
// a legacy session with no recorded mode restored against the wrong array,
// a hand-edited/corrupted imported profile, or simply a future deploy that
// shortens STEPS/GUIDED_STEPS -- crashed renderStep() outright:
// steps[currentStep] is undefined, and the very next line reads .question
// off it.
//
// Confirmed directly before this fix: restoreSession({ mode: 'guided',
// currentStep: 999, intake: {...} }) threw "Cannot read properties of
// undefined (reading 'question')" when renderStep() ran, leaving the
// veteran on a blank, broken screen with no way forward -- exactly the kind
// of corrupted/legacy state this function already defends against for a
// missing `mode` (see tests/guided-mode-resume-active-steps.test.mjs).
//
// Fixed by clamping currentStep to a valid index for whichever steps array
// restoreSession resolves, instead of trusting the saved value verbatim.
//
// Same fake-DOM harness as guided-mode-resume-active-steps.test.mjs --
// evaluates the real, unmodified restoreSession()/renderStep(), not a
// reimplementation.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, '..', 'tool', 'index.html'), 'utf8');

const scriptStartTag = html.indexOf('<script>');
const scriptStart = html.indexOf('>', scriptStartTag) + 1;
const scriptEnd = html.lastIndexOf('</script>');
const scriptBody = html.slice(scriptStart, scriptEnd);

function makeFakeElement(id) {
  const el = {
    id,
    className: '',
    style: {},
    children: [],
    disabled: false,
    value: '',
    classList: {
      _set: new Set(['hidden']),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c, force) {
        if (force === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); }
        else if (force) this._set.add(c); else this._set.delete(c);
      },
    },
    appendChild(child) { el.children.push(child); return child; },
    removeChild(child) { el.children = el.children.filter(c => c !== child); },
    remove() {},
    scrollIntoView() {},
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    focus() {},
  };
  let _html = '';
  let _text = '';
  Object.defineProperty(el, 'innerHTML', { get: () => _html, set: (v) => { _html = v; } });
  Object.defineProperty(el, 'textContent', { get: () => _text, set: (v) => { _text = v; } });
  return el;
}

function makeFakeDocument() {
  const elements = new Map();
  return {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeFakeElement(id));
      return elements.get(id);
    },
    createElement(tag) { return makeFakeElement(`<${tag}>`); },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
}

function loadPageModule() {
  const fakeDocument = makeFakeDocument();
  const fakeLocalStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const fn = new Function(
    'document', 'localStorage', 'crypto',
    `${scriptBody}
return {
  restoreSession, GUIDED_STEPS, STEPS,
  get currentStep() { return currentStep; },
};`
  );
  return fn(fakeDocument, fakeLocalStorage, globalThis.crypto);
}

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}
function checkNoThrow(description, fn) {
  try {
    fn();
    console.log(`ok   - ${description}`);
  } catch (e) {
    failures++;
    console.log(`FAIL - ${description} (threw: ${e.message})`);
  }
}

{
  const page = loadPageModule();
  checkNoThrow(
    'a wildly out-of-range saved currentStep does not crash restoreSession/renderStep',
    () => page.restoreSession({ mode: 'guided', currentStep: 999, intake: { need: ['housing'] } })
  );
  check('out-of-range currentStep is clamped to the last valid index', page.currentStep, page.GUIDED_STEPS.length - 1);
}

{
  const page = loadPageModule();
  checkNoThrow(
    'a negative saved currentStep does not crash restoreSession/renderStep',
    () => page.restoreSession({ mode: 'guided', currentStep: -5, intake: {} })
  );
  check('negative currentStep is clamped to 0', page.currentStep, 0);
}

{
  const page = loadPageModule();
  checkNoThrow(
    'a non-numeric saved currentStep does not crash restoreSession/renderStep',
    () => page.restoreSession({ mode: 'guided', currentStep: 'not-a-number', intake: {} })
  );
  check('non-numeric currentStep falls back to 0', page.currentStep, 0);
}

{
  // Regression guard: a legitimate, in-range saved step must resume exactly
  // where the veteran left off, unaffected by the new clamp.
  const page = loadPageModule();
  page.restoreSession({ mode: 'guided', currentStep: 3, intake: {} });
  check('a legitimate in-range currentStep is preserved exactly', page.currentStep, 3);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll restore-session out-of-range-step checks passed.');
