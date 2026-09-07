// tests/detailed-report-link-survives-quick-vote.test.mjs
//
// Independent-audit finding (2026-09-07, round 7, medium): the "File a
// detailed report" link (#open-feedback-btn) used to live inside
// #strip-form -- the quick-vote widget's own container -- which the
// strip-submit success handler hides entirely
// (document.getElementById('strip-form')?.classList.add('hidden')) once a
// veteran successfully sends a quick vote. A veteran who quick-voted lost
// the only path to file a detailed report for that results view; the
// success state only ever showed a plain "Received. Thank you" message
// with no way back to the detailed form.
//
// Fixed by moving the link out of #strip-form to sit as a direct sibling
// inside .feedback-strip, so it survives whichever of #strip-form /
// #strip-success is currently shown.
//
// Two checks: (1) a structural check against the real HTML source that the
// link markup is no longer nested inside the #strip-form block, and (2) a
// behavioral check that the real strip-submit success handler never hides
// (or otherwise touches) the link's own element.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, '..', 'tool', 'index.html'), 'utf8');

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

// ── 1. Structural: #open-feedback-btn markup sits outside #strip-form ──────
{
  const stripFormOpenIdx = html.indexOf('<div id="strip-form">');
  const stripFormCloseIdx = html.indexOf('</div>', html.indexOf('<div class="strip-note">', stripFormOpenIdx));
  const linkIdx = html.indexOf('id="open-feedback-btn"');

  check(
    'the "File a detailed report" link markup is outside the #strip-form block',
    linkIdx > stripFormCloseIdx,
    true,
  );
}

// ── 2. Behavioral: the real strip-submit success handler never hides the
//      link's own element ───────────────────────────────────────────────
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
    checked: false,
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
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener(type, fn) {
      if (type === 'DOMContentLoaded') fn();
    },
  };
}

async function run() {
  const fakeDocument = makeFakeDocument();
  const fakeLocalStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const fn = new Function(
    'document', 'localStorage', 'crypto', 'confirm', 'fetch',
    `${scriptBody}
return {};`
  );
  // Successful /feedback POST, matching the strip-submit success path.
  const fakeFetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
  fn(fakeDocument, fakeLocalStorage, globalThis.crypto, () => true, fakeFetch);

  const getElementById = fakeDocument.getElementById.bind(fakeDocument);
  const openFeedbackBtn = getElementById('open-feedback-btn');
  // This fake element factory defaults every element's classList to
  // starting with "hidden" (a harness simplification, matching the pattern
  // in tests/isreturning-reset-on-start-over.test.mjs) -- but the real
  // #open-feedback-btn markup has no hidden class to begin with. Set the
  // real initial state explicitly so the check below isn't testing an
  // artifact of the fake.
  openFeedbackBtn.classList.remove('hidden');

  // strip-submit's validation only requires a vote OR missing-info text --
  // this fake doc's querySelectorAll('.btn-vote') returns [] (module-load
  // time registration is a no-op here), so drive it via the text field,
  // matching what strip-submit actually reads.
  getElementById('strip-missing').value = 'the number was disconnected';

  await new Promise((resolve) => {
    const submitBtn = getElementById('strip-submit');
    submitBtn._fire('click');
    setTimeout(resolve, 0);
  });
  // Let the async click handler's microtasks/fetch resolve.
  await new Promise((resolve) => setTimeout(resolve, 10));

  check(
    'strip-form was hidden by the success handler (sanity check the scenario actually fired)',
    getElementById('strip-form').classList.contains('hidden'),
    true,
  );
  check(
    'the "File a detailed report" link itself was never hidden by the quick-vote success handler',
    openFeedbackBtn.classList.contains('hidden'),
    false,
  );

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll detailed-report-link-survives-quick-vote checks passed.');
}

run();
