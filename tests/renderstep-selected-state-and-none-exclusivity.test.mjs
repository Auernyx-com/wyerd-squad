// tests/renderstep-selected-state-and-none-exclusivity.test.mjs
//
// Independent-audit findings (2026-09-08, round 6):
//
// 1. (Low-Medium) Single-select steps never applied a `selected` class to
//    a previously-recorded answer, unlike multi-select (which does via
//    `cur.includes(opt.value) ? ' selected' : ''`). Confirmed directly:
//    rendering `service_status` (single) after it was already answered
//    "veteran" showed no option with the .selected class, while
//    rendering `branch` (multi) after ["army"] correctly marked "Army"
//    selected. Combined with the already-working cascading clear
//    (clearFieldsForNowSkippedSteps + advance()'s skip-walk), a veteran
//    who clicks an option just to check/confirm it -- genuinely unsure
//    whether it's already selected -- can silently overwrite an
//    already-answered gating field and cascade-wipe downstream answers
//    with no warning.
//
// 2. (Low) `current_programs` (type: multi, both modes) allowed "None of
//    the above" to be selected simultaneously with a specific program
//    (e.g. va_healthcare + none) -- no mutual-exclusivity handling
//    existed in the generic multi-toggle click handler.
//
// This uses the whole-script-evaluation + fake-DOM technique already
// established in this repo's own tests (e.g.
// tests/isreturning-reset-on-start-over.test.mjs) to drive the real,
// registered click handlers and the real renderStep() output.

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
  const listeners = {};
  const el = {
    id, className: '', style: {}, children: [], disabled: false, value: '',
    classList: {
      _set: new Set(['hidden']),
      add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); }, toggle() {},
    },
    appendChild(child) { el.children.push(child); return child; },
    removeChild(child) { el.children = el.children.filter((c) => c !== child); },
    remove() {}, scrollIntoView() {},
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    _fire(type, evt) { (listeners[type] || []).forEach((fn) => fn(evt)); },
    querySelector() { return null; }, focus() {},
  };
  let _html = '', _text = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => _html,
    set: (v) => {
      _html = v;
      // Re-derive fake .opt "buttons" from the rendered HTML, ONCE per
      // render, and cache them -- querySelectorAll('.opt') must return the
      // SAME objects every call so that renderStep()'s own
      // addEventListener() wiring (which calls querySelectorAll itself)
      // attaches listeners to the exact objects this test later fires
      // clicks on, not fresh unrelated ones.
      const re = /<button class="opt([^"]*)" data-value="([^"]*)"/g;
      const parsed = [];
      let m;
      while ((m = re.exec(_html))) {
        parsed.push({ classAttr: m[1], value: m[2] });
      }
      el._optButtons = parsed.map((b, i) => {
        const btnEl = makeFakeElement(`opt-${i}`);
        btnEl.dataset = { value: b.value };
        btnEl._isSelected = b.classAttr.includes('selected');
        return btnEl;
      });
    },
  });
  Object.defineProperty(el, 'textContent', { get: () => _text, set: (v) => { _text = v; } });
  el.querySelectorAll = (sel) => (sel === '.opt' ? (el._optButtons || []) : []);
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
  renderStep, STEPS,
  get currentStep() { return currentStep; },
  set currentStep(v) { currentStep = v; },
  get intake() { return intake; },
  set intake(v) { intake = v; },
  set activeSteps(v) { activeSteps = v; },
};`
  );
  const page = fn(fakeDocument, fakeLocalStorage, globalThis.crypto);
  return { page, getElementById: fakeDocument.getElementById.bind(fakeDocument) };
}

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

// --- Finding 1: single-select visual "already answered" state ------------
{
  const { page, getElementById } = loadPageModule();
  page.activeSteps = page.STEPS;
  page.currentStep = page.STEPS.findIndex((s) => s.id === 'service_status');
  page.intake = { service_status: 'veteran' };
  page.renderStep();

  const container = getElementById('step-container');
  const buttons = container.querySelectorAll('.opt');
  const veteranBtn = buttons.find((b) => b.dataset.value === 'veteran');
  check('the already-answered single-select option is rendered as selected', veteranBtn._isSelected, true);

  const otherBtn = buttons.find((b) => b.dataset.value !== 'veteran');
  check('an un-answered single-select option is NOT rendered as selected', otherBtn._isSelected, false);
}

// --- Finding 2: current_programs "none" mutual exclusivity ---------------
{
  const { page, getElementById } = loadPageModule();
  page.activeSteps = page.STEPS;
  page.currentStep = page.STEPS.findIndex((s) => s.id === 'current_programs');
  page.intake = {};
  page.renderStep();

  const container = getElementById('step-container');
  const buttons = container.querySelectorAll('.opt');
  const healthcareBtn = buttons.find((b) => b.dataset.value === 'va_healthcare');
  const noneBtn = buttons.find((b) => b.dataset.value === 'none');

  healthcareBtn._fire('click');
  check('selecting a specific program works', page.intake.current_programs, ['va_healthcare']);

  noneBtn._fire('click');
  check(
    'selecting "None of the above" clears any specific programs already selected',
    page.intake.current_programs,
    ['none']
  );

  healthcareBtn._fire('click');
  check(
    'selecting a specific program after "None" clears "none"',
    page.intake.current_programs,
    ['va_healthcare']
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll renderStep selected-state and none-exclusivity checks passed.');
