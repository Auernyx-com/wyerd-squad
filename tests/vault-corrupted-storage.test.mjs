// tests/vault-corrupted-storage.test.mjs
//
// Independent-audit finding (2026-09-06), low-medium: decryptSession()/
// encryptSession()/exportProfile() all had JSON.parse calls that ran
// unguarded -- before decryptSession's own try/catch, or with no
// try/catch at all in encryptSession/exportProfile. A corrupted
// pf_session_v1/pf_salt_v1 value in localStorage (a browser extension
// writing to the origin, a partial/interrupted write, storage-quota
// eviction, or devtools tampering by a prior user on a shared device)
// threw a SyntaxError that propagated as an unhandled promise rejection
// from the click handlers that call these -- no ".catch()" exists
// anywhere in that chain, so the veteran saw absolutely nothing happen:
// no "Phrase is incorrect" message, no error at all, just a dead button.
//
// Confirmed directly with a probe before this fix: decryptSession()
// threw synchronously with a truncated pf_session_v1 value.
//
// This extracts deriveKey/encryptSession/decryptSession from
// tool/index.html's own source and exercises them against Node's real
// Web Crypto (node:crypto webcrypto) and a fake localStorage -- no
// jsdom needed since these functions don't touch the DOM.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Node's global `crypto` is the real Web Crypto API (read-only global,
// already present -- no import/assignment needed, same object the
// browser exposes as `crypto`).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '..', 'tool', 'index.html'), 'utf8');

const start = src.indexOf('async function deriveKey');
const end = src.indexOf('function hasStoredSession');
if (start === -1 || end === -1) {
  throw new Error('Could not locate deriveKey/encryptSession/decryptSession in tool/index.html -- did it move or get renamed?');
}

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    _store: store,
  };
}

let failures = 0;
function check(description, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

async function loadModule() {
  const SALT_KEY = 'pf_salt_v1';
  const STORAGE_KEY = 'pf_session_v1';
  const moduleSrc =
    `const SALT_KEY = ${JSON.stringify(SALT_KEY)};\n` +
    `const STORAGE_KEY = ${JSON.stringify(STORAGE_KEY)};\n` +
    `${src.slice(start, end)}\n` +
    `export { encryptSession, decryptSession };\n`;
  const moduleUrl = `data:text/javascript,${encodeURIComponent(moduleSrc)}`;
  return import(moduleUrl);
}

// Corrupted pf_session_v1 (the exact regression) must not throw.
{
  globalThis.localStorage = makeFakeLocalStorage();
  globalThis.localStorage.setItem('pf_session_v1', '{not valid json truncated');
  globalThis.localStorage.setItem('pf_salt_v1', JSON.stringify(Array.from({ length: 16 }, (_, i) => i)));
  const { decryptSession } = await loadModule();

  let threw = false;
  let result;
  try {
    result = await decryptSession('any-passphrase');
  } catch {
    threw = true;
  }
  check('corrupted session value: decryptSession does not throw', threw, false);
  check('corrupted session value: decryptSession returns null (same as "no session")', result, null);
}

// Corrupted pf_salt_v1 must not throw either.
{
  globalThis.localStorage = makeFakeLocalStorage();
  globalThis.localStorage.setItem('pf_session_v1', JSON.stringify({ iv: [1, 2, 3], ct: [1, 2, 3] }));
  globalThis.localStorage.setItem('pf_salt_v1', 'not json at all {{{');
  const { decryptSession } = await loadModule();

  let threw = false;
  let result;
  try {
    result = await decryptSession('any-passphrase');
  } catch {
    threw = true;
  }
  check('corrupted salt value: decryptSession does not throw', threw, false);
  check('corrupted salt value: decryptSession returns null', result, null);
}

// encryptSession must recover from a corrupted salt by generating a fresh
// one, not throw.
{
  globalThis.localStorage = makeFakeLocalStorage();
  globalThis.localStorage.setItem('pf_salt_v1', 'not json {{{');
  const { encryptSession } = await loadModule();

  let threw = false;
  try {
    await encryptSession('my-passphrase', { some: 'data' });
  } catch {
    threw = true;
  }
  check('corrupted salt: encryptSession does not throw', threw, false);
  const newSalt = globalThis.localStorage.getItem('pf_salt_v1');
  check('corrupted salt: a fresh valid salt was written', (() => {
    try { return Array.isArray(JSON.parse(newSalt)); } catch { return false; }
  })(), true);
}

// No regression: a real encrypt -> decrypt round trip still works.
{
  globalThis.localStorage = makeFakeLocalStorage();
  const { encryptSession, decryptSession } = await loadModule();
  await encryptSession('correct-horse-battery-staple', { intake: { housing_status: 'unsheltered' } });
  const result = await decryptSession('correct-horse-battery-staple');
  check('round trip: correct passphrase recovers the real data', JSON.stringify(result), JSON.stringify({ intake: { housing_status: 'unsheltered' } }));

  const wrongResult = await decryptSession('wrong-passphrase');
  check('round trip: wrong passphrase still returns null (no regression)', wrongResult, null);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll vault corrupted-storage checks passed.');
