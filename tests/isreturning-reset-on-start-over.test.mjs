// tests/isreturning-reset-on-start-over.test.mjs
//
// Independent-audit finding (2026-09-06, round 4, medium):
// `isReturning` is set to `true` when a veteran with savedResults unlocks
// their vault, or clicks "Something's changed — update my info". It is
// read directly into the /process POST body: `is_returning: isReturning`.
// The "Start over for a different situation" handler explicitly resets
// everything relevant to a fresh, unrelated case (clearSession(); intake =
// {}; chatHistory = []; currentStep = 0; savedResults = null;) but never
// resets isReturning. A veteran who returns, sees the diff screen
// (isReturning -> true), then clicks "Start over for a different
// situation" to help someone else entirely still has isReturning === true
// on the brand-new intake that follows -- submitIntake() sends
// is_returning: true for a submission that, by the UI's own label, is not
// a returning-veteran rerun at all.
//
// Confirmed directly before this fix: triggering the real start-over-btn
// click handler after isReturning had been set true left isReturning
// still true afterward, alongside the fields it does correctly reset.
//
// This triggers the REAL click handler registered via addEventListener
// inside tool/index.html's own setup code (not a reimplementation) against
// a fake document whose addEventListener actually captures and exposes
// listeners, and a stubbed global confirm() (the handler's own confirm()
// gate, matching how it behaves once a veteran accepts the prompt).

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
    id,
    className: '',
    style: {},
    children: [],
    disabled: false,
    value: '',
    files: [],
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
    // Real capture, unlike the inert stub other tests in this repo use --
    // this test needs to actually fire the registered click handler.
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    _fire(type, evt) { (listeners[type] || []).forEach((fn) => fn(evt)); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    focus() {},
    click() {},
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
    addEventListener(type, fn) {
      // The page's own top-level bootstrap listens for DOMContentLoaded to
      // register every button handler -- fire it immediately here so those
      // registrations happen during module load, same as in a real page.
      if (type === 'DOMContentLoaded') fn();
    },
  };
}

function loadPageModule() {
  const fakeDocument = makeFakeDocument();
  const fakeLocalStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const fn = new Function(
    'document', 'localStorage', 'crypto', 'confirm', 'fetch',
    `${scriptBody}
return {
  get isReturning() { return isReturning; },
  set isReturning(v) { isReturning = v; },
  get intake() { return intake; },
  set intake(v) { intake = v; },
};`
  );
  const fakeFetch = async () => ({ ok: true, json: async () => ({}) });
  const page = fn(fakeDocument, fakeLocalStorage, globalThis.crypto, () => true, fakeFetch);
  return { page, getElementById: fakeDocument.getElementById.bind(fakeDocument) };
}

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

{
  const { page, getElementById } = loadPageModule();

  // Simulate a returning veteran who has already unlocked their vault and
  // is mid-way through "Something's changed — update my info".
  page.isReturning = true;
  page.intake = { need: ['housing'], service_status: 'veteran' };

  // Fire the real, registered start-over-btn click handler (confirm() is
  // stubbed to always return true, i.e. the veteran confirms the prompt).
  getElementById('start-over-btn')._fire('click');

  check('isReturning is reset to false by Start Over', page.isReturning, false);
  check('intake is still cleared by Start Over (no regression)', page.intake, {});
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll isReturning reset-on-start-over checks passed.');
