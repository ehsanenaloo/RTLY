import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EXT } from '../helpers/load.mjs';

// Static stylesheets cannot be conditional, so every rule must be gated behind a class / attribute
// RTLY itself adds only on a site where it is active (rtly-active, rtly-<site>, rtly-with-font/-rtl,
// data-rtly-*). A rule without such a gate would restyle a site the user disabled.
const files = ['content/base.css', ...fs.readdirSync(path.join(EXT, 'content/sites')).filter((f) => f.endsWith('.css')).map((f) => `content/sites/${f}`)];

function rules(src) {
  const s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(s))) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
}
function topLevelSplit(sel) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
// A selector is gated when its FIRST compound selector is an RTLY gate (these are the only
// elements the cascade can start from), e.g. ".rtly-claude.rtly-with-rtl ...", "html.rtly-active ...",
// "[data-rtly-dir=...]", '[class*="rtly-"] svg'.
const GATE = /^(?:html|body)?(?:\.rtly-[\w-]+|\[data-rtly-[\w-]+[^\]]*\]|\[class\*="rtly-"\])/;

describe('every stylesheet rule is gated behind RTLY-owned classes / attributes', () => {
  for (const f of files) {
    test(f, () => {
      const bad = [];
      for (const r of rules(fs.readFileSync(path.join(EXT, f), 'utf8'))) {
        for (const part of topLevelSplit(r.sel)) {
          if (!GATE.test(part.replace(/^:is\(/, ''))) bad.push(part.slice(0, 100));
        }
      }
      assert.deepEqual(bad, []);
    });
  }
  test('no :root / html / body rule and no page-wide custom property outside the gate', () => {
    for (const f of files) {
      for (const r of rules(fs.readFileSync(path.join(EXT, f), 'utf8'))) {
        assert.ok(!/^(:root|html|body)\s*$/.test(r.sel), `${f}: ungated ${r.sel}`);
      }
    }
  });
});

describe('RTLY stylesheets never touch layout properties on page-wide selectors', () => {
  const LAYOUT = /(^|;|\s)(margin|padding|width|height|display|position|order|float|top|left|right|bottom|flex|flex-direction|align-items|align-self|justify-content|gap|inset|overflow|max-width|min-width)[\w-]*\s*:/;
  test('base.css has no layout declarations outside the rtly-* utility classes', () => {
    const src = fs.readFileSync(path.join(EXT, 'content/base.css'), 'utf8');
    const offenders = rules(src).filter((r) => LAYOUT.test(r.body) && !/\.rtly-(topbar|copyright|feedback|color)/.test(r.sel));
    assert.deepEqual(offenders.map((r) => r.sel.slice(0, 80)), []);
  });
});
