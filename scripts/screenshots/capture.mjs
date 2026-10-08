// Phase 1: drive Chromium with the REAL unpacked extension and capture raw screenshots.
// - chat fixture is served on the real host https://chatgpt.com/ so the real content script injects
// - "without RTLY" = same page with siteSettings['chatgpt.com'] = false
// - popup / options are the real chrome-extension:// pages
import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { EXT, SHOTS, RAW } from './paths.mjs';
import { chatPage, CHAT } from './fixture.mjs';

const HOST = 'chatgpt.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function capture() {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(RAW, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rtly-shots-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    deviceScaleFactor: 2,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    const EXT_ID = sw.url().split('/')[2];
    const ev = (fn, arg) => sw.evaluate(fn, arg);
    const setStorage = (o) => ev((x) => chrome.storage.local.set(x), o);
    const clearStorage = () => ev(() => chrome.storage.local.clear());
    const base = (extra = {}) => ({ uiLocale: 'fa', theme: 'light', supportNudge: { installedAt: Date.now() }, ...extra });

    // hermetic: only the chatgpt.com fixture is served, every other http(s) request is aborted
    await ctx.route(/^https?:\/\//, (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === HOST && route.request().resourceType() === 'document') {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: chatPage({ theme: u.searchParams.get('theme') || 'light' }) });
      }
      return route.abort();
    });

    // ---------- chat: with / without RTLY, light / dark ----------
    async function chat(theme, enabled) {
      await clearStorage();
      await setStorage(base({ theme, siteSettings: { [HOST]: enabled } }));
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 820, height: 700 });
      await page.goto(`https://${HOST}/c/1?theme=${theme}`, { waitUntil: 'domcontentloaded' });
      if (enabled) {
        await page.waitForFunction(() => {
          const els = [...document.querySelectorAll('.markdown p, [data-message-author-role="user"] div')];
          return els.length && els.every((e) => e.getAttribute('dir'));
        }, null, { timeout: 15000 }).catch(() => {});
      } else await sleep(1200);
      await page.click('#prompt-textarea');
      await page.keyboard.type(CHAT.composerText, { delay: 8 });
      await sleep(600);
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await page.mouse.move(2, 2);
      await sleep(400);
      const info = await page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('.markdown p'));
        return { dir: cs.direction, font: cs.fontFamily.slice(0, 40), align: cs.textAlign };
      });
      console.log(`  chat ${theme} rtly=${enabled}:`, JSON.stringify(info));
      await page.screenshot({ path: path.join(RAW, `chat-${enabled ? 'with' : 'without'}-${theme}.png`) });
      await page.close();
    }
    for (const theme of ['light', 'dark']) for (const en of [false, true]) await chat(theme, en);

    // ---------- popup ----------
    // The popup is normally opened over a real tab. Here it is opened as a page, so (screenshots only)
    // chrome.tabs.query is overridden to report the chatgpt.com fixture as the active tab. The UI is unchanged.
    async function popup(name, { theme, locale, menu = false }) {
      await clearStorage();
      await setStorage(base({ theme, uiLocale: locale, siteSettings: { 'poe.com': false, 'bing.com': false }, siteModes: { 'chatgpt.com': 'full' } }));
      const page = await ctx.newPage();
      await page.addInitScript((u) => {
        const q = (_q, cb) => { const r = [{ id: 1, active: true, url: u }]; if (cb) cb(r); return Promise.resolve(r); };
        try { chrome.tabs.query = q; } catch (_) { Object.defineProperty(chrome.tabs, 'query', { value: q }); }
      }, `https://${HOST}/c/1`);
      await page.setViewportSize({ width: 380, height: 900 });
      await page.goto(`chrome-extension://${EXT_ID}/pages/popup/popup.html`);
      await page.waitForSelector('#hero > *');
      await page.waitForSelector('#sitesList > *');
      await sleep(900);
      if (menu) { await page.click('#overflowBtn'); await sleep(500); }
      await page.mouse.move(2, 2);
      const box = await page.evaluate((m) => {
        const r = (s) => { const e = document.querySelector(s); return e && !e.hidden ? e.getBoundingClientRect() : null; };
        const a = r('#popup'); const b = m ? r('#overflowMenu') : null;
        return { h: Math.ceil(Math.max(a.bottom, b ? b.bottom : 0)) };
      }, menu);
      const h = Math.min(box.h, 900);
      await page.screenshot({ path: path.join(SHOTS, `${name}.png`), clip: { x: 0, y: 0, width: 380, height: h } });
      console.log(`  ${name}: 380x${h} css px`);
      await page.close();
    }
    await popup('popup-light', { theme: 'light', locale: 'fa' });
    await popup('popup-dark', { theme: 'dark', locale: 'fa' });
    await popup('popup-menu', { theme: 'light', locale: 'fa', menu: true });
    await popup('popup-en-dark', { theme: 'dark', locale: 'en' });

    // ---------- options ----------
    const meta = {};
    async function options(name, { theme, locale, width = 1280, height = 900, selector = null }) {
      await clearStorage();
      await setStorage(base({ theme, uiLocale: locale, siteSettings: { 'poe.com': false, 'bing.com': false } }));
      const page = await ctx.newPage();
      await page.setViewportSize({ width, height });
      await page.goto(`chrome-extension://${EXT_ID}/pages/options/options.html`);
      await page.waitForSelector('#siteTableBody tr');
      await page.waitForSelector('#previewLangTabs button');
      await sleep(1000);
      await page.mouse.move(2, 2);
      meta.siteCount = await page.locator('#siteTableBody tr').count();
      meta.localeCount = await page.locator('#uiLocale option').count();
      const out = path.join(SHOTS, `${name}.png`);
      if (selector) await page.addStyleTag({ content: '.options-topbar{display:none!important}' });
      if (selector) await page.locator(selector).screenshot({ path: out });
      else await page.screenshot({ path: out });
      console.log(`  ${name}`);
      await page.close();
    }
    await options('options-light', { theme: 'light', locale: 'fa' });
    await options('options-dark', { theme: 'dark', locale: 'fa' });
    await options('options-mobile', { theme: 'light', locale: 'fa', width: 390, height: 844 });
    await options('sites-list', { theme: 'light', locale: 'fa', selector: '.sites-card' });
    await options('languages', { theme: 'light', locale: 'ar' });
    console.log('  meta', JSON.stringify(meta));
    fs.writeFileSync(path.join(RAW, 'meta.json'), JSON.stringify(meta));
  } finally {
    await ctx.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}
