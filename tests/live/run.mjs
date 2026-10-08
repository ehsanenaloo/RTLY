// Live smoke test against real, publicly reachable chat pages (no login).
// Not part of CI: sites change, require network and may show consent walls.
// Usage: node tests/live/run.mjs [siteFilter...]
import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const ext = path.resolve('extension');
const SITES = [
  { id: 'perplexity.ai', url: 'https://www.perplexity.ai/' },
  { id: 'copilot.microsoft.com', url: 'https://copilot.microsoft.com/' },
  { id: 'chat.mistral.ai', url: 'https://chat.mistral.ai/chat' },
  { id: 'huggingface.co', url: 'https://huggingface.co/chat/' },
  { id: 'bing.com', url: 'https://www.bing.com/chat' },
  { id: 'gemini.google.com', url: 'https://gemini.google.com/app' },
  { id: 'chatgpt.com', url: 'https://chatgpt.com/' },
  { id: 'claude.ai', url: 'https://claude.ai/new' },
  { id: 'grok.com', url: 'https://grok.com/' },
  { id: 'chat.deepseek.com', url: 'https://chat.deepseek.com/' },
  { id: 'chat.qwen.ai', url: 'https://chat.qwen.ai/' },
  { id: 'chat.z.ai', url: 'https://chat.z.ai/' },
  { id: 'poe.com', url: 'https://poe.com/' },
  { id: 'aistudio.google.com', url: 'https://aistudio.google.com/' },
  { id: 'notebooklm.google.com', url: 'https://notebooklm.google.com/' },
  { id: 'cohere.com', url: 'https://coral.cohere.com/' },
];
const filter = process.argv.slice(2);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rtly-live-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, locale: 'fa-IR',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const rows = [];
for (const s of SITES.filter((x) => !filter.length || filter.some((f) => x.id.includes(f)))) {
  const page = await ctx.newPage();
  const row = { site: s.id, injected: false, composer: '-', note: '' };
  try {
    const resp = await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    row.status = resp?.status();
    row.final = new URL(page.url()).host + new URL(page.url()).pathname;
    const info = await page.evaluate(() => ({
      font: !!document.getElementById('rtly-font-face'),
      cls: [...document.documentElement.classList, ...(document.body?.classList || [])].filter((c) => c.startsWith('rtly')).join(' '),
    }));
    row.injected = info.font; row.cls = info.cls;
    const sel = 'textarea, [contenteditable="true"], [role="textbox"]';
    const box = page.locator(sel).first();
    if (await box.count()) {
      await box.click({ timeout: 4000 }).catch(() => {});
      await page.keyboard.type('سلام، این یک آزمایش است', { delay: 15 });
      await page.waitForTimeout(800);
      row.composer = await box.evaluate((el) => `${el.tagName.toLowerCase()} dir=${el.getAttribute('dir') || '-'} font=${getComputedStyle(el).fontFamily.slice(0, 18)}`);
    } else row.note = 'no composer visible (login/consent wall?)';
  } catch (e) { row.note = String(e.message).split('\n')[0].slice(0, 90); }
  rows.push(row);
  console.log(JSON.stringify(row));
  await page.close();
}
await ctx.close();
