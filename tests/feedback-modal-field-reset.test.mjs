// tests/feedback-modal-field-reset.test.mjs
//
// Independent-audit finding (2026-09-07, round 7, medium): the detailed
// feedback modal never reset its own fields (radios, textareas, org/phone/
// address) on close or reopen -- an abandoned draft's text, including a
// corrected-organization complaint about one office, could silently
// persist into the next, unrelated submission if the veteran opened the
// modal again later for a different correction.
//
// Confirmed directly before this fix: filling every field, then calling
// openFeedback() again (the only path back into the modal, whether it was
// previously closed via ✕, Cancel, the overlay, or Done after a submit),
// left every field exactly as the veteran had left it.
//
// Fixed with a resetFeedbackForm() called at the top of openFeedback(), so
// every fresh modal session starts clean regardless of how the previous
// one ended.
//
// Same harness pattern as tests/isreturning-reset-on-start-over.test.mjs --
// evaluates the real inline <script> and fires the real, registered
// open-feedback-btn click handler. Unlike that test, this one also needs a
// document.querySelectorAll/querySelector that resolve the two specific
// selectors resetFeedbackForm() and the submit handler actually use.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, '..', 'tool', 'index.html'), 'utf8');

const scriptStartTag = html.indexOf('<script>');
const scriptStart = html.indexOf('>', scriptStartTag) + 1;
const scriptEnd = html.lastIndexOf('</script>');
const scriptBody = html.slice(scriptStart, scriptEnd);

const RADIO_IDS = ['cw-yes', 'cw-partial', 'cw-no', 'cw-notried'];
const TEXTAREA_IDS = ['fb-found', 'fb-missing', 'fb-experience', 'fb-complaint'];
const TEXT_INPUT_IDS = ['fb-org-name', 'fb-phone', 'fb-address'];

function makeFakeElement(id) {
  const listeners = {};
  const el = {
    id,
    className: '',
    style: {},
    children: [],
    disabled: false,
    value: '',
    checked: false,
    type: RADIO_IDS.includes(id) ? 'radio' : undefined,
    name: RADIO_IDS.includes(id) ? 'contact_worked' : undefined,
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
  function getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeFakeElement(id));
    return elements.get(id);
  }
  return {
    getElementById,
    createElement(tag) { return makeFakeElement(`<${tag}>`); },
    body: getElementById('body'),
    querySelectorAll(selector) {
      if (selector === '#feedback-form-wrap input[type="radio"]') return RADIO_IDS.map(getElementById);
      if (selector === '#feedback-form-wrap textarea') return TEXTAREA_IDS.map(getElementById);
      if (selector === '.btn-vote') return [];
      return [];
    },
    querySelector(selector) {
      if (selector === 'input[name="contact_worked"]:checked') {
        return RADIO_IDS.map(getElementById).find(r => r.checked) || null;
      }
      return null;
    },
    addEventListener(type, fn) {
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
return {};`
  );
  const fakeFetch = async () => ({ ok: true, json: async () => ({}) });
  fn(fakeDocument, fakeLocalStorage, globalThis.crypto, () => true, fakeFetch);
  return { getElementById: fakeDocument.getElementById.bind(fakeDocument) };
}

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

{
  const { getElementById } = loadPageModule();

  // Simulate a veteran who filled out the modal for one org's correction...
  getElementById('cw-partial').checked = true;
  getElementById('fb-found').value = 'Old VAMC line still worked.';
  getElementById('fb-missing').value = 'No SSVF office listed.';
  getElementById('fb-experience').value = 'Confusing at step 3.';
  getElementById('fb-complaint').value = 'Regional office gave wrong form number.';
  getElementById('fb-org-name').value = 'Grand Junction VAMC';
  getElementById('fb-phone').value = '970-263-5100';
  getElementById('fb-address').value = '2460 Main St';

  // ...then, later (possibly for an entirely different org/situation),
  // reopens the modal.
  getElementById('open-feedback-btn')._fire('click');

  check('radio selection cleared on reopen', getElementById('cw-partial').checked, false);
  check('"what you found" textarea cleared on reopen', getElementById('fb-found').value, '');
  check('"what was missing" textarea cleared on reopen', getElementById('fb-missing').value, '');
  check('"experience" textarea cleared on reopen', getElementById('fb-experience').value, '');
  check('"complaint" textarea cleared on reopen', getElementById('fb-complaint').value, '');
  check('org name field cleared on reopen', getElementById('fb-org-name').value, '');
  check('phone field cleared on reopen', getElementById('fb-phone').value, '');
  check('address field cleared on reopen', getElementById('fb-address').value, '');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll feedback-modal field-reset checks passed.');
