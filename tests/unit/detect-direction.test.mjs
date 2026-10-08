import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../helpers/load.mjs';

const { api } = loadContent('chatgpt.com');
const d = api.detectDirection;

describe('detectDirection: scripts', () => {
  test('Persian is rtl', () => assert.equal(d('سلام دنیا، حال شما چطور است؟'), 'rtl'));
  test('Arabic is rtl', () => assert.equal(d('مرحبا بالعالم كيف حالك اليوم'), 'rtl'));
  test('Hebrew is rtl', () => assert.equal(d('שלום עולם מה שלומך היום'), 'rtl'));
  test('Urdu is rtl', () => assert.equal(d('آپ کیسے ہیں آج'), 'rtl'));
  test('Pashto / Sindhi / Kurdish (Arabic script) are rtl', () => {
    assert.equal(d('ستاسو نوم څه دی'), 'rtl');
    assert.equal(d('توهان ڪيئن آهيو'), 'rtl');
    assert.equal(d('تۆ چۆنی ئەمڕۆ'), 'rtl');
  });
  test("Syriac, Thaana, N'Ko are rtl", () => {
    assert.equal(d('ܫܠܡܐ ܥܠܡܐ'), 'rtl');
    assert.equal(d('ދިވެހި ބަސް'), 'rtl');
    assert.equal(d('ߊߟߎ߫ ߞߊ߲'), 'rtl');
  });
  test('Arabic presentation forms are rtl', () => assert.equal(d('ﺍﺎﻟﻣ'), 'rtl'));
  test('English is ltr', () => assert.equal(d('Hello world, how are you today?'), 'ltr'));
  test('Other LTR scripts (Cyrillic/CJK) have no counted chars -> none', () => {
    assert.equal(d('Привет мир'), 'none');
    assert.equal(d('你好世界'), 'none');
  });
});

describe('detectDirection: neutral input', () => {
  test('empty string / undefined / whitespace -> none', () => {
    assert.equal(d(''), 'none');
    assert.equal(d(), 'none');
    assert.equal(d('   \n\t '), 'none');
  });
  test('ASCII digits and punctuation only -> none', () => {
    assert.equal(d('12345 67.89 !@#$%'), 'none');
  });
  test('Persian-Indic digits live in the Arabic block and DO count as rtl chars (documented behaviour)', () => {
    assert.equal(d('۱۲۳۴۵'), 'rtl');
  });
  test('emoji only -> none', () => assert.equal(d('😀🎉'), 'none'));
});

describe('detectDirection: mixed text and thresholds', () => {
  test('Persian with English tech terms stays rtl', () => {
    assert.equal(d('برای نصب باید دستور npm install را اجرا کنید'), 'rtl');
    assert.equal(d('Run npm install را اجرا کن'), 'rtl');
  });
  test('English with a single Persian word is ltr', () => {
    assert.equal(d('Please translate this sentence into Persian: سلام'), 'ltr');
  });
  test('30% threshold without marker: 29% ltr, 30% rtl', () => {
    assert.equal(d('abcdefg' + 'ااا'), 'rtl'); // exactly 3/10
    assert.equal(d('a'.repeat(71) + 'ا'.repeat(29)), 'ltr');
    assert.equal(d('a'.repeat(70) + 'ا'.repeat(30)), 'rtl');
  });
  test('20% threshold applies when an Arabic-script marker is present', () => {
    const base = 'a'.repeat(79) + 'ا'.repeat(21); // 21%: ltr at 30%
    assert.equal(d(base), 'ltr');
    assert.equal(d(base + '،'), 'rtl');
    const below = 'a'.repeat(81) + 'ا'.repeat(19) + '،'; // 19%: ltr even with marker
    assert.equal(d(below), 'ltr');
  });
  test('every marker lowers the threshold', () => {
    const markers = ['،', '؛', '؟', 'ِ', 'ّ', 'ْ', 'ً', 'ٌ', 'ٍ', 'َ', '‌'];
    const text = 'a'.repeat(77) + 'ا'.repeat(23);
    for (const m of markers) {
      // marker chars in the Arabic block are themselves counted; keep the assertion about the combined result
      assert.equal(d(text + m), 'rtl', `marker U+${m.codePointAt(0).toString(16)}`);
    }
    assert.equal(d(text), 'ltr');
  });
  test('ZWNJ (Persian half-space) counts as a marker', () => {
    // 5 RTL of 14 scripted = 35%: rtl regardless; use a tighter ratio
    const t = 'a'.repeat(77) + 'ا'.repeat(23);
    assert.equal(d(t), 'ltr');
    assert.equal(d(t + '‌'), 'rtl');
  });
  test('documented real-world CamelCase-heavy sentence is rtl (v1.8.15)', () => {
    const s = 'scope: ۵ متد (getContacts حذف شد، به cluster waveِ 03B منتقل شد): getContactIDs, search, getBlocked, resolvePhone, resolveUsername — هرکدام endpointِ verb-specificِ یکتا دارد.';
    assert.equal(d(s), 'rtl');
  });
  test('code-like ASCII with punctuation never rtl', () => {
    assert.equal(d('const a = 1; // ok, fine?'), 'ltr');
  });
});

describe('detectDirection: Adlam surrogate pairs', () => {
  const adlam = String.fromCodePoint(0x1E900, 0x1E901, 0x1E902, 0x1E903);
  test('pure Adlam is rtl (and matched by AR_FA_WORD)', () => {
    assert.equal(d(adlam), 'rtl');
    assert.ok(api.AR_FA_WORD.test(adlam));
  });
  test('Adlam counts once per code point, not per UTF-16 unit', () => {
    // 4 code points vs 10 Latin = 28.6% -> ltr; vs 9 Latin = 30.8% -> rtl
    assert.equal(d(adlam + 'a'.repeat(10)), 'ltr');
    assert.equal(d(adlam + 'a'.repeat(9)), 'rtl');
  });
  test('lone high surrogate / non-Adlam astral char is ignored', () => {
    assert.equal(d('\uD83A'), 'none');
    assert.equal(d(String.fromCodePoint(0x1F600) + 'abc'), 'ltr');
    assert.equal(d(String.fromCodePoint(0x1E960)), 'none'); // just past the Adlam block
  });
});

describe('regex invariants', () => {
  test('AR_FA_WORD matches each RTL script, rejects Latin/digits/CJK', () => {
    for (const s of ['س', 'ع', 'ש', 'ܐ', 'ދ', 'ߊ']) assert.ok(api.AR_FA_WORD.test(s), s);
    for (const s of ['a', 'Z', '123', '', '你']) assert.ok(!api.AR_FA_WORD.test(s), s);
  });
});
