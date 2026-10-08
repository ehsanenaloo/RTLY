// Neutral, generic AI-chat page used for the screenshots. It is NOT a copy of any real product:
// no logos, no trademarked UI. Its markup only mirrors the selectors RTLY's chatgpt content script
// looks for ([data-message-author-role], .markdown, #prompt-textarea), so the REAL content script runs.

const SVG_SEND = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const SVG_PLUS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const CHAT = {
  title: 'React counter',
  user1: 'چطور می‌توانم در React با useState یک شمارنده بسازم؟',
  p1: 'برای ساخت شمارنده در React ابتدا پروژه را با دستور npm create vite@latest ایجاد کنید. سپس از هوک useState استفاده کنید:',
  code: `import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}`,
  p2: 'چند نکته‌ی مهم:',
  li: [
    'مقدار اولیه‌ی state را به useState بدهید.',
    'برای به‌روزرسانی همیشه از setCount استفاده کنید، نه تغییر مستقیم متغیر.',
    'با هر تغییر state، کامپوننت دوباره رندر می‌شود.',
  ],
  user2: 'ممنون! حالا چطور داده‌ها را از یک API بگیرم؟',
  composerText: 'برای گرفتن داده از API از useEffect استفاده کنم؟',
  placeholder: 'Message…',
};

export function chatPage({ theme = 'light' } = {}) {
  const c = CHAT;
  return `<!doctype html><html lang="en" dir="ltr" data-theme="${theme}"><head><meta charset="utf-8"><title>Demo chat</title>
<style>
:root{--bg:#fff;--side:#f6f6f4;--ink:#1c1c1a;--ink2:#6b6b66;--line:#e5e5e0;--bubble:#efeeea;--code:#f3f3f0;--codeink:#2a2a27;--composer:#fff;--accent:#2b2b28}
[data-theme=dark]{--bg:#1d1e20;--side:#17181a;--ink:#ececea;--ink2:#9a9a95;--line:#2f3033;--bubble:#2b2c2f;--code:#141516;--codeink:#e4e4e0;--composer:#26272a;--accent:#ececea;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{display:flex;font:15px/1.6 "Segoe UI",system-ui,-apple-system,Arial,sans-serif;background:var(--bg);color:var(--ink);overflow:hidden}
#sidebar{width:196px;flex:none;background:var(--side);border-inline-end:1px solid var(--line);padding:14px 10px;display:flex;flex-direction:column;gap:4px;font-size:13.5px}
#sidebar .new{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;color:var(--ink);text-decoration:none;font-weight:600;margin-bottom:10px;background:var(--bg)}
#sidebar .lbl{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink2);padding:6px 10px 2px}
#sidebar a.h{padding:7px 10px;border-radius:8px;color:var(--ink);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#sidebar a.h.on{background:var(--bubble)}
#app{flex:1;min-width:0;display:flex;flex-direction:column}
.top{height:48px;flex:none;display:flex;align-items:center;padding:0 22px;border-bottom:1px solid var(--line);font-weight:600;font-size:14px}
main{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
#thread{flex:1;min-height:0;overflow:hidden;width:100%;max-width:660px;margin:0 auto;padding:22px 22px 0;display:flex;flex-direction:column;gap:18px}
article{display:block}
[data-message-author-role=user]{align-self:flex-end;max-width:82%;margin-inline-start:auto;background:var(--bubble);border-radius:18px;padding:9px 16px}
article.u{display:flex;justify-content:flex-end}
[data-message-author-role=assistant]{display:block}
.markdown p{margin:0 0 10px}
.markdown ul{margin:0 0 10px;padding-inline-start:24px}
.markdown li{margin:3px 0}
.markdown pre{direction:ltr;text-align:left;background:var(--code);color:var(--codeink);border-radius:10px;padding:12px 14px;margin:0 0 12px;overflow:hidden;font:12.5px/1.55 Consolas,"Cascadia Mono",ui-monospace,monospace;border:1px solid var(--line)}
.markdown code{font-family:Consolas,"Cascadia Mono",ui-monospace,monospace;font-size:.88em;background:var(--code);padding:1px 5px;border-radius:5px}
.markdown pre code{background:none;padding:0;font-size:inherit}
form{flex:none;width:100%;max-width:660px;margin:0 auto;padding:10px 22px 18px}
.box{display:flex;align-items:flex-end;gap:10px;background:var(--composer);border:1px solid var(--line);border-radius:22px;padding:10px 12px 10px 16px;box-shadow:0 2px 10px rgb(0 0 0/.06)}
.box .plus{color:var(--ink2);padding:6px 0}
#prompt-textarea{flex:1;min-height:26px;outline:none;padding:4px 6px;max-height:120px;overflow:hidden;caret-color:transparent}
#prompt-textarea:empty:before{content:"Message…";color:var(--ink2)}
.send{flex:none;width:34px;height:34px;border-radius:50%;background:var(--accent);color:var(--bg);display:grid;place-items:center;border:0}
</style></head><body>
<nav id="sidebar" aria-label="Sidebar">
  <a class="new" href="/new">${SVG_PLUS}New chat</a>
  <div class="lbl">Today</div>
  <a class="h on" href="/c/1">${esc(c.title)}</a>
  <a class="h" href="/c/2">Docker compose tips</a>
  <div class="lbl">Previous week</div>
  <a class="h" href="/c/3">Trip planning, Istanbul</a>
  <a class="h" href="/c/4">SQL join examples</a>
  <a class="h" href="/c/5">Resume feedback</a>
</nav>
<div id="app">
  <div class="top">${esc(c.title)}</div>
  <main>
    <div id="thread">
      <article class="u"><div data-message-author-role="user"><div class="whitespace-pre-wrap">${esc(c.user1)}</div></div></article>
      <article><div data-message-author-role="assistant"><div class="markdown">
        <p>${esc(c.p1)}</p>
        <pre><code>${esc(c.code)}</code></pre>
        <p>${esc(c.p2)}</p>
        <ul>${c.li.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </div></div></article>
      <article class="u"><div data-message-author-role="user"><div class="whitespace-pre-wrap">${esc(c.user2)}</div></div></article>
    </div>
    <form onsubmit="return false"><div class="box"><span class="plus">${SVG_PLUS}</span><div id="prompt-textarea" contenteditable="true"></div><button class="send" type="button" aria-label="Send">${SVG_SEND}</button></div></form>
  </main>
</div>
</body></html>`;
}
