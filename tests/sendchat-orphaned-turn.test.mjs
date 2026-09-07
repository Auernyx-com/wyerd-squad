// tests/sendchat-orphaned-turn.test.mjs
//
// Independent-audit finding (2026-09-08, round 6, medium):
// sendChat() pushes the veteran's message into chatHistory BEFORE the
// fetch call. If the fetch throws (network error/timeout) or the backend
// returns an error response (!res.ok || data.error), the catch/error
// branch shows a visible error in the thread but never pops the
// just-pushed user entry back out of chatHistory. On the next successful
// send, that orphaned, never-answered turn rides along in the `history`
// array sent to the backend as if it were real prior context.
//
// Confirmed directly before this fix: after a failed send, chatHistory
// still contained the failed message; on the next successful send, the
// history payload sent to the backend included that orphaned turn.
//
// Fixed by popping the just-pushed user entry back out of chatHistory in
// both the network-failure (catch) and backend-error (!res.ok ||
// data.error) branches, so a failed send leaves no trace in the
// conversation state the veteran didn't actually have.
//
// Uses the same whole-script-evaluation + fake-DOM technique as
// tests/chat-history-lifecycle.test.mjs.

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
      contains(c) { return this._set.has(c); }, toggle() {},
    },
    appendChild(child) { el.children.push(child); return child; },
    removeChild(child) { el.children = el.children.filter((c) => c !== child); },
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

function loadPageModule(fakeFetch) {
  const fakeDocument = makeFakeDocument();
  const fakeLocalStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const fn = new Function(
    'document', 'fetch', 'localStorage', 'crypto',
    `${scriptBody}\nreturn { sendChat, get chatHistory(){return chatHistory;}, set intake(v){intake=v;} };`
  );
  const page = fn(fakeDocument, fakeFetch, fakeLocalStorage, globalThis.crypto);
  return { page, getElementById: fakeDocument.getElementById.bind(fakeDocument) };
}

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

// --- Network failure (fetch throws) ---------------------------------------
{
  let callCount = 0;
  const fakeFetch = async () => {
    callCount++;
    if (callCount === 1) throw new Error('network down');
    return { ok: true, json: async () => ({ response: 'second reply' }) };
  };
  const { page, getElementById } = loadPageModule(fakeFetch);
  page.intake = {};

  getElementById('chat-input').value = 'first message will fail (network)';
  await page.sendChat();
  check('after a network failure, chatHistory has no orphaned turn', page.chatHistory, []);

  getElementById('chat-input').value = 'second message will succeed';
  await page.sendChat();
  const historySentOnSecondCall = page.chatHistory.length === 2; // user + assistant, no orphan
  check('the second send is not polluted by the failed first message', historySentOnSecondCall, true);
}

// --- Backend error response (res.ok but data.error, or !res.ok) ----------
{
  let callCount = 0;
  const fakeFetch = async () => {
    callCount++;
    if (callCount === 1) return { ok: false, json: async () => ({ error: 'Server error' }) };
    return { ok: true, json: async () => ({ response: 'second reply' }) };
  };
  const { page, getElementById } = loadPageModule(fakeFetch);
  page.intake = {};

  getElementById('chat-input').value = 'first message will get a backend error';
  await page.sendChat();
  check('after a backend error response, chatHistory has no orphaned turn', page.chatHistory, []);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll sendChat orphaned-turn checks passed.');
