// tests/truncation-notice-flag-reset-on-start-over.test.mjs
//
// Independent-audit finding (2026-09-07, round 7, low):
// The "Start over for a different situation" handler resets chatHistory
// to [] (see tests/chat-history-lifecycle.test.mjs for why that reset
// exists) but never reset chatHistoryTruncationNoticeShown alongside it --
// even though the OTHER place that resets chatHistory to [] (submitIntake's
// new-results path) resets both together. A veteran whose first
// conversation triggered the one-time "Pathfinder can only see recent
// messages" notice, then clicked "Start over for a different situation" to
// help someone else entirely, would never see that notice again in the new,
// unrelated conversation even if it ran long enough to truncate again --
// the flag was still true from before, left over from the old case.
//
// Confirmed directly before this fix: triggering the real start-over-btn
// click handler after chatHistoryTruncationNoticeShown had been set true
// left it still true afterward, alongside chatHistory (which does get reset
// correctly).
//
// Same harness pattern as tests/isreturning-reset-on-start-over.test.mjs --
// fires the REAL click handler registered via addEventListener inside
// tool/index.html's own setup code against a fake document, with a stubbed
// global confirm() matching the handler's own confirm() gate.

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
  get chatHistory() { return chatHistory; },
  set chatHistory(v) { chatHistory = v; },
  get chatHistoryTruncationNoticeShown() { return chatHistoryTruncationNoticeShown; },
  set chatHistoryTruncationNoticeShown(v) { chatHistoryTruncationNoticeShown = v; },
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

  // Simulate a conversation that already tripped the one-time truncation
  // notice.
  page.chatHistory = [{ role: 'user', content: 'hi' }];
  page.chatHistoryTruncationNoticeShown = true;

  // Fire the real, registered start-over-btn click handler (confirm() is
  // stubbed to always return true).
  getElementById('start-over-btn')._fire('click');

  check('chatHistoryTruncationNoticeShown is reset to false by Start Over', page.chatHistoryTruncationNoticeShown, false);
  check('chatHistory is still cleared by Start Over (no regression)', page.chatHistory, []);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll truncation-notice-flag reset-on-start-over checks passed.');
