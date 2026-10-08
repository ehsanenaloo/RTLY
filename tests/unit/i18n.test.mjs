import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadI18n, EXT, readJson } from '../helpers/load.mjs';

const { catalog, i18n } = loadI18n();

// Keys that are intentionally EN-only (documented in shared/i18n.js header: t() falls
// through to EN for every locale). Anything else missing from a locale is a real gap.
const EN_ONLY_KEY = /^previewBubble/;
// Keys whose value is intentionally the empty string in every locale.
const INTENTIONALLY_EMPTY = new Set(['footerAboutCta']);

// Explicit, documented allowlist of KNOWN translation gaps: { locale: [keys...] }.
// Keep this EMPTY when the catalog is complete. Add entries only with a ticket/reason;
// the test below fails if an allowlisted key is no longer missing (so the list can't rot).
const KNOWN_GAPS = {
  // fa: ['someKey'],   // reason / ticket
};

describe('shared/i18n.js catalog', () => {
  test('SUPPORTED_LOCALES lists exactly the 15 catalog locales', () => {
    assert.deepEqual([...i18n.SUPPORTED_LOCALES].sort(), Object.keys(catalog).sort());
    assert.equal(i18n.SUPPORTED_LOCALES.length, 15);
  });
  test('RTL_LOCALES is the supported set minus en and all have names', () => {
    assert.deepEqual([...i18n.RTL_LOCALES].sort(), [...i18n.SUPPORTED_LOCALES].filter((l) => l !== 'en').sort());
    for (const l of i18n.SUPPORTED_LOCALES) assert.ok(i18n.LOCALE_NAMES[l], `no LOCALE_NAMES for ${l}`);
  });

  const en = Object.keys(catalog.en);
  for (const locale of Object.keys(catalog).filter((l) => l !== 'en')) {
    test(`${locale}: has every translatable en key (modulo documented allowlist)`, () => {
      const have = new Set(Object.keys(catalog[locale]));
      const missing = en.filter((k) => !have.has(k) && !EN_ONLY_KEY.test(k));
      const allowed = new Set(KNOWN_GAPS[locale] || []);
      const unexpected = missing.filter((k) => !allowed.has(k));
      const stale = [...allowed].filter((k) => !missing.includes(k));
      assert.deepEqual(unexpected, [], `${locale} is missing ${unexpected.length} key(s): ${unexpected.join(', ')}`);
      assert.deepEqual(stale, [], `KNOWN_GAPS[${locale}] lists keys that are no longer missing: ${stale.join(', ')}`);
    });
    test(`${locale}: has no keys absent from en (orphans)`, () => {
      const enSet = new Set(en);
      const orphans = Object.keys(catalog[locale]).filter((k) => !enSet.has(k));
      assert.deepEqual(orphans, []);
    });
    test(`${locale}: no empty-string values`, () => {
      const empty = Object.entries(catalog[locale]).filter(([k, v]) => typeof v !== 'string' || (v === '' && !INTENTIONALLY_EMPTY.has(k))).map(([k]) => k);
      assert.deepEqual(empty, []);
    });
  }

  test('placeholder tokens (%s / {0}) are preserved in translations', () => {
    const tokens = (s) => (String(s).match(/%[sd]|\{\d+\}|%\d\$s/g) || []).sort().join(',');
    const bad = [];
    for (const locale of Object.keys(catalog).filter((l) => l !== 'en')) {
      for (const [k, v] of Object.entries(catalog[locale])) {
        if (k in catalog.en && tokens(v) !== tokens(catalog.en[k])) bad.push(`${locale}.${k}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('every data-i18n* key referenced by popup/options HTML exists in the en catalog', () => {
    const missing = [];
    for (const f of ['pages/popup/popup.html', 'pages/options/options.html']) {
      const html = fs.readFileSync(path.join(EXT, f), 'utf8');
      for (const m of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
        if (!(m[1] in catalog.en)) missing.push(`${f}: ${m[1]}`);
      }
    }
    assert.deepEqual(missing, []);
  });
});

describe('_locales/*/messages.json (Chrome manifest i18n)', () => {
  const dirs = fs.readdirSync(path.join(EXT, '_locales'));
  const en = readJson('_locales/en/messages.json');
  const enKeys = Object.keys(en).sort();

  test('en exists and every message has a non-empty "message"', () => {
    for (const [k, v] of Object.entries(en)) assert.ok(v.message && v.message.length, k);
  });
  for (const loc of dirs.filter((d) => d !== 'en')) {
    test(`${loc}: key parity with en and non-empty messages`, () => {
      const m = readJson(`_locales/${loc}/messages.json`);
      assert.deepEqual(Object.keys(m).sort(), enKeys);
      for (const [k, v] of Object.entries(m)) assert.ok(v.message && v.message.length, `${loc}.${k}`);
    });
  }
  test('every __MSG_x__ in manifest exists in en', () => {
    const raw = fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8');
    for (const m of raw.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) assert.ok(m[1] in en, m[1]);
  });
  test('every _locales dir is a known UI locale', () => {
    for (const d of dirs) assert.ok(i18n.SUPPORTED_LOCALES.includes(d) || ['ckb', 'ug'].includes(d), d);
  });
});
