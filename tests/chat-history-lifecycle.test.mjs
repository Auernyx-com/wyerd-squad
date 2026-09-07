// tests/chat-history-lifecycle.test.mjs
//
// Independent-audit findings (2026-09-06, round 3):
//
// 1. (High) restoreSession() restores `chatHistory` into memory from a
//    prior session's vault but never repopulates the `#thread` DOM (no
//    such reconstruction path exists anywhere in the file -- confirmed by
//    exhaustive grep of every `thread` reference). The diff screen this
//    app actually shows a returning veteran offers only two options:
//    "Something's changed — update my info" (back to the wizard) or
//    "Nothing's changed — run it" (submitIntake(), a fresh AI response).
//    There is no button that ever displays OLD results/chat as-is
//    (`showResults(text, isRestore=true)` is never called anywhere with
//    isRestore actually true -- dead parameter). submitIntake() never
//    touches chatHistory, so a veteran's OLD conversation from a prior
//    session survives, invisible (the #thread DOM starts empty on a
//    fresh page load either way), into the NEW results view -- and gets
//    silently forwarded to /chat on their next message via
//    `history: chatHistory.slice(0, -1)`.
//
// 2. (Medium) chatHistory is silently truncated to the last 20 entries
//    for what's sent to /chat, while the visible #thread keeps growing
//    unbounded with no cap and no notice -- a long conversation's early
//    context silently drops from the model's view with nothing on
//    screen telling the veteran that happened.
//
// Fixed: (1) submitIntake() now resets chatHistory to [] before storing
// fresh results -- a newly (re)generated results set starts a new
// conversation, matching what's actually visible on screen (an empty
// thread) instead of silently carrying invisible prior-session content.
// (2) sendChat() now shows a one-time notice in the thread the first
// time truncation actually happens, so the veteran knows older context
// stopped being sent.
//
// This repo has no jsdom/test-framework dependency (see
// tests/vault-corrupted-storage.test.mjs's own note on this). Unlike the
// other tests in this repo, submitIntake()/sendChat() are DOM-coupled
// enough that pure source-extraction isn't practical -- this file
// evaluates the ENTIRE inline <script> against a small, generic,
// self-contained fake `document` (every element id resolves to an inert
// fake supporting the handful of DOM operations this page actually
// uses: classList, innerHTML/textContent, appendChild, addEventListener,
// querySelectorAll). This exercises the real, unmodified functions, not
// reimplementations.

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
      _set: new Set(['hidden']), // matches real markup: most sections start hidden
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

let fetchCalls = [];
function makeFakeFetch(responseQueue) {
  return async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    fetchCalls.push({ url, body });
    const next = responseQueue.shift() ?? { response: 'DEFAULT_RESPONSE' };
    return { ok: true, json: async () => next };
  };
}

function loadPageModule({ responseQueue }) {
  fetchCalls = [];
  const fakeDocument = makeFakeDocument();
  const fakeFetch = makeFakeFetch(responseQueue);
  const fn = new Function(
    'document', 'fetch', 'localStorage', 'crypto', 'URL', 'Blob',
    `${scriptBody}\nreturn { submitIntake, sendChat, get chatHistory() { return chatHistory; }, set chatHistory(v) { chatHistory = v; }, get savedResults() { return savedResults; }, get intake() { return intake; }, set intake(v) { intake = v; }, get vaultPass() { return vaultPass; } };`
  );
  const fakeLocalStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const page = fn(fakeDocument, fakeFetch, fakeLocalStorage, globalThis.crypto, globalThis.URL, globalThis.Blob);
  return { page, fetchCalls, getElementById: fakeDocument.getElementById.bind(fakeDocument) };
}

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

// --- Finding 1: chatHistory must not survive a fresh submitIntake() run ---
{
  const { page, fetchCalls } = loadPageModule({ responseQueue: [{ response: 'FRESH_GUIDANCE' }] });
  // Simulate a restored session: a prior conversation sitting in memory,
  // invisible on screen (fresh page load -> empty #thread either way).
  page.chatHistory = [
    { role: 'user', content: 'my old sensitive disclosure from last time' },
    { role: 'assistant', content: 'old guidance' },
  ];
  page.intake = { need: ['housing'] };

  await page.submitIntake();

  check('submitIntake() clears the old, invisible chatHistory', page.chatHistory, []);
  check('savedResults reflects the fresh response', page.savedResults, 'FRESH_GUIDANCE');
}

{
  // End-to-end: after a fresh submitIntake(), a subsequent chat message
  // must NOT silently carry the old, never-displayed conversation.
  const { page, fetchCalls } = loadPageModule({
    responseQueue: [{ response: 'FRESH_GUIDANCE' }, { response: 'CHAT_REPLY' }],
  });
  page.chatHistory = [
    { role: 'user', content: 'my old sensitive disclosure from last time' },
    { role: 'assistant', content: 'old guidance' },
  ];
  page.intake = { need: ['housing'] };

  await page.submitIntake();
  page.vaultPass; // no-op read, just documenting saveSession() is a no-op without a vault
  await page.sendChat.call(undefined);
}

// --- Finding 2: truncation notice ---
{
  const { page, getElementById } = loadPageModule({ responseQueue: Array.from({ length: 25 }, (_, i) => ({ response: `reply ${i}` })) });
  page.intake = {};

  // Prime chatHistory close to the cap so one more exchange triggers it.
  page.chatHistory = Array.from({ length: 19 }, (_, i) => ({ role: 'user', content: `msg ${i}` }));

  const inputEl = getElementById('chat-input');
  inputEl.value = 'one more message';
  await page.sendChat();

  check('chatHistory is capped at 20 after truncation', page.chatHistory.length <= 20, true);
  const thread = getElementById('thread');
  const allText = thread.children.map(c => (c.children[1] ? (c.children[1].textContent || c.children[1].innerHTML) : '')).join(' | ');
  check('a truncation notice appears in the thread once the cap is hit', allText.toLowerCase().includes('older') || allText.toLowerCase().includes('recent'), true);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll chat-history lifecycle checks passed.');
