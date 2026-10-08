// RTLY content script: sets text direction and the IranYekan font on supported
// AI chat sites. Performance-sensitive and domain-gated.
//
// Per-site selectors and flags live in content/sites/*.js (loaded first, they
// fill window.RTLY_SITE_CONFIG). The extension version comes from the manifest.
//
// Source: https://github.com/ehsanenaloo/RTLY
const DEBUG = false;
const log = (...args) => DEBUG && console.debug("[RTLY]", ...args);



// ----- Early domain gate -----
const TARGET_DOMAINS = [
  "chat.openai.com",
  "chatgpt.com",
  "claude.ai",
  "copilot.microsoft.com",
  "copilot.com",
  "gemini.google.com",
  "perplexity.ai",
  "aistudio.google.com",
  "poe.com",
  "grok.com",
  "chat.z.ai",
  "z.ai",
  "notebooklm.google.com",
  "chat.deepseek.com",
  "qwen.ai",
  // Note: chat.qwen.ai is intentionally NOT a separate TARGET_DOMAINS entry.
  // hostname "chat.qwen.ai" matches "qwen.ai" via `.endsWith(".qwen.ai")`,
  // so listing it twice would be unreachable. CANONICAL keeps the explicit
  // chat.qwen.ai → qwen.ai mapping for storage canonicalization regardless.
  "bing.com",
  "mistral.ai",
  "huggingface.co",
  "cohere.com",
];

const CANONICAL = {
  "chat.openai.com": "chatgpt.com",
  "www.chat.openai.com": "chatgpt.com",
  "www.copilot.microsoft.com": "copilot.microsoft.com",
  "copilot.com": "copilot.microsoft.com",
  "www.copilot.com": "copilot.microsoft.com",
  "www.gemini.google.com": "gemini.google.com",
  "www.qwen.ai": "qwen.ai",
  "chat.qwen.ai": "qwen.ai",
  "chat.z.ai": "z.ai",
  "www.bing.com": "bing.com",
};

const hostname = location.hostname;
// Tightened from `includes` to exact / proper-subdomain match — defense in depth.
// manifest matches already constrain origins, but this prevents accidental matches
// on hosts like "claude.ai.attacker.com" if anything ever bypasses the manifest.
const siteKey = TARGET_DOMAINS.find((d) => hostname === d || hostname.endsWith("." + d));
const canonicalSite = siteKey ? CANONICAL[siteKey] || siteKey : null;

// NOTE: the domain gate + bootstrap() invocation live at the VERY END of this
// file. Invoking bootstrap() here ran applyGlobalFontScale() synchronously
// (before the first `await`) while FONT_STACK / SETTINGS / CONFIG were still in
// their temporal dead zone — throwing a ReferenceError that was silently
// swallowed by the try/catch. Running the gate last guarantees every const/let
// is initialized before bootstrap() touches it.

// ---------- Config ----------
// فونت ثابت: ایران‌یکان برای همهٔ سایت‌ها
const FONT_STACK = "'IranYekan', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// Per-site config registry, populated by content/sites/*.js (loaded before
// this file by the manifest). In production it holds only the current site's
// entry — fine, because every per-site check below is against siteKey.
const SITE_CFG = (typeof window !== "undefined" && window.RTLY_SITE_CONFIG) || {};

// Per-site behavior flags now live as declarative properties in the site
// modules (v1.9.19). These Sets are derived from those flags so the existing
// `.has(siteKey)` call sites stay byte-for-byte unchanged. Each flag's meaning
// is documented in content/sites/<name>.js.
const sitesWithFlag = (flag) => new Set(Object.keys(SITE_CFG).filter((k) => SITE_CFG[k] && SITE_CFG[k][flag]));
const LAYOUT_LTR_SITES = sitesWithFlag("layoutLtr");               // top-level layout stays LTR
const HEURISTIC_FA_SCAN_SITES = sitesWithFlag("heuristicFaScan");  // extra "scan anything Persian" pass
const NARROW_ICON_SITES = sitesWithFlag("narrowIcons");            // icon guard limited to interactive controls
const CLEANUP_STALE_MARK_SITES = sitesWithFlag("cleanupStaleMark");// bootstrap stale-mark sweep
const COMPREHENSIVE_SELECTOR_SITES = sitesWithFlag("comprehensiveSelectors"); // response selectors cover the whole conversation → skip the generic whole-main fallback FA scan

let SETTINGS = {
  fontScale: 100,
  siteModes: {},
};

// v1.9.20: set true only once initRTLY() runs (i.e. after the per-site
// enabled check passes). Gates page-level font scaling and live mode reapply
// so neither takes effect on a domain the user has disabled RTLY for.
let rtlyActive = false;

function getPreferredFontFamily() {
  return FONT_STACK;
}

// ---------- Caches ----------
// isInSidebarOrMenu() and isIcon() both walk ancestors and read computed style.
// They get called many times per cycle from applyDirectionAndFont, processGemini,
// setupResponses, etc. Caching by element via WeakMap turns each into O(1) after
// first call and removes the dominant source of forced reflow.
//
// WeakMap auto-evicts when the element is GC'd, so caches don't leak even on
// long-lived SPA tabs that churn through thousands of message nodes.
const sidebarCache = new WeakMap();
const iconCache = new WeakMap();
const skipFontCache = new WeakMap();

// Cache buster — bumped on settings change or SPA navigation so cached results
// don't outlive layout/structural changes that could affect ancestor checks.
let cacheGeneration = 0;
function bustCaches() {
  cacheGeneration++;
  // WeakMap has no .clear(); we discriminate by checking generation tag on values.
}

// ---------- Teardown registry ----------
// All long-lived observers and intervals register here. v1.9.10: wired to
// `pagehide` so that on page unload / bfcache eviction / extension reload
// the registry is flushed explicitly. Browsers auto-clean observers when
// the page detaches, but explicit teardown is defensive and makes the
// trackObserver/trackInterval wrappers actually do something — earlier
// versions registered handlers but never called runTeardown, so the
// "tear down on navigation" intent from the original comment never fired.
// We deliberately do NOT bind runTeardown to `rtly:navigation`: SPA route
// changes within the same document need the observers to KEEP running.
const teardownHandlers = [];
function registerTeardown(fn) {
  if (typeof fn === "function") teardownHandlers.push(fn);
}
function trackInterval(id) {
  registerTeardown(() => clearInterval(id));
  return id;
}
const trackedObservers = new Set();
function trackObserver(obs) {
  trackedObservers.add(obs);
  registerTeardown(() => { try { obs.disconnect(); } catch (_) {} trackedObservers.delete(obs); });
  return obs;
}
// Disconnect an observer whose target is gone (e.g. a composer re-mounted by an SPA route).
function releaseObserver(obs) {
  try { obs.disconnect(); } catch (_) {}
  trackedObservers.delete(obs);
}
function runTeardown() {
  while (teardownHandlers.length) {
    const fn = teardownHandlers.pop();
    try { fn(); } catch (_) {}
  }
}
// Wire teardown to pagehide. `{ once: true, capture: true }` keeps the
// listener cheap and guarantees it runs even if other code stopPropagates
// pagehide higher up in the DOM (rare, but defensive).
try {
  // Skip teardown when the page is entering the back/forward cache: it may be
  // restored with its DOM intact, and the observers must keep running then.
  window.addEventListener("pagehide", (e) => { if (!e.persisted) runTeardown(); }, { capture: true });
} catch (_) {}

function loadSettings() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) {
      resolve();
      return;
    }
    chrome.storage.local.get(
      ["fontScale", "siteModes"],
      (r) => {
        if (!chrome.runtime?.lastError && r) {
          if (r.fontScale !== undefined) SETTINGS.fontScale = Number(r.fontScale) || 100;
          if (r.siteModes && typeof r.siteModes === "object") SETTINGS.siteModes = r.siteModes;
        }
        applyGlobalFontScale();
        resolve();
      }
    );
  });
}

function getCanonicalSiteMode() {
  const modes = SETTINGS.siteModes || {};
  const direct = modes[canonicalSite];
  if (direct) return direct;
  if (canonicalSite === "chatgpt.com") return modes["chat.openai.com"];
  return undefined;
}

function getEffectiveMode() {
  const perSite = getCanonicalSiteMode();
  if (perSite === "font_only" || perSite === "rtl_only" || perSite === "full") return perSite;
  // Default: apply both font and direction. Per-site mode chips in the popup
  // override this. The legacy global liteMode toggle was removed in 1.8 — its
  // function is fully covered by the per-site "rtl_only" mode.
  return "full";
}

function applyGlobalFontScale() {
  try {
    const root = document && document.documentElement ? document.documentElement : null;
    if (!root) return;

    const scale = (SETTINGS && SETTINGS.fontScale) || 100;
    root.style.setProperty("--rtly-font-scale", String(scale));

    // Apply scale ONCE on :root so child em/rem values cascade naturally without
    // compounding. Only when scale != 100 to avoid disturbing default UA size.
    //
    // Use percentage rather than `calc(16px * scale/100)` — the latter forces
    // base to 16px and overrides a user's accessibility-adjusted browser
    // default font size. Percentage scales relative to whatever the user has
    // configured, preserving their setup.
    // v1.9.20: apply the page-level font-size override ONLY when RTLY is
    // active on this site. Previously applyGlobalFontScale ran at
    // document_start (and again in loadSettings) BEFORE the per-site enabled
    // check, so a site the user had explicitly disabled still got zoomed
    // whenever the global fontScale != 100. The :root vars below stay set
    // unconditionally (harmless — nothing reads them unless active).
    if (rtlyActive && scale !== 100) {
      root.style.setProperty("font-size", `${scale}%`, "important");
    } else {
      root.style.removeProperty("font-size");
    }

    root.style.setProperty("--rtly-font-family", FONT_STACK);
  } catch (e) {
    log("applyGlobalFontScale error", e);
  }
}

const CONFIG = {
  OBSERVER_CONFIG: { childList: true, subtree: true },
  // SITES is now assembled from per-site modules in content/sites/*.js,
  // which the manifest loads BEFORE content.js and which populate
  // window.RTLY_SITE_CONFIG. This keeps each site’s selectors in its own
  // file (mirroring assets/css/sites/) instead of one monolithic literal.
  SITES: SITE_CFG,
};

// ---------- Language Detection (Persian, Arabic, Hebrew, Urdu) ----------
// Single broad-script regex used by guards that ask "does this text contain
// any RTL script at all?" (e.g. copy preservation, sidebar overrides).
// Per-character direction tallying is done inline in detectDirection() for
// performance — see comment there.
const AR_FA_WORD = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u07C0-\u07FF\u0800-\u085F\u0870-\u089F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]|[\u{1E900}-\u{1E95F}]/u;
// v1.8.16: Arabic-script grammatical markers. These NEVER appear in pure-LTR
// text and are shared by ALL languages using the Arabic script — Arabic,
// Persian, Urdu, Pashto, Sindhi, Sorani Kurdish, Uyghur, etc. — so this
// marker set benefits every user of these languages equally, not just
// Persian speakers.
//   • Arabic comma (،, U+060C), Arabic semicolon (؛, U+061B),
//     Arabic question mark (؟, U+061F)
//   • tashkil / harakat / e'rab — fatha, kasra, damma, shadda, sukun, etc.
//     (U+064B-U+064E, U+0650-U+0652). Universally used across the
//     Arabic-script world; common in Quranic / vocalized Arabic and as
//     ezafe (ـِ) in Persian / Urdu.
//   • ZWNJ نیم‌فاصله (U+200C) — used in Persian, Urdu, Pashto, and others
//     to join/separate letter forms inside compound words.
// Presence is a STRONG grammatical signal that the surrounding text is in
// an RTL-script language, even when CamelCase technical identifiers
// dominate the character count (e.g. "به cluster waveِ 03B منتقل شد" — only
// 25.7% RTL by character count but unambiguously Persian to a reader,
// because of the kasra after "wave"). When any of these are present, lower
// the detection threshold so such sentences flip to RTL instead of being
// misclassified as LTR.
//
// Naming note (v1.8.16 rename): previously called FA_STRONG_MARKER which
// wrongly implied Persian-only. Renamed to AR_FA_STRONG_MARKER to reflect
// that every Arabic-script language benefits — no behaviour change.
const AR_FA_STRONG_MARKER = /[\u060C\u061B\u061F\u0650-\u0652\u064B-\u064E\u200C]/u;
const RLE = "\u202B"; // Unicode Right-to-Left Embedding

function detectDirection(text = "") {
  if (!text || !text.trim()) return "none";

  // v1.7: character-based detection.
  //
  // Why characters, not words?
  //   * Word counting biases toward short words. "Ok hi سلام دنیای زیبا"
  //     comes out 2 EN / 3 FA by word count (close call), but 6 EN chars /
  //     14 FA chars by character count (clearly RTL). The character ratio
  //     matches the reader's perception of which language dominates.
  //   * Persian uses ZWNJ (U+200C) inside compound expressions so a single
  //     "Persian word" can span what would be multiple English-style words.
  //     Character count avoids that tokenization noise.
  //
  // Why 30% threshold (not 50%)?
  //   Persian users routinely embed English tech terms (React, Docker, npm).
  //   With a strict 50% cutoff, "Run npm install را اجرا کن" (41% Persian
  //   chars) flips to LTR — but the user reads the sentence as Persian
  //   grammar and wants RTL. 30% gives borderline mixed text the benefit
  //   of the doubt and renders it as the user's primary language. Pure
  //   English (0% Persian) is unaffected.
  //
  // v1.8.15: Marker-aware threshold (20% when an Arabic-script grammatical
  // marker is present). Even 30% misses sentences dense with CamelCase API
  // names — e.g. "scope: ۵ متد (getContacts حذف شد، به cluster waveِ 03B
  // منتقل شد): getContactIDs, search, getBlocked, resolvePhone,
  // resolveUsername — هرکدام endpointِ verb-specificِ یکتا دارد." This is
  // 25.7% Persian by character count, well under 30%, but the kasra after
  // "wave"/"endpoint" and the Arabic comma make it unambiguously RTL. When
  // at least one such marker is present, we drop the bar to 20%. Pure LTR
  // text never contains these markers, so this carries zero false-positive
  // risk for English-only content. The check is regex-test on the full
  // string (O(n) with early exit on first match) — cheap on top of the
  // existing scan.
  //
  // Coverage: the marker set is universal across Arabic-script languages —
  // Arabic, Persian, Urdu, Pashto, Sindhi, Sorani Kurdish, Uyghur — so this
  // benefits every RTL user, not just Persian speakers.
  //
  // Numbers and punctuation are excluded — they're direction-neutral; the
  // browser's Unicode Bidirectional Algorithm places them correctly at
  // render time once the block-level direction is set.
  //
  // v1.7.4: single-pass count. Two separate `text.match(regex)` calls
  // allocate intermediate arrays and traverse the text twice. A char-by-char
  // loop with the same Unicode ranges is faster on long messages and
  // produces zero GC pressure.
  let rtlChars = 0;
  let ltrChars = 0;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    // ASCII letter ranges first (most common in mixed text, fast path)
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      ltrChars++;
      continue;
    }
    // Arabic + Persian + Hebrew + supplements + presentation forms + (v1.9.18)
    // the remaining Unicode RTL scripts, kept in sync with AR_FA_WORD so the
    // ratio actually counts what the presence-test matches. Without this,
    // Dhivehi/Syriac/N'Ko/Adlam text was matched by AR_FA_WORD but scored 0
    // RTL chars here → detectDirection returned "none" → no RTL applied.
    if (
      (c >= 0x0590 && c <= 0x05FF) || // Hebrew
      (c >= 0x0600 && c <= 0x06FF) || // Arabic
      (c >= 0x0700 && c <= 0x074F) || // Syriac
      (c >= 0x0750 && c <= 0x077F) || // Arabic Supplement
      (c >= 0x0780 && c <= 0x07BF) || // Thaana (Dhivehi)
      (c >= 0x07C0 && c <= 0x07FF) || // NKo
      (c >= 0x0800 && c <= 0x085F) || // Samaritan + Mandaic
      (c >= 0x0870 && c <= 0x089F) || // Arabic Extended-B
      (c >= 0x08A0 && c <= 0x08FF) || // Arabic Extended-A
      (c >= 0xFB50 && c <= 0xFDFF) || // Arabic Presentation Forms-A
      (c >= 0xFE70 && c <= 0xFEFF)    // Arabic Presentation Forms-B
    ) {
      rtlChars++;
    } else if (c === 0xD83A && i + 1 < len) {
      // Adlam lives in the astral plane (U+1E900–1E95F) → a surrogate pair
      // whose high half is 0xD83A and low half is 0xDD00–0xDD5F. charCodeAt
      // only sees code units, so detect the pair explicitly and skip the low
      // half so it isn't miscounted.
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xDD00 && lo <= 0xDD5F) {
        rtlChars++;
        i++;
      }
    }
  }
  const totalScripted = rtlChars + ltrChars;
  if (!totalScripted) return "none";
  // v1.8.15: lower threshold to 20% when an Arabic-script grammatical marker
  // is present (see AR_FA_STRONG_MARKER definition + the long comment above).
  const threshold = AR_FA_STRONG_MARKER.test(text) ? 0.20 : 0.30;
  return rtlChars / totalScripted >= threshold ? "rtl" : "ltr";
}

function isIcon(el) {
  if (!el || el.nodeType !== 1) return true;
  // Cached?
  const cached = iconCache.get(el);
  if (cached !== undefined && cached.gen === cacheGeneration) return cached.value;

  const result = computeIsIcon(el);
  iconCache.set(el, { value: result, gen: cacheGeneration });
  return result;
}

function computeIsIcon(el) {
  const tag = el.tagName.toLowerCase();
  if (["svg", "img", "picture", "canvas", "video", "i", "path", "use", "symbol", "mat-icon"].includes(tag)) return true;
  const cls = (el.className || "").toString();
  // Class-based icon families. Each entry is a "word" within the class string
  // (delimited by start, whitespace, or hyphen). New (v1.8.20): lumi-symbols,
  // lm-icon (Gemini's current Lumi icon system), mat-ligature-font (Angular
  // Material font-icon marker), google-symbols. New (v1.6.0): material-symbols,
  // anthropicon, ms-Icon (Microsoft Fluent), fluent-icon, tabler-icon, phosphor.
  if (/(^|[\s-])(icon|material-icons|material-symbols|google-symbols|lumi-symbols|lm-icon|mat-icon|mat-ligature-font|fa-|bi-|ri-|lucide|glyph|anticon|MuiSvgIcon|anthropicon|ms-Icon|fluent-icon|tabler-icon|phosphor)([\s-]|$)/i.test(cls))
    return true;
  // SVG-named classes
  if (/(^|\s)svg-icon\b/i.test(cls) || /\bicon-svg\b/i.test(cls)) return true;
  // Data attributes used as icon markers by various design systems.
  // - data-icon       (generic, also FontAwesome React)
  // - data-cds        (Anthropic CDS: data-cds="Icon")
  // - data-icon-name  (Microsoft Fluent UI)
  // - data-lucide     (Lucide React)
  // - data-mat-icon-name / data-mat-icon-type (Angular Material)
  if (el.dataset) {
    if (el.dataset.icon !== undefined) return true;
    if (el.dataset.cds === "Icon" || el.dataset.cds === "icon") return true;
    if (el.dataset.iconName !== undefined) return true;
    if (el.dataset.lucide !== undefined) return true;
    if (el.dataset.matIconName !== undefined) return true;
    if (el.dataset.matIconType !== undefined) return true;
  }
  const role = el.getAttribute("role");
  if (role === "img") return true;
  // Inline style first — catches Anthropicons et al. even when the CSS var
  // hasn't been resolved (or has been resolved to a different name) yet.
  try {
    const inlineStyle = el.getAttribute("style") || "";
    if (/anthropicons|material[- ]?(icons|symbols)|google[- ]?symbols|lumi[- ]?symbols|luminous[- ]?symbols|font[- ]?awesome|FluentSystemIcons|remixicon|feather|icomoon|glyphicon|phosphor|tabler-icons/i.test(inlineStyle)) {
      return true;
    }
  } catch (e) {}
  // v1.9.28: REMOVED the `getComputedStyle(el).fontFamily` fallback that used to
  // live here. A DevTools trace of a long ChatGPT thread showed computeIsIcon
  // forcing 143 synchronous style recalcs totalling ~37.5s — essentially the
  // entire freeze. The pattern was layout thrashing: applyDirectionAndFont writes
  // inline styles (direction / font-family), which dirties the style tree; the
  // next element's isIcon() then called getComputedStyle, forcing the browser to
  // re-resolve styles for the WHOLE dirtied DOM before returning — on a long
  // thread ~hundreds of ms each, hundreds of times. The iconCache only helped
  // repeat visits to the SAME element; across thousands of distinct elements
  // each first read after a write forced a full recalc. The computed-font check
  // only caught icons whose icon-font is applied purely by a stylesheet rule
  // (no class / data-* / inline-style marker) — vanishingly rare on modern sites
  // (Anthropic CDS, Material, Lucide, Fluent all carry a class or data attribute,
  // already matched above). Dropping it removes the only forced-style-read in the
  // hot path, with negligible detection loss and no other reflow source left.
  return false;
}

// Selectors that strongly indicate sidebar / nav / menu / toolbar context.
// Hoisted out of the function so the regex/array isn't rebuilt on every call.
// The selector list is the primary signal; we deliberately do NOT use
// getBoundingClientRect / getComputedStyle position heuristics because:
//   1. They force layout flush — the dominant source of jank on Gemini/Claude.
//   2. The viewport-position logic ("right 30% of screen = sidebar") is
//      LTR-only and misclassifies wide RTL chat messages as sidebars.
//   3. Modern sidebars all have semantic markers (nav/aside/role) that the
//      selector list already catches.
const SIDEBAR_SELECTOR_LIST = [
  "nav",
  "aside",
  "header",
  "[role='navigation']",
  "[role='menu']",
  "[role='menubar']",
  "[role='complementary']",
  "[role='banner']",
  "[role='toolbar']",
  ".sidebar",
  ".side-bar",
  ".navigation",
  ".nav",
  ".menu",
  ".toolbar",
  ".mdc-top-app-bar",
  ".profile",
  ".settings",
  ".history",
  ".user-menu",
  ".account-menu",
  "[data-testid*='sidebar']",
  "[data-testid*='nav']",
  "[data-testid*='menu']",
  "[data-testid*='profile']",
  "[data-testid*='settings']",
  "[data-testid*='history']",
  "[data-testid*='user']",
  "[data-qa*='sidebar']",
  "[data-qa*='nav']",
  "[data-qa*='menu']",
  "[aria-label*='navigation' i]",
  "[aria-label*='menu' i]",
  "[aria-label*='sidebar' i]",
  "[aria-label*='profile' i]",
  "[aria-label*='settings' i]",
  "[aria-label*='history' i]",
  "[class*='sidebar' i]",
  "[class*='Sidebar' i]",
  "[class*='navigation' i]",
  "[class*='Navigation' i]",
  "[class*='menu' i]",
  "[class*='Menu' i]",
  "[class*='nav' i]",
  "[class*='Nav' i]",
];
const SIDEBAR_SELECTOR = SIDEBAR_SELECTOR_LIST.join(",");
const CHAT_CONTEXT_SELECTOR =
  "article, [role='article'], .message, [data-message], [data-testid*='message'], [data-qa*='message'], " +
  // 1.8.7: new Claude chat-ui-core message containers
  ".font-claude-response, .font-claude-message, .standard-markdown, [data-test-render-count], " +
  // v1.9.9: z.ai user-message bubble has no semantic class — only the
  // `data-expanded` attribute identifies it. Including it here means any
  // ancestor that happened to match SIDEBAR_SELECTOR (e.g. a tailwind class
  // containing the substring `nav` or `menu`) doesn't strip direction from
  // the bubble subtree.
  "[data-expanded]";

function isInSidebarOrMenu(el) {
  if (!el) return false;
  const cached = sidebarCache.get(el);
  if (cached !== undefined && cached.gen === cacheGeneration) return cached.value;
  const value = computeIsInSidebarOrMenu(el);
  sidebarCache.set(el, { value, gen: cacheGeneration });
  return value;
}

function computeIsInSidebarOrMenu(el) {
  // 1.8.10: the composer / any text input is NEVER a sidebar or menu.
  // A wrapper around the input often carries a utility class that matches the
  // broad sidebar selector list (e.g. something with "nav"/"menu") or a
  // role="toolbar" on the formatting bar. When that happens the element gets
  // classified as a menu, menu-protection strips `dir` from the input and its
  // paragraphs, and the editor (ProseMirror) immediately re-asserts its own
  // `dir` on the next transaction — an endless dir add/remove fight that shows
  // up as the spellcheck underline flickering. Worse, the result is cached
  // per-element and depends on whatever the DOM looked like at first
  // evaluation, so two tabs of the same site can disagree about whether RTL
  // applies. Exempt the whole editable subtree unconditionally and up front.
  if (el.closest &&
      el.closest('textarea, [contenteditable="true"], [contenteditable=""]')) {
    return false;
  }

  // 1.8.7: Claude (chat-ui-core refactor) — known chat-message containers and
  // their descendants are unambiguously NOT sidebar/menu. Bypass the broad
  // attribute/class heuristics that occasionally match Tailwind utility names
  // like `nav` / `menu` inside the conversation tree.
  if (siteKey === "claude.ai" &&
      el.closest &&
      el.closest('[data-testid="user-message"], .font-claude-response, .font-claude-message, .standard-markdown, [data-test-render-count]')) {
    return false;
  }

  // v1.9.34: Claude ask_user_input choice card is NOT a menu. Diagnosed live:
  // the card's option rows were being classified as sidebar/menu because a
  // composer-region ancestor (a bare `<div class="h-full">`) sits inside an
  // element matching `[data-testid*='nav']` — the broad heuristic then skipped
  // the whole card, so markClaudeChoiceCards() bailed on every row and the rows
  // never got data-rtly-card-rtl. The card has a stable marker on its root,
  // [data-ask-user-input-banner]; anything inside it is card content, never
  // navigation. Exempt it explicitly (same pattern as the chat-message bypass
  // above).
  if (siteKey === "claude.ai" &&
      el.closest &&
      el.closest('[data-ask-user-input-banner]')) {
    return false;
  }

  // 1.8.9: Claude sidebar chat-history items — when the row's text is Persian
  // (a Persian chat title the user named), allow direction setting so the
  // title is right-aligned. English / English-majority titles stay LTR
  // (sidebar layout protection still wins for them). Same pattern as the
  // Perplexity branch below.
  if (siteKey === "claude.ai") {
    const row = el.closest && el.closest("li, a");
    if (row) {
      const rowText = (row.innerText || row.textContent || "").trim();
      if (rowText && AR_FA_WORD.test(rowText)) {
        // Compute Persian dominance the same way detectDirection does —
        // mixed-mostly-Persian counts as Persian for sidebar titles too.
        let r = 0, l = 0;
        for (let i = 0; i < rowText.length; i++) {
          const c = rowText.charCodeAt(i);
          if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) l++;
          else if ((c >= 0x0590 && c <= 0x06FF) || (c >= 0xFB50 && c <= 0xFEFF)) r++;
        }
        if (r + l > 0 && r / (r + l) >= 0.30) return false;
      }
    }
  }

  // Perplexity: sidebar nav/menu items stay LTR, but Persian history items
  // become RTL.
  if (siteKey === "perplexity.ai" && el.closest && el.closest("[class*='group/sidebar']")) {
    const item = el.closest("a, button");
    if (!item) return true; // container blocks should never drive direction
    const itemText = (item.innerText || item.textContent || "").trim();
    if (!itemText) return true;
    return !AR_FA_WORD.test(itemText); // English menu => skip direction, Persian history => allow
  }

  // Single ancestor walk against the combined selector list.
  // This replaces the previous loop of ~30 individual `.closest()` calls.
  const closest = el.closest && el.closest(SIDEBAR_SELECTOR);
  if (!closest) return false;

  // If the sidebar-flagged ancestor is itself nested inside a chat message,
  // the element is part of the message — not a sidebar item. Don't skip.
  if (closest.closest && closest.closest(CHAT_CONTEXT_SELECTOR)) return false;

  return true;
}

function shouldSkipFont(el) {
  if (!el) return true;
  const cached = skipFontCache.get(el);
  if (cached !== undefined && cached.gen === cacheGeneration) return cached.value;
  const value = computeShouldSkipFont(el);
  skipFontCache.set(el, { value, gen: cacheGeneration });
  return value;
}

function computeShouldSkipFont(el) {
  if (isIcon(el)) return true;
  // Element is an icon-font container: applying IranYekan would replace the
  // ligature glyph (e.g. "menu" → hamburger icon) with literal text.
  try {
    const cls = (el.className || "").toString();
    if (/(^|\s)material-icons(\s|$)/i.test(cls)) return true;
    if (/material-symbols/i.test(cls)) return true;
    if (/google-symbols/i.test(cls)) return true;
    if (/lumi-symbols/i.test(cls)) return true;
    if (/(^|\s)lm-icon(-|\s|$)/i.test(cls)) return true;
    if (/mat-ligature-font/i.test(cls)) return true;
    if (/(^|\s)mat-icon(\s|$)/i.test(cls)) return true;
    if (/(^|\s)anticon(\s|$)/i.test(cls)) return true;
    if (/anthropicon/i.test(cls)) return true;
  } catch (_) {}
  // Anthropic CDS icon shell — never paint our font over the icon container
  try {
    if (el.dataset && (el.dataset.cds === "Icon" || el.dataset.cds === "icon")) return true;
    const inlineStyle = el.getAttribute && el.getAttribute("style");
    if (inlineStyle && /anthropicons/i.test(inlineStyle)) return true;
  } catch (_) {}
  // Element has ONLY icon/SVG children (icon-only button) — don't paint font on it
  try {
    const tag = el.tagName;
    if (tag === "BUTTON" || tag === "A") {
      const kids = Array.from(el.children || []);
      if (kids.length && kids.every((k) => isIcon(k) || k.querySelector?.("svg, img"))) {
        const txt = (el.innerText || el.textContent || "").trim();
        if (!txt) return true; // icon-only button, no label
      }
    }
  } catch (_) {}
  // Don't skip font for menus - we want to apply font to menus, just not direction
  if (siteKey === "notebooklm.google.com") {
    if (el.closest("header, [role='toolbar'], .toolbar, .mdc-top-app-bar")) return true;
  }
  return false;
}

function applyDirectionAndFont(el) {
  try {
    if (!el || !el.nodeType || el.nodeType !== 1) return;
    // --- Reflow-free fast-skip (v1.9.20) ---------------------------------
    // The generic per-mutation rescan (ChatGPT, Poe, Copilot, AI Studio,
    // Qwen, misc — every site without a special processing branch) calls
    // applyDirectionAndFont on EVERY descendant of EVERY matched message on
    // EVERY observer tick. The body of this function then reads el.innerText
    // (a forced synchronous reflow) before its "already processed, unchanged"
    // guard could bail. On a long ChatGPT conversation that is thousands of
    // reflows per 400ms tick during streaming/scroll — the page hang the
    // user reported. textContent is reflow-free, so if this element was
    // already fully processed and its raw text is byte-identical to last
    // time, bail now WITHOUT forcing layout.
    //
    // rtlyTc is written ONLY on the completed text path (and the large-
    // container branch) below — never on the icon / input / wrapper / menu
    // branches — so elements handled there (rtlyProcessed but no rtlyTc) do
    // not short-circuit here and keep their existing behavior. reapplyRTLY()
    // strips rtlyTc, so a mode change still forces a full reprocess.
    //
    // Gemini is exempt: its optimized path intentionally re-applies styles
    // every pass (the site strips inline styles), and it is already bounded
    // by per-pass caps + requestIdleCallback, so it can't hang.
    if (siteKey !== "gemini.google.com" &&
        el.dataset && el.dataset.rtlyProcessed === "1" &&
        el.dataset.rtlyTc !== undefined &&
        (el.textContent || "") === el.dataset.rtlyTc) {
      return;
    }
    // Perplexity: never set direction on wrappers that contain the sidebar.
    // This prevents flipping the whole menu section while allowing per-item RTL.
    if (siteKey === "perplexity.ai" && typeof el.querySelector === "function") {
      if (el.querySelector("[class*='group/sidebar']")) return;
    }
    // DeepSeek/Z.ai: never set direction on body, html, or any layout ancestor of sidebar
    // DeepSeek uses divs (not aside/nav) - detect layout by "New chat" + chat content
    if (LAYOUT_LTR_SITES.has(siteKey)) {
      if (el === document.body || el === document.documentElement) return;
      if (typeof el.querySelector === "function") {
        const hasSidebarLike = !!el.querySelector(
          "nav, aside, [role='navigation'], [role='menu'], [class*='sidebar' i], [class*='Sidebar' i], [class*='menu' i]"
        );
        const hasChatLike = !!el.querySelector(
          "article, [role='article'], [data-message], [data-testid*='message'], textarea, [contenteditable='true'], main, [role='main'], .ds-message"
        );
        if (hasSidebarLike && hasChatLike) return;
        if (hasSidebarLike) return;
        // DeepSeek: layout has "New chat" + chat area but no aside/nav - skip dir on these
        const text = (el.innerText || el.textContent || "").slice(0, 500);
        const hasNewChat = /new\s*chat/i.test(text) || /چت\s*جدید/i.test(text);
        const hasDeepSeekLayout = hasNewChat && (el.querySelector("textarea, .ds-message, [class*='ds-scroll-area']") || el.childElementCount >= 2);
        if (hasDeepSeekLayout) return;
      }
    }
    
    // Check if element is in sidebar/menu - if so, only apply font, not direction
    const inMenu = isInSidebarOrMenu(el);
    const fontFamily = getPreferredFontFamily();
    const applyFontOnly = (target) => {
      if (shouldSkipFont(target)) return;
      // v1.8.17: gate font application on the target's CURRENT text. IranYekan
      // is an Arabic-script face whose Latin glyphs have ascent/descent
      // metrics different from typical site fonts (Söhne on ChatGPT,
      // ABC Diatype on Claude, etc.). Painting it over a textarea containing
      // only English caused visible vertical-baseline shift — descenders of
      // "j" / "g" / "p" rendered at a different Y position than the textarea's
      // native baseline. Restrict the paint to elements whose text actually
      // contains Arabic-script characters; when text becomes Latin-only
      // (user clears Persian and types English), strip any IranYekan we
      // applied earlier so the site's metrics are fully restored.
      //
      // Text source: el.value for <textarea>/<input> (replaced elements whose
      // textContent does NOT reflect their value); textContent for everything
      // else (cheap, no reflow — innerText would force layout).
      //
      // Empty text → wantFont is false → no paint, no harm. First Persian
      // keystroke triggers the next mutation cycle which re-paints.
      const txt = target.value !== undefined
        ? target.value
        : (target.textContent || "");
      const wantFont = AR_FA_WORD.test(txt);
      const applied = (target.style.fontFamily || "").includes("IranYekan");
      if (wantFont && !applied) {
        target.style.setProperty("font-family", fontFamily, "important");
      } else if (!wantFont && applied) {
        target.style.removeProperty("font-family");
      }
      // NOTE: font-size scaling is intentionally NOT applied per-element here.
      // Using `1em * scale` recursively compounded across nested elements
      // (e.g. message > p > span > strong in Claude). Scale is applied once on
      // :root via applyGlobalFontScale() — child elements using rem/em scale
      // proportionally, and px-based UIs are left untouched.
    };

    // v1.7: input-like elements get native bidi handling instead of our
    // majority-based detection. Reasoning:
    //   * For a static AI response (output), the full text is known, so
    //     majority-based detection gives the best "whole message" reading.
    //   * For a live input where the user is typing, the text changes on
    //     every keystroke. Re-running detection per keystroke is wasteful;
    //     more importantly, our majority logic gives a single direction
    //     for the whole field, which mis-renders mixed-language drafts.
    //   * Browser-native dir="auto" + unicode-bidi: plaintext (from CSS)
    //     auto-detects direction per line using the Unicode Bidirectional
    //     Algorithm's P2 rule (first strong directional character). This
    //     is exactly the UX users want when composing mixed-language text:
    //     start typing Persian → line is RTL; start a new line in English
    //     → that line is LTR; no manual switching needed.
    // We still apply the font; CSS handles the rest.
    const tagLower = (el.tagName || "").toLowerCase();
    const ceAttr = el.getAttribute && el.getAttribute("contenteditable");
    const isInputLike =
      tagLower === "textarea" ||
      tagLower === "input" ||
      ceAttr === "true" ||
      ceAttr === "";
    if (isInputLike) {
      const effectiveMode = getEffectiveMode();
      if (effectiveMode === "full" || effectiveMode === "rtl_only") {
        // Only override if site hasn't already set dir explicitly to a
        // fixed value — preserve site intent where they've thought about it.
        //
        // CRITICAL (1.8.10): also skip when dir is ALREADY "auto". Re-writing
        // an attribute with the SAME value still queues an attribute
        // MutationRecord; the input's MutationObserver was watching
        // `attributes`, caught our own write, and re-entered this function
        // after the 300ms debounce — a self-sustaining loop that runs forever,
        // even when the user isn't typing. Each cycle touches the editable's
        // attributes, forcing the browser to re-run native spellcheck, which
        // is exactly the "red squiggle keeps flickering / input keeps
        // refreshing" symptom. Idempotent writes break the loop.
        const existingDir = el.getAttribute("dir");
        if (existingDir !== "ltr" && existingDir !== "rtl" && existingDir !== "auto") {
          el.setAttribute("dir", "auto");
          // v1.9.21: record that RTLY (not the site) created this dir="auto",
          // so ownership-aware cleanup removes it on teardown — but leaves a
          // NATIVE dir="auto"/ltr/rtl (the existingDir branch above) untouched.
          if (el.dataset.rtlyAutoDir !== "1") el.dataset.rtlyAutoDir = "1";
        }
      }
      if (effectiveMode === "full" || effectiveMode === "font_only") {
        applyFontOnly(el);
      }
      // Guard the marker write too — same-value assignment is still a DOM
      // mutation, and assigning it on every pass kept feeding the loop above.
      if (el.dataset.rtlyProcessed !== "1") el.dataset.rtlyProcessed = "1";
      return;
    }

    // v1.7.1: elements INSIDE an editable container (the <p>s that rich
    // editors create per line) should also defer to the browser's plaintext
    // bidi. If we apply our majority logic and tag them with data-rtly-dir,
    // the [data-rtly-dir]{unicode-bidi:isolate} rule locks the line to one
    // direction — and that lock outlasts the content. (Type Persian, then
    // clear and type English: the line stays RTL because the isolate +
    // direction:rtl combination ignores the new first-strong char.)
    //
    // Inside an editable, we only apply font and aggressively clean any
    // direction state we may have set in earlier processing. The CSS rule
    // `[contenteditable] * { unicode-bidi: plaintext !important }` then lets
    // each line auto-detect from its own content.
    if (el.closest && el.closest('textarea, [contenteditable="true"], [contenteditable=""]')) {
      if (el.hasAttribute("data-rtly-dir")) {
        el.removeAttribute("data-rtly-dir");
        el.removeAttribute("dir");
        el.style.removeProperty("direction");
        el.style.removeProperty("text-align");
      }
      const effectiveMode = getEffectiveMode();
      if (effectiveMode === "full" || effectiveMode === "font_only") {
        applyFontOnly(el);
      }
      return;
    }

    // v1.7.2: elements that CONTAIN an editable input are layout wrappers
    // around that input. Their `innerText` reflects the input's content,
    // so our majority-based detection picks up whatever the user has typed
    // and slaps direction:rtl on the wrapper. But the wrapper sits in the
    // inheritance chain ABOVE the input, so its direction wins through
    // CSS inheritance and forces the input to render RTL — even though
    // the input itself has dir="auto" and unicode-bidi:plaintext set.
    //
    // Once a wrapper got direction:rtl (because the user typed Persian
    // once), clearing the content and typing English doesn't undo it:
    //   1. The wrapper has data-rtly-processed=1, so the broad scan skips it
    //   2. The wrapper still has Persian-derived direction:rtl inline style
    //   3. The input inherits direction:rtl from the wrapper
    //   4. Result: every line stays RTL forever after first Persian input
    //
    // Fix: wrappers around inputs are TRANSPARENT to us. Don't impose
    // direction on them. Clean any stale state from earlier versions.
    if (el.querySelector &&
        el.querySelector('textarea, [contenteditable="true"], [contenteditable=""]')) {
      // Never set direction on a wrapper. Strip any state we (or an earlier
      // version) imposed so the input below can inherit a neutral context.
      if (el.hasAttribute("data-rtly-dir") ||
          el.hasAttribute("dir") ||
          el.style.direction ||
          el.style.textAlign) {
        el.removeAttribute("data-rtly-dir");
        el.removeAttribute("data-rtly-text");
        el.removeAttribute("data-rtly-processed");
        el.removeAttribute("dir");
        el.style.removeProperty("direction");
        el.style.removeProperty("text-align");
      }
      const effectiveMode = getEffectiveMode();
      if (effectiveMode === "full" || effectiveMode === "font_only") {
        applyFontOnly(el);
      }
      return;
    }

    if (inMenu) {
      applyFontOnly(el);
      return;
    }
    
    // For NotebookLM, only process elements within Chat section
    if (siteKey === "notebooklm.google.com") {
      const selectors = [
        '[aria-label*="Chat" i]',
        '[data-testid*="chat" i]',
        '.conversation',
        '[data-testid*="chat-message"]',
        '.lm-chat-message',
        '.message'
      ];
      let chatContainer = null;
      for (const sel of selectors) {
        try {
          const found = document.querySelector(sel);
          if (found) {
            chatContainer = found.closest('section, [role="region"]');
            if (!chatContainer) {
              chatContainer = found.closest('main > div, main > div > div');
            }
            if (chatContainer) break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (chatContainer && !chatContainer.contains(el)) {
        // Skip if not in Chat section (but allow input boxes in Chat)
        const isInput = el.tagName === "TEXTAREA" || el.getAttribute("contenteditable") === "true";
        if (!isInput) return;
        // For input boxes, check if they're in Chat section
        if (chatContainer && !chatContainer.contains(el)) return;
      }
    }
    
    const effectiveMode = getEffectiveMode();
    // v1.9.26 (ChatGPT freeze / "wait"): textContent, NEVER innerText. innerText
    // forces a synchronous reflow on EVERY element this function processes. On a
    // long thread's first load nothing is fast-skipped yet, so this fired for
    // thousands of elements back-to-back — a multi-second main-thread block, the
    // browser "page unresponsive / wait" dialog. Scrolling re-triggered it via
    // ChatGPT's virtualization (new process() pass → reflow per re-rendered
    // message). The 1.9.20/1.9.22 fast-skips only avoided this read for already-
    // stable elements; they could never help the first pass. detectDirection only
    // needs the RTL/LTR character ratio, which textContent gives reflow-free.
    // el.value is still used for inputs (textContent doesn't reflect a typed
    // value), though input-like elements already return earlier.
    const text = el.value !== undefined ? el.value : (el.textContent || "");
    if (!text?.trim()) return;

    // v1.7.4: large-container guard.
    //
    // When applyDirectionAndFont is called on something like <main> or a top-
    // level message-list wrapper, the text concatenates the entire visible
    // conversation — potentially 100KB+ on a long Claude/Gemini session.
    // Running detectDirection on that:
    //   1. produces a meaningless aggregate result for mixed Persian/English
    //   2. flips the parent container's direction, which then cascades
    //      incorrectly through CSS inheritance.
    //
    // Recursive callers walk children separately, so refusing to set direction
    // on the container doesn't lose coverage — the per-paragraph passes still
    // run.
    if (text.length > 5000) {
      // Still apply font (cheap, idempotent), but never set direction.
      if (effectiveMode === "full" || effectiveMode === "font_only") applyFontOnly(el);
      // v1.9.20: stamp processed + reflow-free text marker so the next
      // observer tick fast-skips this big container (the innerText read above
      // is itself a reflow we want to avoid repeating once the text settles).
      if (el.dataset.rtlyProcessed !== "1") el.dataset.rtlyProcessed = "1";
      const tcLarge = el.textContent || "";
      if (el.dataset.rtlyTc !== tcLarge) el.dataset.rtlyTc = tcLarge;
      return;
    }

    const normalized = text.trim();
    const alreadyDir = el.dataset.rtlyDir;
    const alreadyText = el.dataset.rtlyText === normalized;

    const dir = detectDirection(normalized);
    if (dir === "none") return;

    // For Gemini, always re-apply to ensure styles are set correctly
    // Only skip if text is same AND direction is unchanged AND not Gemini
    if (siteKey !== "gemini.google.com" && alreadyText && alreadyDir === dir) return;

    // Double-check: make absolutely sure this is not a menu element
    if (isInSidebarOrMenu(el)) return;

    // --- Icon-aware direction guard (v1.8.21 — narrowed) ---
    // 1) Never set direction on an SVG/img/icon element itself.
    // 2) For INTERACTIVE controls only (button/a/role=button/menuitem/tab/
    //    chip/list-item), if they contain an icon descendant, don't flip
    //    their direction — flipping would reverse the flex order and move
    //    the icon to the wrong side of its sibling text label.
    //
    // Previous versions (v1.2.6 — v1.8.20) applied this skip to ANY element
    // that contained an icon, including text bubbles like Gemini's new
    // `<user-query>` pill. Those bubbles contain edit/delete mat-icons but
    // are primarily TEXT — they need direction:rtl so the Persian text
    // aligns and wraps correctly. The flex-flip concern is now handled by
    // the CSS `:has(mat-icon) { direction: ltr !important }` rule which
    // targets the descendant controls directly, so the early-return on the
    // parent is no longer required to protect them.
    if (isIcon(el)) {
      if (effectiveMode === "full" || effectiveMode === "font_only") applyFontOnly(el);
      // v1.9.10: guard same-value writes — see the v1.8.10 comment on the
      // input-like branch for the full reasoning. Setting an attribute to its
      // current value still queues a MutationRecord and can feed observer loops.
      if (el.dataset.rtlyProcessed !== "1") el.dataset.rtlyProcessed = "1";
      // v1.9.22: stamp the reflow-free marker so the next observer tick
      // fast-skips this element at the top of the function instead of
      // re-reading innerText.
      const tcIcon = el.textContent || "";
      if (el.dataset.rtlyTc !== tcIcon) el.dataset.rtlyTc = tcIcon;
      return;
    }
    const tagLowerForGuard = (el.tagName || "").toLowerCase();
    const roleForGuard = el.getAttribute && el.getAttribute("role");
    const isInteractiveControl =
      tagLowerForGuard === "button" ||
      tagLowerForGuard === "a" ||
      tagLowerForGuard === "mat-list-item" ||
      tagLowerForGuard === "mat-chip" ||
      tagLowerForGuard === "mat-option" ||
      roleForGuard === "button" ||
      roleForGuard === "menuitem" ||
      roleForGuard === "tab" ||
      roleForGuard === "option";
    // v1.8.24: the narrowing introduced in v1.8.21 (only-guard-interactive-
    // controls) was applied across ALL sites and silently regressed Claude,
    // ChatGPT, etc. — on those sites, a sidebar item div containing an
    // Anthropicons / Lucide / Fluent icon next to a label would now have
    // direction:rtl forced on the parent, reversing the flex order and
    // sending the icon to the wrong side. Gemini compensates via the
    // `.rtly-gemini.rtly-with-rtl :has(mat-icon) { direction:ltr !important }`
    // CSS rule, but no equivalent exists for other sites' icon families.
    //
    // Until each site gets its own :has(.icon-class) CSS protection, the
    // narrowing stays scoped to Gemini only — on every other site we keep
    // the broad pre-v1.8.21 guard, which has years of validation behind it.
    // v1.9.7: extend narrowing to Claude as well. Production diagnostic
    // showed 12/13 .standard-markdown containers with Persian content but
    // no dir="rtl" all had icon descendants (svg copy-button on code
    // blocks, lucide icons in prose, Anthropicons in artifacts). The
    // broad guard was suppressing direction on the entire response body
    // every time it contained any icon — which on Claude is nearly every
    // response. The flex-flip concern that motivated the broad guard is
    // now handled in claude.css via the `:has(svg, [class*="icon" i],
    // [class*="lucide" i], [class*="anthropicon" i])` rule on interactive
    // controls (mirroring Gemini's :has(mat-icon) protection). Both
    // changes must ship together — see the long comment block at the
    // top of the v1.9.7 section in claude.css.
    // v1.9.7-fix: extend narrowing to chat.z.ai / z.ai. Same pattern as the
    // Claude v1.9.7 fix above — user-message bubbles in z.ai carry SVG
    // edit/copy/pencil icons as siblings/children, which makes the broad
    // icon guard suppress direction on the entire bubble. Narrow the guard
    // to interactive controls only, and pair it with the `:has(svg, …)
    // {direction:ltr}` rule on buttons/anchors in grok-zai.css. Both
    // changes ship together — see the long comment block at the top of
    // the z.ai icon-protection section in grok-zai.css.
    const containsIconGate =
      NARROW_ICON_SITES.has(siteKey)
        ? isInteractiveControl
        : true;
    const containsIcon =
      containsIconGate && el.querySelector && !!el.querySelector(
        "svg, img, picture, mat-icon, [data-icon], [data-icon-name], [data-lucide], [data-cds='Icon'], [data-cds='icon'], [data-mat-icon-name], [data-mat-icon-type], [style*='anthropicons' i], [style*='Anthropicons'], [style*='Material Symbols'], [style*='Material Icons'], [style*='Google Symbols'], [style*='Luminous Symbols'], [style*='lumi-symbols' i], [style*='FluentSystemIcons' i], [class*='icon' i], [class*='lucide' i], [class*='anthropicon' i], [class*='material-icons' i], [class*='material-symbols' i], [class*='google-symbols' i], [class*='lumi-symbols' i], [class*='lm-icon' i], [class*='mat-ligature-font' i], [class*='fluent-icon' i], [class*='ms-Icon' i], [class*='ant-icon' i], [class*='tabler-icon' i], [class*='phosphor' i], .anticon"
      );
    if (containsIcon) {
      if (effectiveMode === "full" || effectiveMode === "font_only") applyFontOnly(el);
      // v1.9.10: guard same-value write — see v1.8.10 input-like branch comment.
      if (el.dataset.rtlyProcessed !== "1") el.dataset.rtlyProcessed = "1";
      // v1.9.22 (ChatGPT hang, real fix): stamp the reflow-free marker HERE.
      // This branch is the dominant ChatGPT cost — assistant message containers
      // almost always contain an icon (copy/edit/code-block buttons), so they
      // bailed here EVERY 400ms tick, but only AFTER reading el.innerText (a
      // forced reflow) and running the big subtree icon `querySelector`. Without
      // rtlyTc the top-of-function fast-skip could never catch them. With it, an
      // unchanged icon-bearing container short-circuits reflow-free next tick.
      const tcIcon = el.textContent || "";
      if (el.dataset.rtlyTc !== tcIcon) el.dataset.rtlyTc = tcIcon;
      return;
    }
    // --- end icon guard ---

    // Apply direction only for full or rtl_only
    const applyDir = effectiveMode === "full" || effectiveMode === "rtl_only";
    if (applyDir) {
      el.setAttribute("dir", dir);
      el.style.setProperty("direction", dir, "important");
      // v1.7: use logical `start` instead of physical `right`/`left`.
      // `start` resolves to right when direction is rtl and left when ltr,
      // and follows the direction property automatically — so if a parent's
      // direction ever changes, alignment follows without re-applying.
      el.style.setProperty("text-align", "start", "important");
      if (siteKey === "gemini.google.com") {
        requestAnimationFrame(() => {
          try {
            const computedDir = getComputedStyle(el).direction;
            if (computedDir !== dir) {
              el.style.setProperty("direction", dir, "important");
              el.style.setProperty("text-align", "start", "important");
            }
          } catch (e) {}
        });
      }
    }
    
    // Apply font for full or font_only
    if (effectiveMode === "full" || effectiveMode === "font_only") applyFontOnly(el);
    
    // Mark as processed.
    //
    // v1.9.10: guard same-value writes. Setting `el.dataset.foo = "1"` when
    // the underlying `data-foo="1"` attribute already exists still produces a
    // MutationRecord — and the loop in process() runs every 400ms via the
    // body-wide MutationObserver, so without these guards every long-lived
    // text element churns its data-* attributes hundreds of times per page.
    // Same pattern as the input-like branch (~line 954) already uses.
    if (el.dataset.rtlyProcessed !== "1") el.dataset.rtlyProcessed = "1";
    if (el.dataset.rtlyText !== normalized) el.dataset.rtlyText = normalized;
    if (applyDir && el.dataset.rtlyDir !== dir) el.dataset.rtlyDir = dir;
    // v1.9.20: reflow-free text marker for the fast-skip at the top of this
    // function. Stored from textContent (not innerText) so the next-tick
    // compare never forces a layout. Guarded same-value write, like the rest.
    const tcDone = el.textContent || "";
    if (el.dataset.rtlyTc !== tcDone) el.dataset.rtlyTc = tcDone;
  } catch (e) {
    log("applyDirectionAndFont error", e);
  }
}

// ---------- Core ----------

// v1.9.33: Claude ask_user_input choice-card RTL marking, extracted to a
// module-level helper so it can be driven by BOTH process() and a dedicated
// interval. The card renders OUTSIDE <main> in the sticky composer; once it has
// rendered it is static, producing no further childList mutations — and the
// main observer only watches childList (not attributes/focus), so process()
// fires at most once after the card appears (and may miss the rows if they
// settle a beat later, or lose the mark if React re-renders the row). A small
// standalone interval (see initRTLY) re-runs this every ~700ms, independent of
// any mutation, which is what actually makes the rows flip reliably.
//
// ANCHOR: the row's stable Tailwind class `group/row` (present whether or not
// the card currently holds keyboard focus — role="option"/"listbox" toggle with
// focus and are NOT reliable). Rows whose LABEL is RTL get data-rtly-card-rtl=
// "1"; claude.css flips those to direction:rtl (a live probe confirmed rtl on
// the flex row reorders children correctly: badge → right, arrow → left). The
// Persian-label gate keeps English cards / other group/row chrome LTR;
// isInSidebarOrMenu keeps Persian sidebar-history rows out.
function markClaudeChoiceCards() {
  if (siteKey !== "claude.ai") return;
  try {
    const mode = getEffectiveMode();
    if (mode !== "full" && mode !== "rtl_only") return;
    const rows = document.querySelectorAll('[class~="group/row"]');
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (isInSidebarOrMenu(row)) continue;
      const labelEl = row.querySelector('[class~="truncate"], [class~="text-secondary"]');
      const txt = (labelEl || row).textContent || "";
      const wantRtl = txt.length >= 2 && AR_FA_WORD.test(txt);
      const has = row.getAttribute("data-rtly-card-rtl") === "1";
      if (wantRtl && !has) row.setAttribute("data-rtly-card-rtl", "1");
      else if (!wantRtl && has) row.removeAttribute("data-rtly-card-rtl");
    }

    // v1.9.36: keep the card HEADER control row LTR.
    // The header (banner's first child) holds the Persian question text AND the
    // pagination cluster (Previous/Next + "1 of 3" counter + Minimize). Because
    // its aggregate text is Persian, applyDirectionAndFont stamps inline
    // `direction: rtl !important` on it — which CSS cannot override (inline
    // !important wins) and which drags the controls to the wrong side. We force
    // the header container back to LTR inline so the controls keep their
    // original position and order; the question SPAN keeps its own dir=rtl, so
    // its text stays right-aligned. The header text doesn't change, so
    // applyDirectionAndFont's reflow-free fast-skip (rtlyProcessed + matching
    // rtlyTc) keeps skipping it and won't re-rtl it; the guard below also avoids
    // any per-tick churn once it's ltr.
    const banner = document.querySelector('[data-ask-user-input-banner]');
    if (banner) {
      const ctrl = banner.querySelector('[aria-label="Previous question"], [aria-label="Next question"], [aria-label="Minimize"]');
      if (ctrl) {
        let header = ctrl;
        while (header && header.parentElement && header.parentElement !== banner) {
          header = header.parentElement;
        }
        if (header && header.parentElement === banner &&
            (header.getAttribute("dir") === "rtl" || header.style.direction === "rtl")) {
          header.style.setProperty("direction", "ltr", "important");
          header.setAttribute("dir", "ltr");
        }
      }
    }
  } catch (_) {}
}

function injectIranYekanFont() {
  try {
    const base = chrome.runtime.getURL("fonts/");
    const regular = base + "iranyekan-regular.woff";
    const bold = base + "iranyekan-bold.woff";
    const style = document.createElement("style");
    style.id = "rtly-font-face";
    style.textContent = `
@font-face {
  font-family: "IranYekan";
  src: url("${regular}") format("woff");
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "IranYekan";
  src: url("${bold}") format("woff");
  font-weight: bold;
  font-style: normal;
  font-display: swap;
}`;
    (document.head || document.documentElement).appendChild(style);
  } catch (_) {}
}

async function bootstrap() {
  // v1.9.12: patchHistory() + setupMessageListener() are registered AFTER the
  // per-site enabled check (moved further down, just before initRTLY). They
  // both have a page-observable side effect — patchHistory monkey-patches
  // history.pushState/replaceState; setupMessageListener registers a runtime
  // onMessage handler — so neither should run on a domain the user has
  // explicitly disabled RTLY for. They still live inside bootstrap (not at top
  // level), so a duplicate content-script injection can't stack listeners or
  // double-patch history (the window.__RTLY_CONTENT_V1__ gate guarantees
  // bootstrap runs at most once per document).
  injectIranYekanFont();
  applyGlobalFontScale();
  await loadSettings();
  if (chrome?.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.fontScale) {
        SETTINGS.fontScale = Number(changes.fontScale.newValue) || 100;
        applyGlobalFontScale();
        bustCaches();
      }
      if (changes.siteModes && changes.siteModes.newValue) {
        // Compute the effective mode for THIS site before and after the
        // update so we only do work when the change actually affects us
        // (the user may have changed a different site's mode in Options).
        const prevMode = getEffectiveMode();
        SETTINGS.siteModes = changes.siteModes.newValue;
        const nextMode = getEffectiveMode();
        bustCaches();
        applyModeStyles();
        // v1.9.20: live mode propagation, no reload. applyModeStyles() only
        // toggles the .rtly-with-font / .rtly-with-rtl body-class gates that
        // drive the STATIC stylesheet rules. The inline dir / direction /
        // text-align / font-family that applyDirectionAndFont wrote DIRECTLY
        // onto elements are not class-gated, so a full→font_only switch from
        // the Options page used to leave stale RTL on already-processed
        // elements until a manual reload. reapplyRTLY() strips that inline
        // state and re-runs under the new effective mode. Gated on rtlyActive
        // so it never fires on a disabled site, and on an actual mode change.
        if (rtlyActive && prevMode !== nextMode) reapplyRTLY();
      }
    });
  }
  const enabled = await isSiteEnabled(canonicalSite);
  if (!enabled) {
    log("Site disabled via settings, exiting");
    return;
  }
  // Site is enabled — now safe to take page-observable side effects.
  patchHistory();
  setupMessageListener();
  initRTLY();
}

function initRTLY() {
  log("Init for", siteKey);
  const siteCfg = CONFIG.SITES[siteKey];
  if (!siteCfg) return;

  // v1.9.20: we've passed the per-site enabled check — RTLY is now active on
  // this tab. Mark it so applyGlobalFontScale() applies the page-level scale
  // (it is a no-op until this point) and so live mode changes can reapply.
  rtlyActive = true;
  // v1.9.33: drive the Claude choice-card marking on a small standalone
  // interval. The card is static once rendered and the main observer only
  // watches childList, so process() alone fired at most once after the card
  // appeared (and could miss the rows or lose the mark on a React re-render).
  // A cheap ~700ms poll (one querySelectorAll of a rare class, self-gated to
  // claude.ai inside the helper) makes the rows flip reliably regardless of
  // mutation timing. Registered for teardown via trackInterval.
  if (siteKey === "claude.ai") {
    markClaudeChoiceCards();
    trackInterval(setInterval(markClaudeChoiceCards, 700));
  }
  applyGlobalFontScale();

  // v1.7.1: one-shot cleanup. Earlier versions (or any time we momentarily
  // processed an input's children before the input-descendant guard was in
  // place) may have left data-rtly-dir + dir + direction inline-styles on
  // <p> elements inside editable containers. Those force RTL forever — even
  // after the user has cleared and started typing English. Strip them on
  // load so a hard refresh always recovers a clean state.
  //
  // v1.7.2: ALSO clean wrappers ABOVE each input. Earlier versions set
  // direction:rtl on the wrapper divs around the input when the input
  // contained Persian text. That direction then inherited DOWN into the
  // input, overriding our dir="auto". Walk up 6 levels from each input
  // and strip any direction state we may have left there.
  try {
    document
      .querySelectorAll('[contenteditable="true"] [data-rtly-dir], [contenteditable=""] [data-rtly-dir], textarea [data-rtly-dir]')
      .forEach((stale) => {
        stale.removeAttribute("data-rtly-dir");
        stale.removeAttribute("data-rtly-text");
        stale.removeAttribute("data-rtly-processed");
        stale.removeAttribute("dir");
        stale.style.removeProperty("direction");
        stale.style.removeProperty("text-align");
      });
    document
      .querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""]')
      .forEach((input) => {
        let cur = input.parentElement;
        let levels = 0;
        while (cur && cur !== document.body && cur !== document.documentElement && levels < 6) {
          if (cur.hasAttribute("data-rtly-dir") ||
              cur.hasAttribute("data-rtly-processed") ||
              cur.style.direction ||
              cur.style.textAlign ||
              cur.getAttribute("dir") === "rtl" ||
              cur.getAttribute("dir") === "ltr") {
            cur.removeAttribute("data-rtly-dir");
            cur.removeAttribute("data-rtly-text");
            cur.removeAttribute("data-rtly-processed");
            cur.removeAttribute("dir");
            cur.style.removeProperty("direction");
            cur.style.removeProperty("text-align");
          }
          cur = cur.parentElement;
          levels++;
        }
      });
  } catch (e) {
    log("input cleanup error", e);
  }

  // v1.9.8: z.ai (and Claude / DeepSeek) cleanup of stale `data-rtly-processed`
  // marks on icon-bearing text containers. Pre-v1.9.7 the broad icon guard
  // stamped this attribute on every container whose subtree had an SVG
  // (i.e. every user-message bubble with edit/copy icons, every assistant
  // response with code-block copy buttons). The mark meant the heuristic FA
  // scan would early-exit on these elements forever, so even after the
  // narrowed icon guard ships, those elements are still locked. A one-shot
  // sweep on bootstrap clears the stamp on text-bearing containers (not on
  // actual buttons/anchors — those still need the guard).
  if (CLEANUP_STALE_MARK_SITES.has(siteKey)) {
    try {
      const scope = document.querySelector("main") || document.querySelector("[role='main']") || document.body;
      if (scope) {
        scope.querySelectorAll("[data-rtly-processed]").forEach((el) => {
          // Skip real interactive controls — their guard mark is still correct.
          const tag = (el.tagName || "").toLowerCase();
          const role = el.getAttribute && el.getAttribute("role");
          const isControl =
            tag === "button" || tag === "a" ||
            tag === "mat-list-item" || tag === "mat-chip" || tag === "mat-option" ||
            role === "button" || role === "menuitem" || role === "tab" || role === "option";
          if (isControl) return;
          // Only clear elements that didn't actually receive a direction.
          // If `data-rtly-dir` is set, the prior pass succeeded — leave it.
          if (el.hasAttribute("data-rtly-dir")) return;
          el.removeAttribute("data-rtly-processed");
          el.removeAttribute("data-rtly-text");
          el.removeAttribute("data-rtly-tc");
        });
      }
    } catch (e) {
      log("stale-process cleanup error", e);
    }
  }

  // 1.8.11: per-paragraph dir="auto" enforcement REMOVED.
  //
  // Earlier versions walked the editor's top-level <p>/<div> lines and forced
  // dir="auto" on them, re-running on a body-wide childList observer. The
  // DIAGNOSTIC build proved this is a self-feeding loop with ProseMirror:
  // writing dir onto a ProseMirror-managed <p> is a foreign DOM change, so
  // ProseMirror re-renders that line (replacing the node). The replacement is
  // a childList mutation, which re-fires our observer, which writes dir again,
  // which makes ProseMirror re-render again... ~9 writes/second while the user
  // is doing nothing. Each write makes the browser re-run native spellcheck on
  // the line, which is the red-squiggle flicker / "حس رفرش".
  //
  // It is also unnecessary: the stylesheet already carries
  //   [class*="rtly-"] [contenteditable] * { unicode-bidi: plaintext !important }
  // which makes every line auto-detect its own direction from its content,
  // independent of the `dir` attribute. So we now leave the editor's DOM
  // entirely alone — dir="auto" on the contenteditable ROOT (set once by
  // setupInputs) plus the CSS plaintext rule is the whole mechanism. No
  // observer, no per-paragraph writes, no fight with ProseMirror.

  setupBodyClass();
  applyModeStyles();          // 1.8.5: stamp data-rtly-mode + inject mode override sheet
  setupMenuProtection(); // Protect menus from direction changes
  setupCopyDirectionPreservation();
  setupInputs(siteCfg);
  setupResponses(siteCfg);

  // 1.8.10: drop the per-element classification caches (isInSidebarOrMenu /
  // isIcon / shouldSkipFont) on SPA navigation. Those results are cached the
  // first time an element is seen; if an element was evaluated before its final
  // classes/ancestors existed it could be cached as "sidebar" and stay that
  // way, which made RTL apply on one tab but not another depending on render
  // timing. Busting on navigation forces a fresh, deterministic recompute.
  // This only re-reads classification (no DOM writes), so it adds no flicker.
  window.addEventListener("rtly:navigation", () => bustCaches());
}

/* applyModeStyles — 1.8.6 (CSS-gated)
 *
 * Background. The long-standing "Font / RTL / Full chips do nothing" bug
 * could not be fixed reliably from JS:
 *
 *   - 1.8.3 toggled the body class. Removing it in rtl_only killed the input-
 *     bidi and sidebar-protection rules too — RTL typing UX regressed.
 *   - 1.8.4 left the body class and injected a `[dir="rtl"]` revert sheet.
 *     But the per-site CSS files have dozens of rules with explicit selectors
 *     like `.rtly-claude .font-claude-message { direction: rtl }` that don't
 *     go through `[dir="rtl"]`, so font_only still applied RTL everywhere.
 *   - 1.8.5 tried `--rtly-font-family: inherit` and `direction: revert
 *     !important`. The custom-property trick collapses to UA default on
 *     sites that set font-family only on <body>, and `revert` from author
 *     origin reverts to UA origin — both ends up wrong in real conditions.
 *
 * 1.8.6 solution — gate at the source.
 *   The styling system (v1.9.0: base.css + sites/<name>.css, loaded per
 *   domain via the manifest's content_scripts entries) has been
 *   programmatically split so every site-scoped rule that sets
 *   `font-family` lives under selector `.rtly-<site>.rtly-with-font`,
 *   and every rule that sets `direction` / RTL `text-align` / `unicode-bidi`
 *   / `writing-mode` lives under `.rtly-<site>.rtly-with-rtl`. Layout and
 *   color declarations stay always-on. See the per-site CSS files for the
 *   transformation (it's the build step, not run at install time).
 *
 *   This function is now just a thin coordinator:
 *     - Stamp data-rtly-mode (for debugging + outside-of-content-script hooks)
 *     - Sync the body classes (base + `.rtly-with-font` + `.rtly-with-rtl`)
 *     - Drop any stale `#rtly-mode-overrides` <style> from earlier versions
 *
 * Per mode:
 *   full       → with-font + with-rtl  (both apply)
 *   font_only  → with-font only        (no RTL, font injected)
 *   rtl_only   → with-rtl only         (no font, RTL applied)
 */
function applyModeStyles() {
  try {
    const mode = getEffectiveMode();
    // Stamp on documentElement too: it exists at document_start (body may
    // not), so html[data-rtly-mode] selectors are live before first paint.
    const stampTargets = [document.documentElement, document.body].filter(Boolean);
    for (const node of stampTargets) node.dataset.rtlyMode = mode;

    // Sync base + mode-flag body classes.
    syncBodyClass();

    // Remove any leftover override sheet from 1.8.4 / 1.8.5 sessions. The new
    // architecture doesn't need one; an old sheet would silently still apply.
    const oldOverride = document.getElementById("rtly-mode-overrides");
    if (oldOverride) oldOverride.remove();
  } catch (e) {
    log("applyModeStyles error", e);
  }
}

function setupCopyDirectionPreservation() {
  document.addEventListener(
    "copy",
    (e) => {
      try {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const anchor = sel.anchorNode;
        if (!anchor) return;
        const el = anchor.nodeType === 1 ? anchor : anchor.parentElement;
        const rtlEl = el?.closest?.("[dir='rtl'], [data-rtly-dir='rtl']");
        if (!rtlEl) return;
        // Don't add RLE inside code blocks — it breaks pasted code in shells, IDEs, compilers.
        if (el?.closest?.("pre, code, kbd, samp, [class*='code' i], [class*='hljs' i], [class*='monaco' i], [data-language]")) return;
        const text = sel.toString();
        if (!text) return;
        // Only prepend RLE when the selection is meaningfully Persian/Arabic-dominant.
        // Pure-English selections inside an RTL container should NOT get an invisible marker.
        if (!AR_FA_WORD.test(text)) return;
        const faChars = (text.match(/[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u07C0-\u07FF\u0800-\u085F\u0870-\u089F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]|[\u{1E900}-\u{1E95F}]/gu) || []).length;
        const enChars = (text.match(/[A-Za-z]/g) || []).length;
        if (faChars < enChars) return; // majority English — leave clipboard alone
        if (e.clipboardData) {
          e.clipboardData.setData("text/plain", RLE + text);
          e.preventDefault();
        }
      } catch (_) {}
    },
    true
  );
}

// --- Menu Protection ---
function setupMenuProtection() {
  // Flag to prevent infinite loops
  let isProtecting = false;
  const protectedElements = new WeakSet();

  // Function to remove direction from menu elements (debounced and optimized)
  const protectMenus = debounce(() => {
    if (isProtecting) return; // Prevent re-entrance
    isProtecting = true;

    try {
      // DeepSeek/Z.ai: keep body and layout LTR so sidebar stays on left
      if (LAYOUT_LTR_SITES.has(siteKey)) {
        [document.body, document.body?.firstElementChild, document.body?.firstElementChild?.firstElementChild].forEach((el) => {
          if (!el) return;
          el.setAttribute("dir", "ltr");
          el.style.setProperty("direction", "ltr", "important");
        });
      }

      // Only check a limited set of selectors to avoid performance issues
      const menuSelectors = [
        "nav",
        "aside",
        "[role='navigation']",
        "[role='menu']",
        "[role='complementary']",
        ".sidebar",
        ".side-bar"
      ];

      let processedCount = 0;
      const maxProcess = 50; // Limit processing to avoid lag

      menuSelectors.forEach((selector) => {
        if (processedCount >= maxProcess) return;

        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach((el) => {
            if (processedCount >= maxProcess) return;

            // Make sure it's actually a menu, not a chat message
            if (isInSidebarOrMenu(el) && !protectedElements.has(el)) {
              protectedElements.add(el);

              // Only remove if actually set (avoid unnecessary DOM operations)
              if (el.hasAttribute("dir")) el.removeAttribute("dir");
              if (el.style.direction) el.style.removeProperty("direction");
              if (el.style.textAlign) el.style.removeProperty("text-align");

              processedCount++;
            }
          });
        } catch (e) {
          // Ignore errors
        }
      });
    } catch (e) {
      log("protectMenus error", e);
    } finally {
      isProtecting = false;
    }
  }, 500); // Debounce to 500ms

  // Run immediately once
  protectMenus();

  // Run after a short delay to catch any late-applied styles (only once)
  setTimeout(protectMenus, 1000);

  // Set up MutationObserver to watch for direction changes on menus (debounced)
  let observerActive = false;
  const menuObserver = trackObserver(new MutationObserver(
    debounce((mutations) => {
      if (observerActive) return; // Prevent infinite loops
      observerActive = true;

      try {
        let processed = 0;
        const maxProcess = 20; // Limit mutations processed

        mutations.forEach((mutation) => {
          if (processed >= maxProcess) return;

          if (mutation.type === "attributes" && mutation.attributeName === "dir") {
            const target = mutation.target;
            if (isInSidebarOrMenu(target) && target.hasAttribute("dir")) {
              // Use requestAnimationFrame to avoid blocking
              requestAnimationFrame(() => {
                target.removeAttribute("dir");
              });
              processed++;
            }
          }
        });
      } catch (e) {
        // Ignore errors
      } finally {
        observerActive = false;
      }
    }, 300) // Debounce mutations
  ));

  // Observe the document for attribute changes (only dir attribute to reduce overhead)
  //
  // v1.9.10: at document_start, document.body may not exist yet. Calling
  // observe(null, ...) throws:
  //   "Failed to execute 'observe' on 'MutationObserver':
  //    parameter 1 is not of type 'Node'."
  // Mirror the guard pattern v1.9.7-fix uses for layoutObserver below: if body
  // isn't ready, defer hookup to DOMContentLoaded. Without this fallback the
  // observer was silently dropped on early-loading pages.
  const startMenuWatch = () => {
    if (!document.body) return;
    try {
      menuObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["dir"], // Only watch dir, not style (style changes too frequently)
        subtree: true
      });
    } catch (e) {
      log("menuObserver.observe failed", e);
    }
  };
  if (document.body) {
    startMenuWatch();
  } else {
    document.addEventListener("DOMContentLoaded", startMenuWatch, { once: true });
  }

  // DeepSeek/Z.ai: prevent dir="rtl" on layout - when Persian chat appears, revert immediately
  if (LAYOUT_LTR_SITES.has(siteKey)) {
    const forceLayoutLTR = () => {
      const isLayoutContainer = (el) => {
        if (!el || el.nodeType !== 1) return false;
        if (el === document.body || el === document.documentElement) return true;
        const hasNavSidebar = el.querySelector?.("aside, nav, [class*='sidebar' i]");
        const hasChatArea = el.querySelector?.("main, [role='main'], article, [role='article'], textarea, .ds-message");
        if (hasNavSidebar && hasChatArea) return true;
        const txt = (el.innerText || el.textContent || "").slice(0, 400);
        if (/new\s*chat/i.test(txt) && hasChatArea && el.childElementCount >= 2) return true;
        return false;
      };
      const targets = [
        document.body,
        document.documentElement,
        ...Array.from(document.querySelectorAll("body > div, body > div > div, body > div > div > div"))
      ];
      targets.forEach((el) => {
        if (!el) return;
        // Read attribute first (cheap). Only fall back to computed style when
        // the attribute is unset — saves a forced layout on the common path.
        const dirAttr = el.getAttribute("dir");
        const isRtl = dirAttr === "rtl" || (!dirAttr && getComputedStyle(el).direction === "rtl");
        if (isLayoutContainer(el) && isRtl) {
          el.setAttribute("dir", "ltr");
          el.style.setProperty("direction", "ltr", "important");
        }
      });
    };
    const debouncedForceLayoutLTR = debounce(forceLayoutLTR, 150);
    const layoutObserver = trackObserver(new MutationObserver((mutations) => {
      // 1.8.6 perf: handle each mutated dir=rtl inline (cheap), but defer the
      // body-wide rescan via debounce. Earlier versions fired the full
      // forceLayoutLTR() walk synchronously on every dir mutation in the
      // subtree — on a long DeepSeek conversation that's hundreds of forced
      // layouts per second when the site re-renders messages.
      mutations.forEach((m) => {
        const el = m.target;
        if (el?.nodeType === 1 && el.getAttribute("dir") === "rtl") {
          const txt = (el.innerText || el.textContent || "").slice(0, 400);
          const hasChatArea = el.querySelector?.("textarea, .ds-message, main, article");
          if (/new\s*chat/i.test(txt) && hasChatArea && el.childElementCount >= 2) {
            el.setAttribute("dir", "ltr");
            el.style.setProperty("direction", "ltr", "important");
          }
        }
      });
      debouncedForceLayoutLTR();
    }));
    // v1.9.7-fix: at document_start, document.body may not exist yet on
    // DeepSeek/Z.ai. Calling observe(null, ...) throws:
    //   "Failed to execute 'observe' on 'MutationObserver':
    //    parameter 1 is not of type 'Node'."
    // Mirror the guard used a few lines above for menuObserver, and if body
    // isn't ready, defer hookup until DOMContentLoaded.
    const startLayoutWatch = () => {
      if (!document.body) return;
      try {
        layoutObserver.observe(document.body, { attributes: true, attributeFilter: ["dir"], subtree: true });
      } catch (e) {
        log("layoutObserver.observe failed", e);
      }
      forceLayoutLTR();
    };
    if (document.body) {
      startLayoutWatch();
    } else {
      document.addEventListener("DOMContentLoaded", startLayoutWatch, { once: true });
    }
    // 1.8.6: bumped from 2s → 5s. The MutationObserver above catches the
    // attribute-change path immediately; this interval is a defensive scan
    // for direction set via inline style without a `dir` attribute change.
    // Every tick does a getComputedStyle() walk, so reducing the cadence
    // helps long-lived tabs noticeably.
    trackInterval(setInterval(() => {
      if (document.visibilityState !== "visible") return;
      forceLayoutLTR();
    }, 5000));
  }

  trackInterval(setInterval(() => {
    if (document.visibilityState !== "visible") return;
    protectMenus();
  }, 10000));
}

// --- Body class ---
//
// 1.8.6: three composite classes on body drive the cascade.
//   .rtly-<site>     — base hook for all per-site CSS rules. Always attached.
//   .rtly-with-font  — gates `font-family` rules. Present when
//                      mode ∈ { full, font_only }.
//   .rtly-with-rtl   — gates `direction` / RTL `text-align` / `unicode-bidi`
//                      / `writing-mode` rules. Present when
//                      mode ∈ { full, rtl_only }.
//
// 1.9.0: the styling layer is now split into base.css plus one
// sites/<name>.css per logical site group, loaded per-domain via the
// manifest's content_scripts entries. The transformation in
// the per-site CSS conversion rewrites every site-scoped rule so that font
// and direction live in independent selector scopes. JS no longer needs
// to write any inline override stylesheet — toggling these two classes
// is the whole switch.
const BODY_CLASS_MAP = {
  "chat.openai.com": "rtly-chatgpt",
  "chatgpt.com": "rtly-chatgpt",
  "claude.ai": "rtly-claude",
  "copilot.microsoft.com": "rtly-copilot",
  "copilot.com": "rtly-copilot",
  "gemini.google.com": "rtly-gemini",
  "perplexity.ai": "rtly-perplexity",
  "aistudio.google.com": "rtly-aistudio",
  "poe.com": "rtly-poe",
  "grok.com": "rtly-grok",
  "chat.z.ai": "rtly-zai",
  "z.ai": "rtly-zai",
  "notebooklm.google.com": "rtly-notebooklm",
  "chat.deepseek.com": "rtly-deepseek",
  "qwen.ai": "rtly-qwen",
  // v1.9.10: these four sites had manifest content_scripts, TARGET_DOMAINS
  // and CONFIG.SITES entries but were missing here, so the rtly-* body class
  // never attached on them. Without the body class, every `[class*="rtly-"]`
  // and `html.rtly-active` rule in base.css (universal icon shield, bidi
  // plaintext on inputs, etc.) silently no-op'd. Even though no per-site
  // CSS file exists for them yet, having the body class is what activates
  // the SHARED base.css protections.
  "bing.com": "rtly-bing",
  "mistral.ai": "rtly-mistral",
  "huggingface.co": "rtly-huggingface",
  "cohere.com": "rtly-cohere",
};

const MODE_FLAG_CLASSES = ["rtly-with-font", "rtly-with-rtl"];

function getBodyClassName() {
  return BODY_CLASS_MAP[canonicalSite] || BODY_CLASS_MAP[siteKey] || null;
}

function syncBodyClass() {
  const className = getBodyClassName();
  if (!className) return;
  const mode = getEffectiveMode();
  const wantFont = mode === "full" || mode === "font_only";
  const wantRtl  = mode === "full" || mode === "rtl_only";

  const targets = [document.body, document.documentElement].filter(Boolean);
  for (const target of targets) {
    // Base site class: always attached.
    if (!target.classList.contains(className)) target.classList.add(className);
    if (!target.classList.contains("rtly-active")) target.classList.add("rtly-active");
    target.classList.toggle("rtly-with-font", wantFont);
    target.classList.toggle("rtly-with-rtl",  wantRtl);
  }
}

function setupBodyClass() {
  const className = getBodyClassName();
  if (!className) return;

  if (document.body) {
    syncBodyClass();
  } else {
    document.addEventListener("DOMContentLoaded", syncBodyClass, { once: true });
  }

  // Also re-sync on SPA navigation.
  window.addEventListener("rtly:navigation", () => {
    setTimeout(syncBodyClass, 50);
  });
}

// --- Inputs ---
async function setupInputs(cfg) {
  const el = await waitForSelectors(cfg.inputs);
  if (!el) return;
  applyDirectionAndFont(el);

  // Debounced handler - only process after user stops typing (avoids input lag)
  const debouncedHandler = debounce((target) => {
    requestAnimationFrame(() => applyDirectionAndFont(target));
  }, 250);
  const handler = (ev) => {
    const target = ev?.target || el;
    debouncedHandler(target);
  };

  // Use passive listeners where possible - avoid keydown (blocks typing)
  ["input", "keyup", "paste", "compositionend", "change"].forEach((evt) =>
    el.addEventListener(evt, handler, { passive: true, capture: true })
  );
  // Mark so the navigation rebind below never double-binds this element.
  el.dataset.rtlyListenersAdded = "1";

  if (el.contentEditable === "true" || el.getAttribute("contenteditable") === "true") {
    el.addEventListener("blur", () => applyDirectionAndFont(el), { passive: true, capture: true });
  }

  // MutationObserver: skip characterData (fires on every keystroke - causes severe lag)
  const inputMo = trackObserver(new MutationObserver(debounce(() => {
    if (!el.isConnected) { releaseObserver(inputMo); return; }
    requestAnimationFrame(() => {
      applyDirectionAndFont(el);
      if (el.contentEditable === "true" && el.querySelector) {
        el.querySelectorAll("[contenteditable='true']").forEach(applyDirectionAndFont);
      }
    });
  }, 300)));
  // 1.8.10: childList/subtree ONLY — NOT attributes. Our dir=auto + font are
  // applied once and are idempotent, so we never need to react to the input's
  // own attribute changes. Watching `attributes` here meant the observer
  // re-fired on our own writes (and on per-keystroke attribute churn some
  // editors emit), which was the second half of the input-refresh loop.
  inputMo.observe(el, { childList: true, subtree: true });

  // 1.8.10: re-bind on SPA navigation. Some routes re-mount the composer when
  // switching chats; the element our listeners/observer were attached to then
  // detaches, so freshly-typed Persian stops flipping to RTL until an
  // unrelated pass happens to touch it. On navigation, re-apply to the current
  // input(s) and attach listeners only where missing (dataset-guarded — never
  // double-binds, never stacks observers).
  const rebindInputs = debounce(() => {
    cfg.inputs.forEach((sel) => {
      try {
        document.querySelectorAll(sel).forEach((inputEl) => {
          if (isInSidebarOrMenu(inputEl)) return;
          applyDirectionAndFont(inputEl);
          if (!inputEl.dataset.rtlyListenersAdded) {
            ["input", "keyup", "paste", "compositionend", "change"].forEach((evt) =>
              inputEl.addEventListener(evt, handler, { passive: true, capture: true })
            );
            inputEl.dataset.rtlyListenersAdded = "1";
          }
        });
      } catch (_) {}
    });
  }, 150);
  window.addEventListener("rtly:navigation", () => setTimeout(rebindInputs, 100));

  // Gemini: check for new inputs less aggressively (reduces input lag)
  if (siteKey === "gemini.google.com") {
    const checkInputs = debounce(() => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "TEXTAREA" || activeEl.getAttribute?.("contenteditable") === "true")) return;
      cfg.inputs.forEach((sel) => {
        try {
          document.querySelectorAll(sel).forEach((inputEl) => {
            if (isInSidebarOrMenu(inputEl)) return;
            const txt = (inputEl.value ?? inputEl.innerText ?? inputEl.textContent ?? "").trim();
            if (txt) requestAnimationFrame(() => applyDirectionAndFont(inputEl));
            if (!inputEl.dataset.rtlyListenersAdded) {
              ["input", "keyup", "paste", "compositionend"].forEach((evt) =>
                inputEl.addEventListener(evt, handler, { passive: true, capture: true })
              );
              inputEl.dataset.rtlyListenersAdded = "1";
            }
          });
        } catch (_) {}
      });
    }, 800);
    checkInputs();
    // Aggressive polling for the first minute, then self-terminate. The
    // 60s window catches Gemini's lazy-mount sequence of textareas; after
    // that we rely on the MutationObserver below.
    const iv = setInterval(checkInputs, 5000);
    setTimeout(() => clearInterval(iv), 60000);
    const mo = trackObserver(new MutationObserver(debounce(checkInputs, 1000)));
    // v1.9.10: same document_start race as menuObserver/layoutObserver above —
    // document.body may not exist yet. If body isn't ready, defer hookup to
    // DOMContentLoaded instead of silently dropping the observer.
    const startGeminiInputWatch = () => {
      if (!document.body) return;
      try {
        mo.observe(document.body, { childList: true, subtree: true });
      } catch (e) {
        log("Gemini input mo.observe failed", e);
      }
    };
    if (document.body) {
      startGeminiInputWatch();
    } else {
      document.addEventListener("DOMContentLoaded", startGeminiInputWatch, { once: true });
    }
  }
}

// --- Responses ---
function setupResponses(cfg) {
  const selectors = cfg.responses || [];
  if (!selectors.length) return;
  const fallback = ["[role='log']", "[data-testid*='message']", ".messages", ".chat", "main article"];

  // For NotebookLM, only process elements within Chat section
  const isNotebookLM = siteKey === "notebooklm.google.com";
  const isGemini = siteKey === "gemini.google.com";


  const getChatContainer = () => {
    if (!isNotebookLM) return null;
    // Try multiple selectors to find Chat section in NotebookLM
    const selectors = [
      '[aria-label*="Chat" i]',
      '[data-testid*="chat" i]',
      '.conversation',
      '[data-testid*="chat-message"]',
      '.lm-chat-message',
      '.message'
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          // Find the parent container that likely contains the Chat section
          // Look for section, main > div, or a container with specific structure
          let container = el.closest('section, [role="region"]');
          if (!container) {
            // Try to find a parent div that contains chat-related elements
            container = el.closest('main > div, main > div > div');
          }
          if (container) return container;
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  };

  // Text-bearing tag selector (hoisted to avoid rebuilding per cycle).
  // Replaces `mainContainer.querySelectorAll("*")` which on a long Gemini
  // session would return 10000+ nodes — most of which were thrown away by
  // the textTags filter. Selecting only the text-bearing tags up front cuts
  // the NodeList size by 5–10x and removes the most expensive querySelectorAll
  // call in the script.
  //
  // v1.8.21: added Gemini's Lumi custom elements (`user-query`,
  // `user-query-content`, `model-response`, `model-response-text`). Without
  // these the broad scan misses the user-message pill entirely on the new
  // Gemini UI — the bubble stays LTR and the Persian text gets truncated.
  const GEMINI_TEXT_SELECTOR =
    "p, div, span, li, article, section, h1, h2, h3, h4, h5, h6, blockquote, label, " +
    "user-query, user-query-content, model-response, model-response-text";

  // Gemini processing - optimized for performance (avoid input lag, reduce during streaming)
  const processGemini = () => {
    try {
      if (document.activeElement?.tagName === "TEXTAREA" ||
          document.activeElement?.getAttribute?.("contenteditable") === "true") return;
      let mainContainer = document.querySelector("main") || document.querySelector("[role='main']");
      if (mainContainer) {
        const chatArea = mainContainer.querySelector("[data-qa*='chat'], [data-qa*='conversation'], [class*='chat'], [class*='Chat']");
        if (chatArea && !isInSidebarOrMenu(chatArea)) mainContainer = chatArea;
      }
      if (!mainContainer) mainContainer = document.body;
      if (!mainContainer || isInSidebarOrMenu(mainContainer)) return;

      // First, process all input boxes
      cfg.inputs.forEach((sel) => {
        try {
          const inputs = document.querySelectorAll(sel);
          inputs.forEach((inputEl) => {
            if (!isInSidebarOrMenu(inputEl)) {
              const txt = inputEl.value !== undefined ? inputEl.value : inputEl.innerText || inputEl.textContent || "";
              if (txt && txt.trim()) {
                applyDirectionAndFont(inputEl);
              }
            }
          });
        } catch (e) { /* Ignore errors */ }
      });

      // Process response selectors first
      [...selectors, ...fallback].forEach((sel) => {
        try {
          const elements = document.querySelectorAll(sel);
          elements.forEach((el) => {
            if (isInSidebarOrMenu(el)) return;
            applyDirectionAndFont(el);
            const children = el.querySelectorAll(GEMINI_TEXT_SELECTOR);
            let childCount = 0;
            const maxChildren = 15;
            children.forEach((childEl) => {
              if (childCount >= maxChildren) return;
              if (isInSidebarOrMenu(childEl)) return;
              if (childEl.closest("code, pre")) return;
              const childTxt = childEl.innerText || childEl.textContent || "";
              if (childTxt && childTxt.trim().length >= 2) {
                applyDirectionAndFont(childEl);
                childCount++;
              }
            });
          });
        } catch (e) { /* Ignore errors */ }
      });

      // Broad scan, scoped to text-bearing tags only (no longer "*").
      const textElements = mainContainer.querySelectorAll(GEMINI_TEXT_SELECTOR);
      let processedCount = 0;
      const maxProcess = 150;

      for (let i = 0; i < textElements.length && processedCount < maxProcess; i++) {
        const el = textElements[i];

        // Sidebar check (cached, so cheap after first call)
        if (isInSidebarOrMenu(el)) continue;

        // Already-processed elements skipped early — applyDirectionAndFont
        // would short-circuit anyway, but checking the dataset attribute
        // first avoids the innerText read which is the heaviest step.
        if (el.dataset.rtlyProcessed === "1" && !el.dataset.rtlyText) {
          // safe: explicitly tagged as processed via non-text path
          continue;
        }

        if (el.closest("code, pre")) continue;

        const txt = el.innerText || el.textContent || "";
        if (!txt || txt.trim().length < 2) continue;

        const normalized = txt.trim();
        const hasPersian = AR_FA_WORD.test(normalized);
        const isTextContainer = true; // selector guarantees this

        // For Gemini: process if has Persian (priority) or is a meaningful
        // text container.
        if (hasPersian || normalized.length > 5) {
          applyDirectionAndFont(el);
          processedCount++;
        }
      }

      const messageElements = mainContainer.querySelectorAll("[data-message], [data-role], [data-qa], [role='article']");
      let messageCount = 0;
      const maxMessages = 30;
      for (let i = 0; i < messageElements.length && messageCount < maxMessages; i++) {
        const el = messageElements[i];
        if (isInSidebarOrMenu(el)) continue;
        const txt = el.innerText || el.textContent || "";
        if (!txt || txt.trim().length < 2) continue;
        applyDirectionAndFont(el);
        messageCount++;
        // Process only first 10 direct children to reduce overhead
        const kids = el.children;
        const kidLimit = Math.min(kids.length, 10);
        for (let j = 0; j < kidLimit; j++) {
          const child = kids[j];
          if (isInSidebarOrMenu(child)) continue;
          const childTxt = child.innerText || child.textContent || "";
          if (childTxt && childTxt.trim().length >= 2) {
            applyDirectionAndFont(child);
          }
        }
      }
    } catch (e) {
      log("processGemini error", e);
    }
  };

  let responseProcessCount = 0;
  // v1.9.27: generation token for the time-sliced response pass. Each process()
  // bumps it; any in-flight slice from an older pass sees the mismatch and bails,
  // so passes never stack.
  let responsePassGen = 0;
  const process = () => {
    responseProcessCount++;
    if (DEBUG && responseProcessCount % 50 === 0) log("response process", responseProcessCount);
    
    // Use special processing for Gemini
    if (isGemini) {
      processGemini();
      return;
    }
    
    // v1.9.33: also run the choice-card marking each process() tick (cheap).
    // The reliable driver is the dedicated interval in initRTLY — see
    // markClaudeChoiceCards — but running it here too catches the card the
    // instant a chat mutation fires process().
    markClaudeChoiceCards();
    
    try {
      const chatContainer = getChatContainer();

      // v1.9.22: dedupe containers across the (heavily overlapping) selector
      // list so each message container is handled at most once per tick.
      const seenContainers = new Set();

      // v1.9.25: ONE combined DOM traversal instead of one-per-selector.
      const allContainerSelectors = [...selectors, ...fallback];
      const containerRoot = chatContainer || document;
      let containerEls;
      try {
        containerEls = Array.from(containerRoot.querySelectorAll(allContainerSelectors.join(", ")));
      } catch (_) {
        containerEls = [];
        allContainerSelectors.forEach((sel) => {
          try { containerRoot.querySelectorAll(sel).forEach((e) => containerEls.push(e)); } catch (_) {}
        });
      }

      const processOneContainer = (el) => {
        if (seenContainers.has(el)) return;
        seenContainers.add(el);
        // Skip sidebar, navigation, and menu areas
        if (isInSidebarOrMenu(el)) return;
        // For NotebookLM, only process if inside Chat section
        if (isNotebookLM && chatContainer && !chatContainer.contains(el)) return;

        // v1.9.22 (ChatGPT hang): was this container already fully handled with
        // IDENTICAL text on a prior pass? Captured BEFORE processing so a
        // first-time container still descends. If stable, skip re-walking the
        // entire subtree.
        const stableBefore =
          el.dataset.rtlyProcessed === "1" &&
          el.dataset.rtlyTc !== undefined &&
          (el.textContent || "") === el.dataset.rtlyTc;

        applyDirectionAndFont(el);
        if (stableBefore) return;

        // v1.9.27: do NOT descend into `pre`/`code`. Code is forced LTR by CSS
        // (base.css `code{unicode-bidi:isolate}` + per-site `code{direction:ltr}`),
        // so setting dir on its contents is a no-op visually — but ChatGPT
        // syntax-highlights code into ONE <span> per token, so a single code
        // block is hundreds–thousands of spans. Walking + processing all of them
        // every pass was the bulk of the work on a code-heavy thread (the freeze
        // in the screenshot). `code, pre` are dropped from the selector AND any
        // node inside one is skipped, so an entire code block costs ~nothing.
        el.querySelectorAll(
          "p, div, span, li, article, section, h1, h2, h3, h4, h5, h6"
        ).forEach((childEl) => {
          if (isInSidebarOrMenu(childEl)) return;
          if (childEl.closest("pre, code")) return;
          applyDirectionAndFont(childEl);
        });
      };

      // The two fallback FA scans, run once AFTER all containers are processed.
      const runScans = () => {
        if (COMPREHENSIVE_SELECTOR_SITES.has(siteKey)) {
          // Site selectors cover the whole conversation → skip the generic
          // whole-main fallback scan entirely (ChatGPT). Continue to the
          // heuristicFaScan block below only if this site opts in (it won't here).
        } else {
          // Heuristic: catch unprocessed text blocks with FA chars (other sites).
          const mainRoot = document.querySelector("main") || document.querySelector("[role='main']");
          const heuristicRoots = isNotebookLM && chatContainer
            ? [chatContainer]
            : (mainRoot ? [mainRoot] : Array.from(document.querySelectorAll("article, [role='article']")));
          heuristicRoots.forEach((root) => {
            if (isNotebookLM && chatContainer && !chatContainer.contains(root)) return;
            const candidates = root.querySelectorAll("*:not([data-rtly-processed]):not(code):not(pre):not(script):not(style)");
            let scanned = 0, examined = 0;
            const maxScanned = 200, maxExamined = 1500;
            for (let i = 0; i < candidates.length; i++) {
              if (scanned >= maxScanned || examined >= maxExamined) break;
              const node = candidates[i];
              examined++;
              if (isInSidebarOrMenu(node)) continue;
              if (isNotebookLM && chatContainer && !chatContainer.contains(node)) continue;
              const txt = node.textContent || "";
              if (!txt || txt.length < 2) continue;
              if (AR_FA_WORD.test(txt)) { applyDirectionAndFont(node); scanned++; }
            }
          });
        }

        // Additional pass for Claude, DeepSeek, Z.ai, Perplexity.
        if (HEURISTIC_FA_SCAN_SITES.has(siteKey)) {
          const scopeRoot = document.querySelector("main") || document.querySelector("[role='main']") || document.body;
          if (scopeRoot) {
            const allTextElements = scopeRoot.querySelectorAll("p, div, span, li, article, section, h1, h2, h3, h4, h5, h6");
            const maxFaScan = 400;
            let faProcessed = 0;
            for (let i = 0; i < allTextElements.length && faProcessed < maxFaScan; i++) {
              const el = allTextElements[i];
              if (isInSidebarOrMenu(el)) continue;
              if (el.dataset.rtlyProcessed) continue;
              if (el.closest("pre, code")) continue;
              const txt = el.textContent || "";
              if (txt && txt.length >= 2 && AR_FA_WORD.test(txt)) { applyDirectionAndFont(el); faProcessed++; }
            }
          }
        }
      };

      // v1.9.27: TIME-SLICED processing. The browser shows "Page Unresponsive"
      // only when the main thread is blocked for many seconds without yielding.
      // On a long, code-heavy ChatGPT thread the container loop was one big
      // synchronous block. We now process in ≤8ms slices and yield between them
      // (requestIdleCallback, falling back to setTimeout), so the thread is never
      // blocked long enough to trip the dialog. A newer process() bumps
      // responsePassGen, so an in-flight slice from a superseded pass bails.
      const myGen = ++responsePassGen;
      let idx = 0;
      const SLICE_MS = 8;
      const now = () => (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      const runSlice = () => {
        if (myGen !== responsePassGen) return; // superseded by a newer pass
        try {
          const start = now();
          while (idx < containerEls.length) {
            processOneContainer(containerEls[idx++]);
            if (now() - start >= SLICE_MS) break;
          }
        } catch (e) {
          log("process slice error", e);
        }
        if (idx < containerEls.length) {
          if (typeof requestIdleCallback !== "undefined") requestIdleCallback(runSlice, { timeout: 200 });
          else setTimeout(runSlice, 0);
        } else {
          try { runScans(); } catch (e) { log("process scans error", e); }
        }
      };
      runSlice();
    } catch (e) {
      log("process responses error", e);
    }
  };

  process();

  if (isGemini) {
    const runProcess = () => {
      if (requestIdleCallback) {
        requestIdleCallback(() => process(), { timeout: 500 });
      } else {
        setTimeout(process, 50);
      }
    };
    setTimeout(runProcess, 300);
    setTimeout(runProcess, 1500);
    const debouncedProcess = debounce(runProcess, 800);
    const mo = trackObserver(new MutationObserver(() => debouncedProcess()));
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    window.addEventListener("scroll", throttle(runProcess, 1500), { passive: true });
    document.addEventListener("focusout", debounce(runProcess, 500), true);
    window.addEventListener("rtly:navigation", debounce(() => setTimeout(runProcess, 500), 500));
    let n = 0;
    // Aggressive polling for ~60s during initial load while the chat tree
    // settles, then self-terminate.
    const iv = setInterval(() => { runProcess(); if (++n >= 12) clearInterval(iv); }, 5000);
    // Long-running keepalive — gated on visibility, registered for teardown.
    trackInterval(setInterval(() => {
      if (document.visibilityState !== "visible") return;
      runProcess();
    }, 15000));
    return;
  }

  const mo = trackObserver(new MutationObserver(debounce(process, 400)));
  mo.observe(document.body || document.documentElement, CONFIG.OBSERVER_CONFIG);
  window.addEventListener("rtly:navigation", () => setTimeout(process, 100));

  // Also process on specific events for sites that need the heuristic FA scan
  if (HEURISTIC_FA_SCAN_SITES.has(siteKey)) {
    // Z.ai/DeepSeek: immediately process new messages (fixes text displacement after send)
    // v1.9.9: added "[data-expanded]" — the real z.ai user-bubble signature.
    const zaiMessageSelectors = ["[data-expanded]", "article", "[role='article']", "[class*='message']", "[class*='Message']", "[data-message]"];
    const zaiMessageSelectorStr = zaiMessageSelectors.join(", ");
    const processNewNodes = (nodes) => {
      nodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        const el = node;
        // Use the joined selector once instead of `.some(matches)` per element.
        const isMessage = (() => {
          try { return el.matches && el.matches(zaiMessageSelectorStr); } catch (_) { return false; }
        })();
        if (isMessage && !isInSidebarOrMenu(el)) {
          applyDirectionAndFont(el);
          (el.querySelectorAll?.("p, div, span, li, article, section, h1, h2, h3, h4, h5, h6") || []).forEach(applyDirectionAndFont);
        }
        // Look for descendant messages
        if (el.querySelector?.(zaiMessageSelectorStr)) {
          (el.querySelectorAll?.(zaiMessageSelectorStr) || []).forEach((msg) => {
            if (!isInSidebarOrMenu(msg)) {
              applyDirectionAndFont(msg);
              (msg.querySelectorAll?.("p, div, span, li") || []).forEach(applyDirectionAndFont);
            }
          });
        }
      });
    };
    const processOnMutation = debounce(() => process(), 500);
    const contentObserver = trackObserver(new MutationObserver((mutations) => {
      if (LAYOUT_LTR_SITES.has(siteKey)) {
        mutations.forEach((m) => {
          if (m.addedNodes?.length) processNewNodes(Array.from(m.addedNodes));
        });
      }
      processOnMutation();
    }));
    contentObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Also process on scroll (content might load dynamically)
    window.addEventListener("scroll", debounce(process, 200), { passive: true });

    // Process immediately when DOM is ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        setTimeout(process, 100);
      }, { once: true });
    } else {
      setTimeout(process, 100);
    }
  }
}

// ---------- Helpers ----------
function throttle(fn, wait) {
  let inFlight = false;
  return (...args) => {
    if (inFlight) return;
    inFlight = true;
    fn(...args);
    setTimeout(() => (inFlight = false), wait);
  };
}
function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function waitForSelectors(selectors = []) {
  return new Promise((resolve) => {
    const found = selectors.map((s) => document.querySelector(s)).find(Boolean);
    if (found) return resolve(found);

    const obs = new MutationObserver(() => {
      const el = selectors.map((s) => document.querySelector(s)).find(Boolean);
      if (el) {
        obs.disconnect();
        resolve(el);
      }
    });
    obs.observe(document.documentElement, CONFIG.OBSERVER_CONFIG);
    setTimeout(() => {
      obs.disconnect();
      resolve(null);
    }, 5000);
  });
}

async function isSiteEnabled(domain) {
  if (!domain) return false;
  if (!(chrome?.storage?.local)) return true;
  // Note: `domain` here is always the canonical site id (canonicalSite),
  // already resolved via CANONICAL before this is called — e.g. chat.openai.com
  // has been mapped to chatgpt.com. So a per-host alias table here was dead
  // code (its only entry, chat.openai.com, can never be the argument). Removed
  // in v1.9.12; settings are keyed by canonical id, written that way by
  // background.js / popup / options.
  return new Promise((resolve) => {
    chrome.storage.local.get(["siteSettings"], (res) => {
      if (chrome.runtime?.lastError) {
        log("storage error", chrome.runtime.lastError);
        resolve(true);
        return;
      }
      const settings = res.siteSettings || {};
      resolve(settings[domain] !== false);
    });
  });
}

// ---------- Reapply (from popup "اعمال روی این صفحه") ----------
// v1.9.21: ownership-aware teardown. `data-rtly-processed` marks that RTLY
// LOOKED AT an element — NOT that it owns the element's direction. The
// input-like branch, for instance, marks a `<textarea dir="auto">` processed
// while deliberately PRESERVING the site's native dir. Blindly removing `dir`
// from every processed element (as the previous reapply did) deleted that
// native directionality on mode transitions. Cleanup now only strips
// direction state RTLY actually created:
//   • data-rtly-dir       → main text path set dir + inline direction/text-align
//   • data-rtly-auto-dir  → input path wrote dir="auto" (was absent before)
// Font (which RTLY always owns when it paints IranYekan) and the bookkeeping
// markers are always cleared.
function cleanupRTLYElement(el) {
  try {
    const ownsDir = el.dataset.rtlyDir !== undefined;     // real dir (rtl/ltr) set by us
    const ownsAutoDir = el.dataset.rtlyAutoDir === "1";   // dir="auto" set by us
    if (ownsDir) {
      el.removeAttribute("dir");
      el.style.removeProperty("direction");
      el.style.removeProperty("text-align");
    } else if (ownsAutoDir) {
      el.removeAttribute("dir");
    }
    // NOTE: when neither marker is present the element had a NATIVE dir (or no
    // dir) that RTLY never created — leave its dir/direction/text-align alone.
    el.removeAttribute("data-rtly-processed");
    el.removeAttribute("data-rtly-dir");
    el.removeAttribute("data-rtly-auto-dir");
    el.removeAttribute("data-rtly-text");
    el.removeAttribute("data-rtly-tc");
    el.style.removeProperty("font-family");
    el.style.removeProperty("font-size");
  } catch (_) {}
}

function reapplyRTLY() {
  if (!siteKey || !CONFIG.SITES[siteKey]) return;
  // Cache bust — settings or display state may have changed; force a fresh
  // pass through isInSidebarOrMenu / isIcon / shouldSkipFont.
  bustCaches();

  document.querySelectorAll("[data-rtly-processed]").forEach(cleanupRTLYElement);
  const cfg = CONFIG.SITES[siteKey];
  cfg.inputs.forEach((sel) => {
    try {
      document.querySelectorAll(sel).forEach(applyDirectionAndFont);
    } catch (e) {}
  });
  cfg.responses.forEach((sel) => {
    try {
      document.querySelectorAll(sel).forEach(applyDirectionAndFont);
    } catch (e) {}
  });

  // Dispatch navigation event so the response observers re-run their full
  // process() including heuristic FA scan and Gemini broad scan. Without
  // this, elements processed via heuristic paths (not in cfg.responses)
  // would lose direction/font after a reapply.
  try {
    window.dispatchEvent(new Event("rtly:navigation"));
  } catch (_) {}
}

function setupMessageListener() {
  if (!chrome?.runtime?.onMessage?.addListener) return;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Defense-in-depth: only accept messages from our own extension.
    // Note: using strict comparison rather than `sender.id &&` — the latter
    // allowed undefined sender.id to pass through.
    if (sender?.id !== chrome.runtime.id) return false;
    if (msg?.action === "reapply") {
      reapplyRTLY();
      sendResponse({ ok: true });
      return false; // sync response — don't keep channel open
    }
    return false;
  });
}

// ---------- Navigation hook ----------
function patchHistory() {
  // Content scripts run in an isolated world, so patching history.pushState
  // would not see the page's own calls. The Navigation API (Chrome 102+,
  // Firefox 147+) fires for every same-document navigation; a cheap URL poll
  // covers browsers without it.
  const fire = () => window.dispatchEvent(new Event("rtly:navigation"));
  let lastHref = location.href;
  const check = () => { if (location.href !== lastHref) { lastHref = location.href; fire(); } };
  if (window.navigation && typeof window.navigation.addEventListener === "function") {
    window.navigation.addEventListener("navigatesuccess", check);
  } else {
    trackInterval(setInterval(check, 1000));
  }
  window.addEventListener("popstate", check);
  window.addEventListener("hashchange", check);
}

// ---------- Domain gate + entry point (moved here to avoid TDZ) ----------
// All const/let above are now initialized before bootstrap() runs.
if (typeof window !== "undefined" && window.__RTLY_TEST__) {
  // Test harness only (never set in the real extension): expose internals for
  // unit tests and do NOT bootstrap — no observers, timers, or chrome.* calls.
  // This block is inert in the browser because __RTLY_TEST__ is undefined.
  window.__RTLY_TEST_API__ = {
    AR_FA_WORD,
    AR_FA_STRONG_MARKER,
    detectDirection,
    isInSidebarOrMenu,
    applyDirectionAndFont,
    CONFIG,
    BODY_CLASS_MAP,
    CANONICAL,
    TARGET_DOMAINS,
    siteKey,
    LAYOUT_LTR_SITES,
    HEURISTIC_FA_SCAN_SITES,
    NARROW_ICON_SITES,
    CLEANUP_STALE_MARK_SITES,
  };
} else if (!siteKey) {
  log("Non-target domain, exiting content script");
} else if (window.__RTLY_CONTENT_V1__) {
  log("Already initialized, skipping");
} else {
  window.__RTLY_CONTENT_V1__ = true;
  bootstrap();
}
