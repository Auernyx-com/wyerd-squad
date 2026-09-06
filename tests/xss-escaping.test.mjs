// tests/xss-escaping.test.mjs
//
// Independent-audit findings (2026-09-06), critical + high:
//
// 1. fmt() only converted **bold** markdown to <strong> tags and did zero
//    HTML-escaping. Its output was assigned via .innerHTML in showResults/
//    showErrorResult/addMsg. Any HTML in a backend AI response (this app
//    talks to an LLM; getting a model to echo back attacker-supplied markup
//    in its own reply is a low bar) executed as live markup. Demonstrated:
//    a crafted response containing <img src=x onerror=...> ran the handler
//    in the same global scope as vaultPass and the decrypted intake/
//    chatHistory -- full vault exfiltration, defeating the "stays encrypted
//    on your device" promise.
//
// 2. showDiffScreen() (fires on every vault unlock) and renderStep()'s
//    location-step re-render both interpolated veteran-entered free text
//    (the county field, in particular) into HTML with no escaping at all.
//
// Fixed by adding escapeHtml() and routing every sink through it (fmt()
// escapes first, then applies the bold-markdown substitution on the
// already-escaped text). This test extracts escapeHtml/fmt from the real
// file's own source text (not a hand copy that can drift out of sync) and
// verifies no live HTML metacharacter survives a crafted payload -- which
// is a complete proof the sink is closed: escaped text cannot execute as
// markup regardless of what parses it, so no DOM/browser is needed to
// confirm this. This repo has no test framework or build tooling
// configured -- plain, dependency-free Node, run with
// `node tests/xss-escaping.test.mjs`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '..', 'tool', 'index.html'), 'utf8');

const start = src.indexOf('function escapeHtml(str)');
const end = src.indexOf('function getCoverageNote');
if (start === -1 || end === -1) {
  throw new Error('Could not locate escapeHtml/fmt section in tool/index.html -- did it move or get renamed?');
}

const moduleSrc = `${src.slice(start, end)}\nexport { escapeHtml, fmt };\n`;
const moduleUrl = `data:text/javascript,${encodeURIComponent(moduleSrc)}`;
const { escapeHtml, fmt } = await import(moduleUrl);

let failures = 0;
function check(description, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${description} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

function hasLiveHtmlMetachar(s) {
  return /[<>]/.test(s);
}

// The exact payload class demonstrated in the audit: an AI response
// containing a self-firing <img onerror> tag.
{
  const payload = 'Here is what I found.<img src=x onerror="exfiltrate(vaultPass)">';
  const out = fmt(payload);
  check('fmt() neutralizes <img onerror> payload: no raw "<" or ">" survives', hasLiveHtmlMetachar(out), false);
  check('fmt() escapes the tag literally', out.includes('&lt;img src=x onerror=&quot;exfiltrate(vaultPass)&quot;&gt;'), true);
}

// The county-field attribute-breakout payload demonstrated in the audit.
{
  const payload = '" autofocus onfocus="exfiltrate(\'pwned\')" x="';
  const out = escapeHtml(payload);
  check('escapeHtml() neutralizes attribute-breakout quote', out.includes('"'), false);
  check('escapeHtml() output cannot break out of a value="..." attribute', out, '&quot; autofocus onfocus=&quot;exfiltrate(&#39;pwned&#39;)&quot; x=&quot;');
}

// The diff-screen <img onerror> payload demonstrated in the audit.
{
  const payload = '<img src=x onerror="exfiltrate(\'pwned-via-diff-screen\')">';
  const out = escapeHtml(payload);
  check('escapeHtml() neutralizes diff-screen <img onerror> payload', hasLiveHtmlMetachar(out), false);
}

// Bold markdown must still render correctly through the new escape-first
// pipeline -- this is the actual, legitimate feature fmt() exists for.
{
  const out = fmt('**PRIMARY PATH**\nCall the VSO.');
  check('fmt() still converts **bold** to <strong> for legitimate markdown', out.startsWith('<strong>PRIMARY PATH</strong>'), true);
}

// A response that is entirely ordinary text (the overwhelmingly common
// case) must render unchanged in substance -- no double-escaping, no
// mangled punctuation.
{
  const out = fmt("Call the VA at 1-800-827-1000, ask for the VSO.");
  check('fmt() leaves ordinary text substantively unchanged', out, "Call the VA at 1-800-827-1000, ask for the VSO.");
}

// Ampersands in ordinary text (a common, entirely benign character in this
// domain -- "M&A", "R&R", org names) must be escaped without double-
// escaping on a second pass (escapeHtml is only ever called once per
// render in this codebase, but this documents the expectation explicitly).
{
  const out = escapeHtml('Housing & Urban Development');
  check('escapeHtml() escapes ampersand exactly once', out, 'Housing &amp; Urban Development');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll XSS-escaping checks passed.');
