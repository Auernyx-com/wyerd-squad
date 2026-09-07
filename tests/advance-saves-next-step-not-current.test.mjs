// tests/advance-saves-next-step-not-current.test.mjs
//
// Independent-audit finding (2026-09-06, round 4, low):
// advance() called saveSession() BEFORE incrementing currentStep (and
// before the skip-walk loop), so the value persisted to the vault was
// always the index of the step just answered, not the next one.
// restoreSession() then calls renderStep() directly against that saved
// index, so a veteran resuming a saved session was shown the question
// they had JUST finished answering, again. For multi/location steps this
// is harmless (prior selections are pre-filled), but for single-select
// steps (the majority of STEPS/GUIDED_STEPS) there is no "already
// answered" indication, so it looks like a fresh, unanswered question --
// a veteran could re-answer it differently without realizing they were
// silently overwriting a prior answer.
//
// Confirmed directly before this fix: after advance() from currentStep=0
// to currentStep=1 (service_status -> discharge), the session persisted
// to the vault still had currentStep: 0, not 1.
//
// Fixed by moving the increment/skip-walk before saveSession() (except on
// the final step, where submitIntake() -- not saveSession() directly --
// already persists the session itself with the completed index, unchanged
// by this fix).
//
// Uses the same real encrypt/decrypt round trip (Node's real Web Crypto)
// as tests/guided-mode-resume-active-steps.test.mjs to verify what's
// actually persisted, not a reimplementation.

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
    id, className: '', style: {}, children: [], disabled: false, value: '',
    classList: {
      _set: new Set(['hidden']),
      add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c, force) {
        if (force === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); }
        else if (force) this._set.add(c); else this._set.delete(c);
      },
    },
    appendChild(child) { el.children.push(child); return child; },
    removeChild(child) { el.children = el.children.filter(c => c !== child); },
    remove() {}, scrollIntoView() {}, addEventListener() {},
    querySelectorAll() { return []; }, querySelector() { return null; }, focus() {},
  };
  let _html = '', _text = '';
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

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
}

function loadPageModule(sharedLocalStorage) {
  const fakeDocument = makeFakeDocument();
  const fakeLocalStorage = sharedLocalStorage || makeFakeLocalStorage();
  const fn = new Function(
    'document', 'localStorage', 'crypto',
    `${scriptBody}
return {
  startIntake, advance, decryptSession,
  STEPS,
  get currentStep() { return currentStep; },
  set currentStep(v) { currentStep = v; },
  get intake() { return intake; },
  set intake(v) { intake = v; },
  set vaultPass(v) { vaultPass = v; },
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

{
  const sharedStorage = makeFakeLocalStorage();
  const page = loadPageModule(sharedStorage);
  page.vaultPass = 'a passphrase';
  page.startIntake(page.STEPS);

  // Answer step 0 (service_status) and advance.
  page.intake = { service_status: 'veteran' };
  await page.advance();

  check('advance() moves currentStep forward in memory', page.currentStep, 1);

  const persisted = await loadPageModule(sharedStorage).decryptSession('a passphrase');
  check(
    'the SAVED currentStep matches the next unanswered step, not the one just answered',
    persisted.currentStep,
    page.currentStep
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll advance()-saves-next-step checks passed.');
