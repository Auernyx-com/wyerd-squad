// tests/import-validation-and-unlock-message.test.mjs
//
// Independent-audit finding (2026-09-07, round 5, low), two parts:
//
// 1. A tampered/corrupted exported profile fails vault-unlock with the
//    identical "Phrase is incorrect" message as a genuinely wrong
//    passphrase. Confirmed the underlying crypto behavior is CORRECT
//    (AES-GCM's auth tag rejects tampered ciphertext and fails closed --
//    no corrupted plaintext ever surfaces; this cannot be weakened to
//    "detect tampering separately" without leaking information an
//    attacker could use). This is a wording gap, not a security bug:
//    a veteran who cleared their original device (the only path that
//    exposes "Load profile from file") and is retrying a phrase they
//    know is right has no way to learn "this file may be damaged" is
//    even a possibility. Fixed by broadening the message to name both
//    causes, without claiming to know which one actually happened.
//
// 2. importProfile()'s validation (`!data.salt || !data.session...`)
//    treats an empty array as present (`![]` is `false` in JS) -- a
//    salt/iv/ct that's shape-valid-but-empty silently passed the
//    "incomplete or damaged" check. Confirmed Node's real WebCrypto
//    deriveKey() doesn't throw on a zero-length salt, so this doesn't
//    crash -- it just adds another way to land in the same ambiguous
//    unlock failure instead of being caught at import time with a
//    clearer message. Fixed by checking these are non-empty arrays, not
//    just truthy.
//
// Uses the same whole-script-evaluation + fake-DOM technique as
// tests/isreturning-reset-on-start-over.test.mjs (importProfile is
// DOM-coupled) to exercise the real, unmodified function.

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
    id, className: '', style: {}, children: [], disabled: false, value: '', files: [],
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
    removeChild(child) { el.children = el.children.filter((c) => c !== child); },
    remove() {}, scrollIntoView() {}, addEventListener() {},
    querySelectorAll() { return []; }, querySelector() { return null; }, focus() {}, click() {},
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

function loadPageModule() {
  const fakeDocument = makeFakeDocument();
  const fakeLocalStorage = makeFakeLocalStorage();
  const fn = new Function(
    'document', 'localStorage', 'crypto',
    `${scriptBody}\nreturn { importProfile };`
  );
  const page = fn(fakeDocument, fakeLocalStorage, globalThis.crypto);
  return { page, getElementById: fakeDocument.getElementById.bind(fakeDocument) };
}

function makeFakeFile(obj) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return { text: async () => text };
}

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

// --- Part 2: empty-array shape validation -----------------------------
{
  const { page, getElementById } = loadPageModule();
  await page.importProfile(makeFakeFile({
    schema: 'squad-bat.veteran-profile.v1',
    salt: [],  // present, but empty -- semantically useless
    session: { iv: [1, 2, 3], ct: [1, 2, 3] },
  }));
  const errEl = getElementById('vault-import-error');
  check(
    'empty salt array is now caught at import time with a clear message, not silently accepted',
    errEl.classList.contains('hidden'),
    false
  );
}
{
  const { page, getElementById } = loadPageModule();
  await page.importProfile(makeFakeFile({
    schema: 'squad-bat.veteran-profile.v1',
    salt: [1, 2, 3],
    session: { iv: [], ct: [1, 2, 3] },  // empty iv
  }));
  const errEl = getElementById('vault-import-error');
  check('empty session.iv array is caught at import time', errEl.classList.contains('hidden'), false);
}
{
  // Well-formed file must still import cleanly -- no regression.
  const { page, getElementById } = loadPageModule();
  await page.importProfile(makeFakeFile({
    schema: 'squad-bat.veteran-profile.v1',
    salt: [1, 2, 3, 4],
    session: { iv: [5, 6, 7], ct: [8, 9, 10] },
  }));
  const errEl = getElementById('vault-import-error');
  check('a well-formed file still imports without an error (no regression)', errEl.classList.contains('hidden'), true);
}

// --- Part 1: unlock-failure message acknowledges both causes -----------
{
  const src = html;
  const msgLine = src.slice(src.indexOf("if (!session)"), src.indexOf("if (!session)") + 300);
  check(
    'the unlock-failure message mentions the file/damage possibility, not only a wrong phrase',
    /damag|corrupt/i.test(msgLine),
    true
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll import-validation and unlock-message checks passed.');
