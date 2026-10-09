// Phase 2: compose before/after images and the store / social graphics from the raw captures.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, EXT, ASSETS, SHOTS, STORE, RAW, furl } from './paths.mjs';
import { toRgb24, pngInfo } from './png.mjs';

const FONT_DIR = path.join(EXT, 'fonts');
const LOGO = furl(path.join(ASSETS, 'logo.svg'));
const img = (p) => furl(p);
const shot = (n) => img(path.join(SHOTS, n + '.png'));
const raw = (n) => img(path.join(RAW, n + '.png'));

const CSS = `
@font-face{font-family:"IranYekan";src:url("${furl(path.join(FONT_DIR, 'iranyekan-regular.woff'))}") format("woff");font-weight:400}
@font-face{font-family:"IranYekan";src:url("${furl(path.join(FONT_DIR, 'iranyekan-bold.woff'))}") format("woff");font-weight:600 800}
:root{--teal:#0E7C95;--teal2:#095F73;--paper:#F4F2EC;--ink:#1A1A17;--ink2:#494740;--line:#E4E0D6}
*{box-sizing:border-box;margin:0}
html,body{margin:0}
body{font-family:"Segoe UI",system-ui,sans-serif;color:var(--ink);overflow:hidden}
[dir=rtl] body,body[dir=rtl],.fa{font-family:"IranYekan","Segoe UI",sans-serif}
.frame{border-radius:14px;overflow:hidden;box-shadow:0 30px 70px -20px rgb(20 40 50/.45),0 0 0 1px rgb(0 0 0/.08);background:#fff}
.frame img{display:block;width:100%}
h1{font-weight:700;letter-spacing:-.02em;line-height:1.12}
.fa h1{letter-spacing:0;line-height:1.35;font-weight:700}
p.sub{color:var(--ink2);line-height:1.45}
.fa p.sub{line-height:1.8}
`;

let browser;
async function render(html, w, h, out, { rgb = true, fa = false } = {}) {
  const tmp = path.join(RAW, `_c_${path.basename(out)}.html`);
  fs.writeFileSync(tmp, `<!doctype html><html lang="${fa ? 'fa' : 'en'}" dir="${fa ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${CSS}</style></head><body class="${fa ? 'fa' : ''}" style="width:${w}px;height:${h}px;position:relative">${html}</body></html>`);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(furl(tmp));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.screenshot({ path: out });
  await page.close();
  if (rgb) toRgb24(out);
  const i = pngInfo(out);
  if (i.width !== w || i.height !== h) throw new Error(`${out}: ${i.width}x${i.height} != ${w}x${h}`);
  console.log(`  ${path.relative(ROOT, out)}  ${w}x${h}`);
}

// ---------- before / after ----------
const BA_TEXT = {
  en: { before: 'Without RTLY', after: 'With RTLY' },
  fa: { before: 'بدون RTLY', after: 'با RTLY' },
};
function beforeAfterHtml(theme, lang) {
  const dark = theme === 'dark';
  const t = BA_TEXT[lang];
  const bg = dark ? '#0f1214' : '#EAE7DF';
  const ink = dark ? '#e8ecee' : '#1A1A17';
  const pill = (txt, on) => `<div style="display:inline-flex;align-items:center;gap:10px;padding:8px 20px;border-radius:99px;font-size:22px;font-weight:700;
    ${on ? 'background:#0E7C95;color:#fff' : `background:${dark ? '#2a2f33' : '#fff'};color:${dark ? '#b9c1c6' : '#6b675d'};border:1px solid ${dark ? '#3a4045' : '#d6d1c4'}`}">
    <span style="width:10px;height:10px;border-radius:50%;background:${on ? '#7FD8EA' : (dark ? '#c0646a' : '#c0504f')}"></span>${txt}</div>`;
  const panel = (name, label, on) => `<div style="width:740px"><div style="margin-bottom:16px;text-align:center" class="${lang === 'fa' ? 'fa' : ''}">${pill(label, on)}</div>
    <div class="frame" style="${on ? 'box-shadow:0 0 0 3px #0E7C95,0 30px 60px -20px rgb(0 0 0/.4)' : ''}"><img src="${raw(`chat-${name}-${theme}`)}"></div></div>`;
  // physical left = without, right = with (same in both languages: it is a before -> after comparison)
  return `<div style="position:absolute;inset:0;background:${bg};color:${ink};display:flex;justify-content:center;align-items:flex-start;gap:40px;padding-top:34px;direction:ltr">
    ${panel('without', t.before, false)}${panel('with', t.after, true)}</div>`;
}
const BA_W = 1600, BA_H = 764;

// ---------- brand pieces ----------
const mark = (s, ring = false) => `<img src="${LOGO}" width="${s}" height="${s}" style="display:block;border-radius:${s * 0.22}px;${ring ? 'box-shadow:0 0 0 2px rgba(255,255,255,.55)' : ''}">`;
const COPY = {
  en: {
    c1: ['Fix right-to-left text in AI chats', 'Correct alignment and a clean Persian font on ChatGPT, Claude, Gemini and more.'],
    c2: ['Control every site from the toolbar', 'Turn RTLY on or off per site, pick full, font-only or RTL-only mode, and adjust the font size.'],
    c3: ['Settings with a live preview', 'See the result before you change anything: font size, color palette, per-site modes and pinned sites.'],
    c4: ['Dark mode and color palettes', 'Follows your system theme, with four accent palettes to choose from.'],
    c5: (n) => ['Speaks your language', `${n} interface languages, including Arabic, Persian, Hebrew, Urdu and Kurdish.`],
  },
  fa: {
    c1: ['راست‌چین‌کردن متن در چت‌های هوش مصنوعی', 'جهت درست متن و فونت ایران‌یکان در ChatGPT، Claude، Gemini و بیشتر.'],
    c2: ['هر سایت را از نوار ابزار کنترل کنید', 'RTLY را برای هر سایت روشن یا خاموش کنید، حالت کامل، فقط فونت یا فقط راست‌چین را بزنید و اندازه‌ی فونت را تنظیم کنید.'],
    c3: ['تنظیمات با پیش‌نمایش زنده', 'پیش از هر تغییر نتیجه را ببینید: اندازه‌ی فونت، پالت رنگ، حالت هر سایت و سایت‌های سنجاق‌شده.'],
  },
};

const BG_PAPER = 'background:radial-gradient(1200px 500px at 85% -10%,#D7ECF1 0%,rgba(215,236,241,0) 60%),#F4F2EC';
const BG_DARK = 'background:radial-gradient(1000px 500px at 85% -10%,#12414d 0%,rgba(18,65,77,0) 60%),#101416;color:#eef2f3';

/** headline on top, big image bleeding off the bottom */
function layoutTop({ head, sub, src, w = 1160, top = 200, dark = false, fa = false }) {
  return `<div style="position:absolute;inset:0;${dark ? BG_DARK : BG_PAPER}">
    <div style="position:absolute;top:40px;left:0;right:0;text-align:center;padding:0 80px">
      <h1 style="font-size:${fa ? 50 : 54}px;${dark ? 'color:#fff' : ''}">${head}</h1>
      <p class="sub" style="font-size:${fa ? 22 : 24}px;margin-top:12px;${dark ? 'color:#b9c6ca' : ''}">${sub}</p></div>
    <div class="frame" style="position:absolute;top:${top}px;left:${(1280 - w) / 2}px;width:${w}px;border-bottom-left-radius:0;border-bottom-right-radius:0"><img src="${src}"></div></div>`;
}
/** headline on one side, one or two popup screenshots on the other */
function layoutPopups({ head, sub, srcs, fa = false }) {
  const pw = 304, ph = Math.round(595 * pw / 380);
  const pops = srcs.map((s, i) => `<div class="frame" style="width:${pw}px;margin-top:${i ? 40 : 0}px;border-radius:16px"><img src="${s}"></div>`).join('');
  return `<div style="position:absolute;inset:0;${BG_PAPER};display:flex;align-items:center;justify-content:space-between;padding:0 80px">
    <div style="width:420px;flex:none"><div style="margin-bottom:26px">${mark(56)}</div>
      <h1 style="font-size:${fa ? 42 : 46}px">${head}</h1>
      <p class="sub" style="font-size:${fa ? 20 : 22}px;margin-top:16px">${sub}</p></div>
    <div style="display:flex;flex:none;gap:22px;direction:ltr;height:${ph + 40}px;align-items:flex-start">${pops}</div></div>`;
}
function layoutDark({ head, sub, fa = false }) {
  return `<div style="position:absolute;inset:0;${BG_DARK}">
    <div style="position:absolute;left:80px;top:96px;width:420px"><div style="margin-bottom:26px">${mark(56)}</div>
      <h1 style="font-size:50px;color:#fff">${head}</h1><p class="sub" style="font-size:22px;margin-top:16px;color:#b9c6ca">${sub}</p></div>
    <div class="frame" style="position:absolute;left:560px;top:110px;width:640px;box-shadow:0 0 0 1px #2a3338,0 40px 80px -20px #000"><img src="${raw('chat-with-dark')}"></div>
    <div class="frame" style="position:absolute;left:80px;top:430px;width:340px;height:370px;border-bottom-left-radius:0;border-bottom-right-radius:0;box-shadow:0 0 0 1px #2a3338,0 30px 60px -10px #000"><img src="${shot('popup-dark')}"></div></div>`;
}

export async function compose() {
  fs.mkdirSync(STORE, { recursive: true });
  const meta = JSON.parse(fs.readFileSync(path.join(RAW, 'meta.json'), 'utf8'));
  browser = await chromium.launch({ headless: true });
  try {
    // README / listing images
    for (const theme of ['light', 'dark']) {
      await render(beforeAfterHtml(theme, 'en'), BA_W, BA_H, path.join(SHOTS, `before-after-${theme}.png`));
      await render(beforeAfterHtml(theme, 'fa'), BA_W, BA_H, path.join(RAW, `before-after-fa-${theme}.png`), { rgb: false });
    }
    const baEn = shot('before-after-light'), baFa = img(path.join(RAW, 'before-after-fa-light.png'));
    const out = (n) => path.join(STORE, n);

    // Chrome Web Store / Edge Add-ons 1280x800 (English)
    const C = COPY.en;
    await render(layoutTop({ head: C.c1[0], sub: C.c1[1], src: baEn, w: 1180, top: 214 }), 1280, 800, out('chrome-1-before-after.png'));
    await render(layoutPopups({ head: C.c2[0], sub: C.c2[1], srcs: [shot('popup-light'), shot('popup-menu')] }), 1280, 800, out('chrome-2-popup.png'));
    await render(layoutTop({ head: C.c3[0], sub: C.c3[1], src: shot('options-light'), w: 1100, top: 200 }), 1280, 800, out('chrome-3-options.png'));
    await render(layoutDark({ head: C.c4[0], sub: C.c4[1] }), 1280, 800, out('chrome-4-dark.png'));
    const c5 = C.c5(meta.localeCount);
    await render(layoutTop({ head: c5[0], sub: c5[1], src: shot('languages'), w: 1100, top: 200 }), 1280, 800, out('chrome-5-languages.png'));

    // Persian versions
    const F = COPY.fa;
    await render(layoutTop({ head: F.c1[0], sub: F.c1[1], src: baFa, w: 1180, top: 214, fa: true }), 1280, 800, out('chrome-fa-1-before-after.png'), { fa: true });
    await render(layoutPopups({ head: F.c2[0], sub: F.c2[1], srcs: [shot('popup-light'), shot('popup-menu')], fa: true }), 1280, 800, out('chrome-fa-2-popup.png'), { fa: true });
    await render(layoutTop({ head: F.c3[0], sub: F.c3[1], src: shot('options-light'), w: 1100, top: 214, fa: true }), 1280, 800, out('chrome-fa-3-options.png'), { fa: true });

    await render(layoutDark({ head: 'حالت تاریک و پالت‌های رنگی', sub: 'RTLY با تم روشن، تاریک یا سیستم و چهار پالت رنگ، هماهنگ با ظاهر مرورگر شما.', fa: true }), 1280, 800, out('chrome-fa-4-dark.png'), { fa: true });
    await render(layoutTop({ head: 'رابط کاربری به ۱۵ زبان', sub: 'فارسی، عربی، عبری، اردو، پشتو، کردی سورانی و زبان‌های دیگر راست‌به‌چپ.', src: shot('languages'), w: 1100, top: 214, fa: true }), 1280, 800, out('chrome-fa-5-languages.png'), { fa: true });

    // Small promo tile 440x280
    await render(`<div style="position:absolute;inset:0;background:linear-gradient(135deg,#0E7C95,#095F73);color:#fff;padding:26px 28px">
      <div style="display:flex;align-items:center;gap:14px">${mark(56, true)}<div style="font-size:44px;font-weight:800;letter-spacing:-.02em">RTLY</div></div>
      <div style="font-size:22px;font-weight:600;margin-top:14px;line-height:1.25">Right-to-left text<br>for AI chats</div>
      <div class="fa" dir="rtl" style="position:absolute;left:28px;right:28px;bottom:22px;background:#fff;color:#1A1A17;border-radius:14px;padding:9px 16px;font-size:17px;line-height:1.5;box-shadow:0 10px 24px -8px rgb(0 0 0/.4)">متن فارسی، درست و راست‌چین در React و npm</div></div>`, 440, 280, out('small-promo-440x280.png'));

    // Marquee 1400x560
    await render(`<div style="position:absolute;inset:0;background:radial-gradient(900px 500px at 100% 0%,#1796b3 0%,rgba(23,150,179,0) 60%),linear-gradient(135deg,#0E7C95,#073f4d);color:#fff">
      <div style="position:absolute;left:80px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center">
        <div style="display:flex;align-items:center;gap:18px;margin-bottom:30px">${mark(72, true)}<div style="font-size:58px;font-weight:800;letter-spacing:-.02em">RTLY</div></div>
        <h1 style="font-size:50px">Right-to-left, done right for AI chats</h1>
        <p style="font-size:24px;line-height:1.45;margin-top:18px;color:#d3eef4">Alignment and a Persian font for ChatGPT, Claude, Gemini and ${meta.siteCount - 3} more sites.</p></div>
      <div class="frame" style="position:absolute;left:700px;top:90px;width:650px;box-shadow:0 40px 80px -20px rgb(0 0 0/.55)"><img src="${baEn}"></div></div>`, 1400, 560, out('marquee-1400x560.png'));

    // GitHub social preview 1280x640
    await render(`<div style="position:absolute;inset:0;${BG_PAPER}">
      <div style="position:absolute;left:80px;top:100px;width:520px">
        <div style="display:flex;align-items:center;gap:20px;margin-bottom:30px">${mark(84)}<div style="font-size:72px;font-weight:800;letter-spacing:-.03em">RTLY</div></div>
        <h1 style="font-size:46px">RTL alignment and Persian font for AI chat sites</h1>
        <p class="sub" style="font-size:24px;margin-top:20px">Browser extension for Chrome, Edge and Firefox. Open source, MIT.</p></div>
      <div class="frame" style="position:absolute;left:660px;top:120px;width:560px"><img src="${baEn}"></div></div>`, 1280, 640, path.join(ASSETS, 'social-preview.png'));
  } finally {
    await browser.close();
  }
}
