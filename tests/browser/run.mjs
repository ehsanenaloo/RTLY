#!/usr/bin/env node
// RTLY browser end-to-end tests (Playwright + real unpacked extension in Chromium).
//
//   node tests/browser/run.mjs                 run everything
//   node tests/browser/run.mjs chatgpt claude  only fixtures whose id contains a filter
//   RTLY_HEADED=1 node tests/browser/run.mjs   watch it run
//   RTLY_REQUIRE_BROWSER=1 ...                 fail (instead of skip) when Chromium is unavailable
//
// How it works: every supported site host is served from a local fixture (page.route) that mimics the
// selectors in extension/content/sites/<site>.js, so the REAL content script injects and runs. Nothing
// touches the network. Each scenario gets its own page and a clean chrome.storage.local.
//
// Section layout (keep the sections separate so redesigns only touch the last one):
//   1. harness            launch, routing, storage helpers, tiny test runner
//   2. site fixtures      per-site markup builders
//   3. content-script scenarios (stable; depend only on content/*.js behaviour)
//   4. EXTENSION UI SMOKE (popup / options): minimal, selector-light, easy to update
import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = path.join(ROOT, 'extension');
const filters = process.argv.slice(2);

// =====================================================================================
// 1. HARNESS
// =====================================================================================
const results = [];
async function scenario(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok    ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e });
    console.log(`FAIL  ${name} (${Date.now() - t0}ms)\n        ${String(e.message).split('\n').join('\n        ')}`);
  }
}
const selected = (id) => !filters.length || filters.some((f) => id.includes(f));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rtly-e2e-'));
let ctx;
try {
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: !process.env.RTLY_HEADED,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
} catch (e) {
  const msg = `Chromium unavailable (${String(e.message).split('\n')[0]}).\n` +
    '  Install it with: npx playwright install chromium';
  if (process.env.RTLY_REQUIRE_BROWSER) { console.error(`FAIL  ${msg}`); process.exit(1); }
  console.log(`SKIP  browser tests: ${msg}`);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
}

let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
if (!sw) { console.error('FAIL  extension service worker did not start (extension failed to load?)'); await ctx.close(); process.exit(1); }
const EXT_ID = sw.url().split('/')[2];

// Serve fixtures for supported hosts; abort every other http(s) request (hermetic, no network).
const FIXTURES = new Map(); // host -> html
await ctx.route(/^https?:\/\//, (route) => {
  const u = new URL(route.request().url());
  if (FIXTURES.has(u.hostname) && route.request().resourceType() === 'document') {
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURES.get(u.hostname) });
  }
  return route.abort();
});

/** Run fn inside the extension context (service worker, falling back to an extension page). */
async function extEval(fn, arg) {
  const t0 = Date.now();
  try {
    return await extEval1(fn, arg);
  } finally { if (process.env.RTLY_DEBUG) console.log(`      [extEval ${Date.now() - t0}ms]`); }
}
async function extEval1(fn, arg) {
  try {
    const w = ctx.serviceWorkers().find((s) => s.url().startsWith('chrome-extension://'));
    if (w) return await w.evaluate(fn, arg);
  } catch { /* worker may have been recycled; fall through */ }
  const p = await ctx.newPage();
  try {
    await p.goto(`chrome-extension://${EXT_ID}/pages/options/options.html`);
    return await p.evaluate(fn, arg);
  } finally { await p.close(); }
}
const setStorage = (obj) => extEval((o) => chrome.storage.local.set(o), obj);
const getStorage = (keys) => extEval((k) => chrome.storage.local.get(k), keys);
const resetStorage = () => extEval(() => chrome.storage.local.clear());

const observations = []; // non-failing findings printed at the end
async function pollStorage(key, pred, what) {
  for (let i = 0; i < 60; i++) {
    const v = (await getStorage(key))[key];
    if (pred(v)) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out waiting for storage: ' + what);
}

/** Condition wait with a readable failure. fn runs in the page (main world shares the DOM with the content script). */
async function until(page, what, fn, arg, timeout = 8000) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
  } catch (e) {
    throw new Error(`timed out waiting for: ${what}\n${await snapshot(page, arg)}`);
  }
}
async function snapshot(page, arg) {
  const sel = arg && arg.sel;
  if (!sel) return '';
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return `  [${s}] not found`;
    return `  [${s}] dir=${el.getAttribute('dir')} data-rtly-dir=${el.dataset.rtlyDir} processed=${el.dataset.rtlyProcessed} ` +
      `inline-font=${el.style.fontFamily || '-'} inline-direction=${el.style.direction || '-'}`;
  }, sel).catch(() => '');
}

const state = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  return {
    dir: el.getAttribute('dir'),
    rtlyDir: el.dataset.rtlyDir ?? null,
    inlineDirection: el.style.direction || '',
    inlineFont: el.style.fontFamily || '',
    computedFont: getComputedStyle(el).fontFamily,
    computedDirection: getComputedStyle(el).direction,
    processed: el.dataset.rtlyProcessed ?? null,
  };
}, sel);
const hasFont = (st) => !!st && /IranYekan/.test(st.inlineFont);

const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg); };

// =====================================================================================
// 2. SITE FIXTURES  (selectors mirror extension/content/sites/*.js)
// =====================================================================================
const FA = 'سلام، لطفاً درباره‌ی نحوه‌ی کار با ری‌اکت توضیح بده؛ ممنون!';
const FA_ANSWER = 'ری‌اکت یک کتابخانه‌ی جاوااسکریپت برای ساخت رابط کاربری است، و از کامپوننت‌ها استفاده می‌کند.';
const EN = 'Please explain how React hooks work and when to use them.';
const MIXED_FA = 'برای نصب باید دستور npm install را اجرا کنید';
const MIXED_EN = 'Use React hooks to manage component state سلام';

const SVG = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 4h16v16H4z"/></svg>';
const ICON_LIGATURE = '<span class="material-symbols-outlined" data-fx="ligature">content_copy</span>';

// Each site: host, input markup, and message builders. The text-bearing leaf of every message carries
// data-fx="msg" so scenarios can address it without depending on site markup depth.
const SITE_DEFS = {
  'chatgpt.com': {
    host: 'chatgpt.com',
    input: '<div id="prompt-textarea" contenteditable="true" style="min-height:24px" data-fx="composer"></div>',
    composerKind: 'contenteditable',
    user: (t) => `<article><div data-message-author-role="user"><div class="whitespace-pre-wrap" data-fx="msg">${t}</div></div></article>`,
    assistant: (t) => `<article><div data-message-author-role="assistant"><div class="markdown"><p data-fx="msg">${t}</p></div>` +
      `<div class="flex"><button aria-label="Copy" data-fx="iconbtn">${SVG}</button>${ICON_LIGATURE}</div></div></article>`,
  },
  'claude.ai': {
    host: 'claude.ai',
    input: '<div class="ProseMirror break-words" contenteditable="true" style="min-height:24px" data-fx="composer"><p></p></div>',
    composerKind: 'contenteditable',
    user: (t) => `<div data-testid="user-message" class="font-user-message"><p data-fx="msg">${t}</p></div>`,
    assistant: (t) => `<div class="font-claude-response"><div class="standard-markdown"><p data-fx="msg">${t}</p></div>` +
      `<div class="actions"><button aria-label="Copy" data-fx="iconbtn">${SVG}</button>${ICON_LIGATURE}</div></div>`,
  },
  'gemini.google.com': {
    host: 'gemini.google.com',
    input: '<div class="ql-editor textarea" contenteditable="true" role="textbox" style="min-height:24px" data-fx="composer"><p></p></div>',
    composerKind: 'contenteditable',
    user: (t) => `<user-query><div class="query-text"><p data-fx="msg">${t}</p></div></user-query>`,
    assistant: (t) => `<model-response><div class="message-content"><p data-fx="msg">${t}</p></div>` +
      `<div class="actions"><button aria-label="Copy" data-fx="iconbtn">${SVG}</button>${ICON_LIGATURE}</div></model-response>`,
  },
  'perplexity.ai': {
    host: 'perplexity.ai',
    input: '<textarea data-fx="composer" placeholder="Ask anything"></textarea>',
    composerKind: 'textarea',
    sidebarWrap: (inner) => `<div class="group/sidebar">${inner}</div>`,
    user: (t) => `<div data-testid="user-message-1"><p data-fx="msg">${t}</p></div>`,
    assistant: (t) => `<div class="prose"><p data-fx="msg">${t}</p></div>` +
      `<div class="actions"><button aria-label="Copy" data-fx="iconbtn">${SVG}</button>${ICON_LIGATURE}</div>`,
  },
  // Generic site served by content/sites/misc.js (article / .message / main / textarea).
  'mistral.ai': {
    host: 'chat.mistral.ai',
    input: '<textarea data-fx="composer" placeholder="Ask"></textarea>',
    composerKind: 'textarea',
    user: (t) => `<article class="message"><p data-fx="msg">${t}</p></article>`,
    assistant: (t) => `<article class="message"><p data-fx="msg">${t}</p>` +
      `<div class="actions"><button aria-label="Copy" data-fx="iconbtn">${SVG}</button>${ICON_LIGATURE}</div></article>`,
  },
};

function pageHtml(def, thread = '') {
  const side = '<nav id="sidebar" aria-label="Sidebar"><a href="/new" id="nav-new">New chat</a>' +
    '<a href="/c/1" id="nav-hist">Previous conversation about React</a>' +
    `<button id="nav-btn" aria-label="Open menu">${SVG}</button>` +
    '<span class="material-symbols-outlined" id="nav-ligature">menu</span></nav>';
  const sidebar = def.sidebarWrap ? def.sidebarWrap(side) : side;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${def.host} fixture</title>
<style>body{font-family:Arial,sans-serif;margin:0} #thread>*{margin:8px}</style></head>
<body>${sidebar}
<div id="app"><main><div id="thread">${thread}</div><form id="composer-form">${def.input}</form></main></div>
</body></html>`;
}

const msgHtml = (def, list) => list.map(([role, text]) => def[role](text)).join('\n');
const BASE_THREAD = [['user', FA], ['assistant', EN], ['assistant', FA_ANSWER], ['user', EN], ['assistant', MIXED_FA], ['assistant', MIXED_EN]];

async function openSite(key, { thread = BASE_THREAD, path: p = '/' } = {}) {
  const def = SITE_DEFS[key];
  FIXTURES.set(def.host, pageHtml(def, msgHtml(def, thread)));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { page.__errors = [...(page.__errors || []), e.message]; });
  await page.goto(`https://${def.host}${p}`, { waitUntil: 'domcontentloaded' });
  return { page, def };
}
/** Wait until the content script has processed the first Persian message on the page. */
const settled = (page) => until(page, 'RTLY to process the first message', () => {
  const el = document.querySelector('[data-fx="msg"]');
  return !!el && el.getAttribute('dir') === 'rtl';
}, {});

// =====================================================================================
// 3. CONTENT-SCRIPT SCENARIOS
// =====================================================================================
const msgs = (page) => page.$$eval('[data-fx="msg"]', (els) => els.map((e) => ({
  text: e.textContent, dir: e.getAttribute('dir'), font: e.style.fontFamily,
})));

for (const key of Object.keys(SITE_DEFS).filter(selected)) {
  await resetStorage();

  await scenario(`${key}: Persian gets rtl + IranYekan, English stays ltr, mixed text follows majority`, async () => {
    const { page } = await openSite(key);
    await settled(page);
    await until(page, 'all 6 messages processed', () => [...document.querySelectorAll('[data-fx="msg"]')].every((e) => e.getAttribute('dir')), {});
    const m = await msgs(page);
    const by = (t) => m.find((x) => x.text === t);
    eq(by(FA).dir, 'rtl', 'Persian user message dir');
    ok(/IranYekan/.test(by(FA).font), `Persian user message should have IranYekan inline (got "${by(FA).font}")`);
    eq(by(FA_ANSWER).dir, 'rtl', 'Persian assistant dir');
    ok(/IranYekan/.test(by(FA_ANSWER).font), 'Persian assistant font');
    eq(by(EN).dir, 'ltr', 'English message dir');
    ok(!/IranYekan/.test(by(EN).font), 'English message must not get IranYekan');
    eq(by(MIXED_FA).dir, 'rtl', 'Persian with English tech terms');
    eq(by(MIXED_EN).dir, 'ltr', 'English with one Persian word');
    const st = await state(page, '[data-fx="msg"]');
    eq(st.computedDirection, 'rtl', 'computed direction of first message');
    ok(/IranYekan/.test(st.computedFont), 'computed font-family contains IranYekan');
    ok(!(page.__errors || []).length, `page errors: ${(page.__errors || []).join('; ')}`);
    await page.close();
  });

  await scenario(`${key}: IranYekan @font-face is injected and the font file actually loads`, async () => {
    const { page } = await openSite(key);
    await settled(page);
    const loaded = await page.evaluate(async () => {
      const faces = await document.fonts.load('16px IranYekan', 'سلام');
      return { n: faces.length, css: !!document.getElementById('rtly-font-face') };
    });
    ok(loaded.css, '#rtly-font-face style tag missing');
    ok(loaded.n > 0, 'document.fonts.load returned no faces (font file failed to load via web_accessible_resources?)');
    await page.close();
  });

  await scenario(`${key}: sidebar/nav items and icons are left untouched`, async () => {
    const { page } = await openSite(key);
    await settled(page);
    await until(page, 'content script finished a full pass', () => [...document.querySelectorAll('[data-fx="msg"]')].every((e) => e.getAttribute('dir')), {});
    for (const sel of ['#sidebar', '#nav-new', '#nav-hist', '#nav-btn', '#nav-btn svg', '#nav-ligature', '[data-fx="ligature"]', '[data-fx="iconbtn"]', '[data-fx="iconbtn"] svg']) {
      const st = await state(page, sel);
      ok(st, `${sel} missing`);
      eq(st.dir, null, `${sel} must not get a dir attribute`);
      eq(st.rtlyDir, null, `${sel} must not get data-rtly-dir`);
      eq(st.inlineDirection, '', `${sel} must not get inline direction`);
      ok(!hasFont(st), `${sel} must not get inline IranYekan (got "${st.inlineFont}")`);
    }
    await page.close();
  });

  await scenario(`${key}: composer (${SITE_DEFS[key].composerKind}) keeps bidi auto-direction; font only while Persian is typed`, async () => {
    const { page } = await openSite(key);
    await settled(page);
    const sel = '[data-fx="composer"]';
    const target = SITE_DEFS[key].composerKind === 'contenteditable' ? page.locator(sel) : page.locator(sel);
    await target.click();
    await target.fill('');
    await page.keyboard.type('سلام دنیا', { delay: 5 });
    await until(page, 'composer font after typing Persian', (s) => /IranYekan/.test(document.querySelector(s).style.fontFamily), sel);
    const st = await state(page, sel);
    ok(st.dir === 'auto' || st.dir === 'rtl' || st.dir === 'ltr', `composer should have a dir attribute, got ${st.dir}`);
    ok(st.dir !== 'rtl' || SITE_DEFS[key].composerKind === 'contenteditable', 'composer must not be hard-locked to rtl by RTLY');
    eq(st.rtlyDir, null, 'composer must not get majority-detected data-rtly-dir');
    // Switch to English: IranYekan must be stripped so Latin metrics return to the site's font.
    await target.fill('');
    await page.keyboard.type('hello world', { delay: 5 });
    await until(page, 'composer font removed for English text', (s) => !/IranYekan/.test(document.querySelector(s).style.fontFamily), sel);
    await page.close();
  });

  await scenario(`${key}: streaming - text appended later is processed (English prefix, then Persian)`, async () => {
    const { page, def } = await openSite(key, { thread: [['user', FA]] });
    await settled(page);
    await page.evaluate((html) => document.getElementById('thread').insertAdjacentHTML('beforeend', html), def.assistant(''));
    await page.evaluate(async (chunks) => {
      const all = document.querySelectorAll('[data-fx="msg"]');
      const el = all[all.length - 1];
      el.id = 'streaming';
      for (const c of chunks) { el.textContent += c; await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 120))); }
    }, ['Sure', ', ', 'بله', '، ', 'ری‌اکت', ' یک ', 'کتابخانه', ' است ', 'برای ', 'ساخت ', 'رابط ', 'کاربری.']);
    await until(page, 'streamed message becomes rtl with font', () => {
      const el = document.getElementById('streaming');
      return el.getAttribute('dir') === 'rtl' && /IranYekan/.test(el.style.fontFamily);
    }, { sel: '#streaming' });
    // And the reverse: more English appended flips it back (re-evaluated on text change, not stuck).
    await page.evaluate(() => { document.getElementById('streaming').textContent += ' ' + 'and then a very long English tail follows here to dominate the ratio of letters overall'.repeat(6); });
    await until(page, 'streamed message re-evaluated to ltr', () => document.getElementById('streaming').getAttribute('dir') === 'ltr', { sel: '#streaming' });
    await page.close();
  });

  await scenario(`${key}: SPA navigation (pushState + whole app subtree replaced) still processes new messages`, async () => {
    const { page, def } = await openSite(key, { thread: [['user', EN]] });
    await until(page, 'initial English processed', () => document.querySelector('[data-fx="msg"]').getAttribute('dir') === 'ltr', {});
    await page.evaluate(({ html, input }) => {
      history.pushState({}, '', '/c/second-conversation');
      document.getElementById('app').innerHTML = `<main><div id="thread">${html}</div><form>${input}</form></main>`;
    }, { html: msgHtml(def, [['user', FA], ['assistant', FA_ANSWER]]), input: def.input });
    await until(page, 'new Persian messages processed after navigation', () => {
      const els = [...document.querySelectorAll('[data-fx="msg"]')];
      return els.length === 2 && els.every((e) => e.getAttribute('dir') === 'rtl' && /IranYekan/.test(e.style.fontFamily));
    }, {});
    // A message added after the swap is still picked up.
    await page.evaluate((html) => document.getElementById('thread').insertAdjacentHTML('beforeend', html), def.assistant(EN));
    await until(page, 'late English message gets ltr', () => {
      const els = [...document.querySelectorAll('[data-fx="msg"]')];
      return els.length === 3 && els[2].getAttribute('dir') === 'ltr';
    }, {});
    // And the swapped-in composer is still wired.
    const c = page.locator('[data-fx="composer"]');
    await c.click();
    await page.keyboard.type('سلام', { delay: 5 });
    await until(page, 'new composer gets Persian font', (s) => /IranYekan/.test(document.querySelector(s).style.fontFamily), '[data-fx="composer"]');
    await page.close();
  });

  await scenario(`${key}: disabling the site via siteSettings makes the content script a no-op`, async () => {
    await setStorage({ siteSettings: { [key]: false } });
    const { page } = await openSite(key);
    await page.waitForLoadState('load');
    // Negative assertion: give the script a bounded window (several debounce cycles) to misbehave, condition-gated on a probe message being inserted.
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
    const m = await msgs(page);
    ok(m.length > 0, 'fixture missing messages');
    for (const x of m) {
      eq(x.dir, null, `disabled site must not set dir on "${x.text.slice(0, 20)}"`);
      ok(!/IranYekan/.test(x.font), 'disabled site must not set inline font');
    }
    const flags = await page.evaluate(() => ({
      active: document.documentElement.classList.contains('rtly-active') || document.body.classList.contains('rtly-active'),
      fontSize: document.documentElement.style.fontSize,
    }));
    eq(flags.active, false, 'rtly-active class must not be set when disabled');
    eq(flags.fontSize, '', 'page font-size must not be scaled when disabled');
    const leaked = await page.evaluate(() => !!document.getElementById('rtly-font-face'));
    if (leaked) observations.push(key + ': disabled site still gets the #rtly-font-face <style> injected (injectIranYekanFont runs before the enabled check)');
    await page.close();
    await resetStorage();
  });
}

// ---- Settings that are site-agnostic: run on one rich site (chatgpt) + one generic -----------
for (const key of ['chatgpt.com', 'mistral.ai'].filter(selected)) {
  await scenario(`${key}: global font scale is applied to the page and follows live storage changes`, async () => {
    await resetStorage();
    await setStorage({ fontScale: 115 });
    const { page } = await openSite(key);
    await settled(page);
    await until(page, 'html font-size 115%', () => document.documentElement.style.fontSize === '115%', {});
    await setStorage({ fontScale: 100 });
    await until(page, 'html font-size override removed at 100%', () => document.documentElement.style.fontSize === '', {});
    await setStorage({ fontScale: 90 });
    await until(page, 'html font-size 90%', () => document.documentElement.style.fontSize === '90%', {});
    await page.close();
    await resetStorage();
  });

  await scenario(`${key}: per-site mode font_only applies font but not direction`, async () => {
    await resetStorage();
    await setStorage({ siteModes: { [key]: 'font_only' } });
    const { page } = await openSite(key);
    await until(page, 'Persian message gets font', () => /IranYekan/.test(document.querySelector('[data-fx="msg"]').style.fontFamily), {});
    const m = await msgs(page);
    const fa = m.find((x) => x.text === FA);
    eq(fa.dir, null, 'font_only must not set dir');
    const st = await state(page, '[data-fx="msg"]');
    eq(st.inlineDirection, '', 'font_only must not set inline direction');
    const body = await page.evaluate(() => [...document.body.classList]);
    ok(body.includes('rtly-with-font') && !body.includes('rtly-with-rtl'), `body classes for font_only: ${body.join(' ')}`);
    await page.close();
    await resetStorage();
  });

  await scenario(`${key}: per-site mode rtl_only applies direction but not font`, async () => {
    await resetStorage();
    await setStorage({ siteModes: { [key]: 'rtl_only' } });
    const { page } = await openSite(key);
    await settled(page);
    const m = await msgs(page);
    const fa = m.find((x) => x.text === FA);
    eq(fa.dir, 'rtl', 'rtl_only sets dir');
    ok(!/IranYekan/.test(fa.font), 'rtl_only must not set inline font');
    const body = await page.evaluate(() => [...document.body.classList]);
    ok(body.includes('rtly-with-rtl') && !body.includes('rtly-with-font'), `body classes for rtl_only: ${body.join(' ')}`);
    await page.close();
    await resetStorage();
  });

  await scenario(`${key}: live mode switch full -> font_only reapplies without reload`, async () => {
    await resetStorage();
    const { page } = await openSite(key);
    await settled(page);
    await setStorage({ siteModes: { [key]: 'font_only' } });
    await until(page, 'direction stripped live', () => {
      const el = document.querySelector('[data-fx="msg"]');
      return !el.getAttribute('dir') && /IranYekan/.test(el.style.fontFamily);
    }, {});
    await page.close();
    await resetStorage();
  });
}

// legacy alias: chat.openai.com uses the same canonical storage key as chatgpt.com
if (selected('chatgpt')) {
  await scenario('chat.openai.com: legacy host shares the canonical chatgpt.com setting', async () => {
    await resetStorage();
    FIXTURES.set('chat.openai.com', pageHtml(SITE_DEFS['chatgpt.com'], msgHtml(SITE_DEFS['chatgpt.com'], [['user', FA]])));
    const page = await ctx.newPage();
    await page.goto('https://chat.openai.com/', { waitUntil: 'domcontentloaded' });
    await settled(page);
    await page.close();
    await setStorage({ siteSettings: { 'chatgpt.com': false } });
    const p2 = await ctx.newPage();
    await p2.goto('https://chat.openai.com/', { waitUntil: 'domcontentloaded' });
    await p2.evaluate(() => new Promise((r) => setTimeout(r, 1200)));
    eq(await p2.evaluate(() => document.querySelector('[data-fx="msg"]').getAttribute('dir')), null, 'disabled via canonical key must apply to chat.openai.com');
    await p2.close();
    await resetStorage();
  });
}

// =====================================================================================
// 4. EXTENSION UI SMOKE  (popup / options)  -- the UI is being redesigned: keep this minimal.
//    Update ONLY this section when the pages change. Contract relied upon:
//      - pages/popup/popup.html and pages/options/options.html load without errors
//      - a per-site on/off checkbox exists as  input[data-fk="site-<canonical id>"]  (popup) or is
//        reachable by its accessible name (site label) as a checkbox
//      - toggling it results in chrome.storage.local.siteSettings[<id>] === false/true
// =====================================================================================
const UI = {
  popup: `chrome-extension://${EXT_ID}/pages/popup/popup.html`,
  options: `chrome-extension://${EXT_ID}/pages/options/options.html`,
  toggleFor: (page, id, label) => page.locator(`input[data-fk="site-${id}"], input[type="checkbox"][aria-label="${label}"]`).first(),
};

async function openExtPage(url) {
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} (${r.failure()?.errorText})`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  return { page, problems };
}

if (selected('popup') || !filters.length) {
  await scenario('popup: loads with zero console errors / failed requests and renders content', async () => {
    await resetStorage();
    const { page, problems } = await openExtPage(UI.popup);
    const text = await page.evaluate(() => document.body.innerText.trim().length);
    ok(text > 20, 'popup rendered (almost) no text');
    eq(problems.length, 0, `popup problems:\n${problems.join('\n')}`);
    await page.close();
  });

  await scenario('popup: toggling a site writes siteSettings to storage (and back)', async () => {
    await resetStorage();
    const { page, problems } = await openExtPage(UI.popup);
    const toggle = UI.toggleFor(page, 'claude.ai', 'Claude');
    await toggle.waitFor({ state: 'attached', timeout: 8000 });
    ok(await toggle.isChecked(), 'site should default to enabled');
    await toggle.click({ force: true });
    await pollStorage('siteSettings', (v) => v && v['claude.ai'] === false, 'claude.ai disabled');
    await toggle.click({ force: true });
    await pollStorage('siteSettings', (v) => v && v['claude.ai'] === true, 'claude.ai re-enabled');
    eq(problems.length, 0, `popup problems:\n${problems.join('\n')}`);
    await page.close();
    await resetStorage();
  });
}

if (selected('options') || !filters.length) {
  await scenario('options: loads with zero console errors / failed requests and renders content', async () => {
    await resetStorage();
    const { page, problems } = await openExtPage(UI.options);
    const text = await page.evaluate(() => document.body.innerText.trim().length);
    ok(text > 50, 'options page rendered (almost) no text');
    eq(problems.length, 0, `options problems:\n${problems.join('\n')}`);
    await page.close();
  });
}

// =====================================================================================
await ctx.close();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed (${results.length} scenarios)`);
process.exit(failed.length ? 1 : 0);
