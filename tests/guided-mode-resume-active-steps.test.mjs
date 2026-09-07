// tests/guided-mode-resume-active-steps.test.mjs
//
// Independent-audit finding (2026-09-06, round 4, high):
// `activeSteps` (which array -- STEPS for direct mode, GUIDED_STEPS for
// guided mode -- is currently in use) is only ever assigned inside
// startIntake(), which runs once when a veteran picks a mode. It is never
// persisted by saveSession() (which only stores {currentStep, intake,
// savedResults, chatHistory}) and never restored by restoreSession(). On
// any resume -- reload, tab close/reopen, or importProfile() on a second
// device -- activeSteps is still its module-default `null` on the fresh
// page load, so every consumer's `const steps = activeSteps || STEPS;`
// fallback silently switches a guided-mode veteran onto the 13-question
// direct-mode array (whose field ids don't match what they already
// answered) instead of their actual 11-question guided array.
//
// Confirmed directly before this fix: after startIntake(GUIDED_STEPS),
// answering a couple of steps, and saveSession(), decrypting that same
// session and calling restoreSession() left activeSteps === null, so
// renderStep()/renderProgress()/advance() all fell back to STEPS.
//
// Fixed by persisting a `mode` field ('guided' | 'direct') in
// saveSession()'s payload and having restoreSession() set activeSteps
// from it (defaulting to STEPS for old saved sessions that predate this
// fix and never recorded a mode).
//
// Uses the same whole-script-evaluation + fake-DOM technique as
// tests/chat-history-lifecycle.test.mjs (submitIntake/sendChat are
// DOM-coupled) combined with Node's real Web Crypto (as in
// tests/vault-corrupted-storage.test.mjs) so this exercises the real,
// unmodified encrypt/decrypt/save/restore round trip, not a
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
  startIntake, saveSession, decryptSession, restoreSession,
  GUIDED_STEPS, STEPS,
  get activeSteps() { return activeSteps; },
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
function trunc(v) {
  const s = JSON.stringify(v);
  return s && s.length > 80 ? s.slice(0, 80) + '…' : s;
}
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${trunc(actual)}, expected ${trunc(expected)})`);
}

// --- Guided mode survives a full save/decrypt/restore round trip ---------
{
  // Same underlying localStorage across both module instances -- represents
  // the same browser origin's storage persisting across a page reload.
  const sharedStorage = makeFakeLocalStorage();

  const page = loadPageModule(sharedStorage);
  page.vaultPass = 'correct horse battery staple';

  page.startIntake(page.GUIDED_STEPS);
  check('startIntake(GUIDED_STEPS) sets activeSteps to the guided array', page.activeSteps, page.GUIDED_STEPS);

  // Simulate answering a couple of guided-mode-only steps (e.g.
  // guided_situation, va_facility_issues -- fields that don't exist in
  // direct-mode STEPS at all).
  page.currentStep = 6;
  page.intake = { service_status: 'veteran', guided_situation: ['housing'], va_facility_issues: 'no' };
  await page.saveSession();

  // Simulate a brand-new page load: a fresh module instance sharing the
  // same underlying storage, activeSteps back to its default null, nothing
  // in memory except what comes back out of the vault.
  const fresh = loadPageModule(sharedStorage);
  const session = await fresh.decryptSession('correct horse battery staple');
  fresh.restoreSession(session);

  check(
    'resuming a guided-mode session restores activeSteps to GUIDED_STEPS, not STEPS',
    fresh.activeSteps,
    fresh.GUIDED_STEPS
  );
  check('resuming preserves the guided-only intake fields', fresh.intake.guided_situation, ['housing']);
}

// --- Direct mode still round-trips correctly (no regression) -------------
{
  const sharedStorage = makeFakeLocalStorage();
  const page = loadPageModule(sharedStorage);
  page.vaultPass = 'another passphrase entirely';

  page.startIntake(page.STEPS);
  page.currentStep = 5;
  page.intake = { service_status: 'veteran', need: ['legal'] };
  await page.saveSession();

  const fresh = loadPageModule(sharedStorage);
  const session = await fresh.decryptSession('another passphrase entirely');
  fresh.restoreSession(session);

  check('resuming a direct-mode session restores activeSteps to STEPS', fresh.activeSteps, fresh.STEPS);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll guided-mode resume activeSteps checks passed.');
