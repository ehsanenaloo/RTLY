// RTLY content script: sets text direction and the Persian and Arabic fonts on supported
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
  "notebook.google.com", // NotebookLM's new address ("Gemini Notebook")
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
  "notebook.google.com": "notebooklm.google.com",
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
// One internal font family, filled by injectFonts() from the font the user picked. Inline styles and
// CSS refer to this name only, so a font change just rewrites the @font-face rules. FONT_MARK is the
// prefix any inline font-family written by RTLY contains.
const FONT_MARK = "RTLY Font";
const FONT_TAIL = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const FONT_STACK = "'" + FONT_MARK + "', " + FONT_TAIL;
// True for an inline font-family written by RTLY. Older versions wrote "IranYekan"; a page can keep such
// a style (a site that stores message HTML), so it counts as ours and is rewritten or removed.
// Exact inline values older versions wrote. A page-authored font-family that merely mentions IranYekan
// is not an RTLY leftover and is never touched.
const LEGACY_FONT_VALUES = new Set([
  'IranYekan, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  '"RTLY Latin Digits", IranYekan, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
]);
const isLegacyRtlyFont = (value) => !!value && LEGACY_FONT_VALUES.has(value);
const isRtlyFont = (value) => !!value && (value.includes(FONT_MARK) || isLegacyRtlyFont(value));

// What the page had in the dir attribute before RTLY first wrote it, so a disable puts it back:
// el -> { dir: { orig, ours } }. orig is null when the element already carried RTLY marks (restored HTML).
const ownedOrig = new WeakMap();
const ownedRecord = (el) => {
  let rec = ownedOrig.get(el);
  if (!rec) { rec = Object.create(null); ownedOrig.set(el, rec); }
  return rec;
};
// Direction, alignment, bidi and font are not written as inline styles. Each one is an attribute
// (data-rtly-s-*), and one stylesheet (ownedStyleCss) turns the attributes into !important declarations.
// On a long page an attribute costs the browser much less than an inline style, and the page's own
// inline styles are never touched. Values: direction rtl|ltr, text-align start|left|right,
// text-align-last auto, unicode-bidi isolate|plaintext, font-family rtl (FONT_STACK) | ltr (FONT_STACK_LTR).
const OWNED_STYLE_ATTR = {
  "direction": "data-rtly-s-dir",
  "text-align": "data-rtly-s-align",
  "text-align-last": "data-rtly-s-last",
  "unicode-bidi": "data-rtly-s-bidi",
  "font-family": "data-rtly-s-font",
};
const OWNED_STYLE_SELECTOR = Object.values(OWNED_STYLE_ATTR).map((a) => "[" + a + "]").join(", ");
const ownedStyleToken = (prop, value) => (prop === "font-family" ? (value === FONT_STACK_LTR ? "ltr" : "rtl") : value);

function setOwnedStyle(el, prop, value) {
  ensureOwnedStyleSheet();
  const name = OWNED_STYLE_ATTR[prop];
  const token = ownedStyleToken(prop, value);
  if (el.getAttribute(name) !== token) el.setAttribute(name, token);
}

// The value RTLY set for `prop` on `el` (as passed to setOwnedStyle), or "" when it set none.
function ownedStyle(el, prop) {
  const token = el.getAttribute(OWNED_STYLE_ATTR[prop]);
  if (token === null) return "";
  if (prop === "font-family") return token === "ltr" ? FONT_STACK_LTR : FONT_STACK;
  return token;
}

// Inline !important values written by an RTLY build that styled inline (a tab open during an update, or a
// site that stores message HTML) are recognised by the marks next to them and by a value RTLY writes,
// and removed too. Any other inline value belongs to the page.
const INLINE_RTLY_VALUES = {
  "direction": ["rtl", "ltr"],
  "text-align": ["start", "left", "right"],
  "text-align-last": ["auto"],
  "unicode-bidi": ["isolate", "plaintext"],
};
const carriesInlineRtlyStyle = (el, prop) => {
  if (!el.style) return false;
  const value = el.style.getPropertyValue(prop);
  if (!value) return false;
  if (prop === "font-family") return isRtlyFont(el.style.fontFamily);
  const d = el.dataset;
  const marked = d.rtlyDir !== undefined || d.rtlyKeep !== undefined || d.rtlyLine !== undefined;
  return marked && el.style.getPropertyPriority(prop) === "important" && INLINE_RTLY_VALUES[prop].includes(value);
};

function releaseOwnedStyle(el, prop) {
  const name = OWNED_STYLE_ATTR[prop];
  if (el.hasAttribute(name)) el.removeAttribute(name);
  if (carriesInlineRtlyStyle(el, prop)) el.style.removeProperty(prop);
}

// The rules sit in a cascade layer in a <style> placed first in <head>. For !important declarations an
// earlier layer beats every later layer and all unlayered rules, whatever their specificity, so the page's
// !important rules (Tailwind utilities are layered) and RTLY's own site CSS cannot override them. Only an
// inline !important value of the page itself wins.
const OWNED_STYLE_ID = "rtly-owned-styles";
function ownedStyleCss() {
  const a = OWNED_STYLE_ATTR;
  return `@layer rtly-owned {
[${a["direction"]}="rtl"] { direction: rtl !important; }
[${a["direction"]}="ltr"] { direction: ltr !important; }
[${a["text-align"]}="start"] { text-align: start !important; }
[${a["text-align"]}="left"] { text-align: left !important; }
[${a["text-align"]}="right"] { text-align: right !important; }
[${a["text-align-last"]}="auto"] { text-align-last: auto !important; }
[${a["unicode-bidi"]}="isolate"] { unicode-bidi: isolate !important; }
[${a["unicode-bidi"]}="plaintext"] { unicode-bidi: plaintext !important; }
[${a["font-family"]}="rtl"] { font-family: ${FONT_STACK} !important; }
[${a["font-family"]}="ltr"] { font-family: ${FONT_STACK_LTR} !important; }
[data-rtly-keep="formula"], [data-rtly-keep="formula"] * { direction: ltr !important; }
}`;
}
let ownedStyleEl = null;
function ensureOwnedStyleSheet() {
  if (ownedStyleEl && ownedStyleEl.isConnected) return;
  try {
    ownedStyleEl = document.getElementById(OWNED_STYLE_ID) || document.createElement("style");
    ownedStyleEl.id = OWNED_STYLE_ID;
    const css = ownedStyleCss();
    if (ownedStyleEl.textContent !== css) ownedStyleEl.textContent = css;
    const parent = document.head || document.documentElement;
    if (parent.firstChild !== ownedStyleEl) parent.insertBefore(ownedStyleEl, parent.firstChild);
  } catch (_) {}
}
function removeOwnedStyleSheet() {
  const el = ownedStyleEl || document.getElementById(OWNED_STYLE_ID);
  if (el) el.remove();
  ownedStyleEl = null;
}

function setOwnedDir(el, dir) {
  const rec = ownedRecord(el);
  if (!rec.dir) rec.dir = { orig: el.dataset.rtlyDir !== undefined ? null : el.getAttribute("dir"), ours: "" };
  el.setAttribute("dir", dir);
  rec.dir.ours = dir;
}

// Returns true when it handled the dir attribute (a record existed).
function releaseOwnedDir(el) {
  const rec = ownedOrig.get(el);
  const own = rec && rec.dir;
  if (!own) return false;
  if (el.getAttribute("dir") === own.ours) {
    if (own.orig !== null) el.setAttribute("dir", own.orig);
    else el.removeAttribute("dir");
  }
  delete rec.dir;
  return true;
}
// For text RTLY resolved as LTR (English-majority text that merely contains some Persian, or an
// English island inside a Persian message) a digits-only face is placed FIRST: "RTLY Latin Digits"
// maps U+0030-0039 to a system font (see injectFonts), so ASCII digits stay Latin even in a font
// that draws them as Persian digits.
const FONT_STACK_LTR = "'RTLY Latin Digits', " + FONT_STACK;

// Bundled open-source fonts (SIL OFL, see fonts/LICENSES.txt). Each entry is [file prefix, unicode-range
// or null]; the options page lists the same ids (pages/options/options.js FONT_CHOICES). The user
// always has exactly one active: a Persian font or an Arabic font.
const FA_RANGE = "U+0600-06FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE80-FEFC";
const LATIN_RANGE = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const FONT_CATALOG = {
  // The Farsi-digits build of Vazirmatn: ASCII digits are drawn as Persian digits (DEC-009).
  vazirmatn: [["vazirmatn-fd", null]],
  // Estedad draws ASCII digits as Latin; the digits of the Farsi-digits Vazirmatn are added last so
  // Persian text keeps Persian digits with this font too.
  estedad: [["estedad-fa", FA_RANGE], ["estedad-latin", LATIN_RANGE], ["vazirmatn-fd", "U+0030-0039"]],
  "noto-naskh": [["noto-naskh-ar", FA_RANGE]],
  "noto-sans": [["noto-sans-ar", FA_RANGE]],
  amiri: [["amiri-ar", FA_RANGE]],
  cairo: [["cairo-ar", FA_RANGE]],
  tajawal: [["tajawal-ar", FA_RANGE]],
};
const DEFAULT_FONT = "vazirmatn";

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
const LIST_DIRECTION_SITES = sitesWithFlag("listDirection");       // list wrappers take their direction from their first text block
const COMPREHENSIVE_SELECTOR_SITES = sitesWithFlag("comprehensiveSelectors"); // response selectors cover the whole conversation → skip the generic whole-main fallback FA scan

let SETTINGS = {
  fontScale: 100,
  siteModes: {},
  // "balanced": a line that starts with a Latin letter stays LTR unless Persian is >= 30% of it.
  // "persian": leans RTL even when the line starts in English (Persian threshold 20-30%).
  mixedDirection: "balanced",
  font: DEFAULT_FONT,
};

const pickFont = (id) => (Object.prototype.hasOwnProperty.call(FONT_CATALOG, id) ? id : DEFAULT_FONT);

// v1.9.20: set true only once initRTLY() runs (i.e. after the per-site
// enabled check passes). Gates page-level font scaling and live mode reapply
// so neither takes effect on a domain the user has disabled RTLY for.
let rtlyActive = false;
// v2.0: set once when the site is switched off live (storage.onChanged). From then on every
// entry point that could write to the page is a no-op; deactivateRTLY() already removed what we wrote.
let rtlyStopped = false;

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

// Cheap text fingerprint: "<length>.<32-bit FNV-1a hash in base36>". Used for the
// data-rtly-tc / data-rtly-text bookkeeping attributes instead of storing the full
// text of every processed element (a long thread would otherwise keep a second copy
// of every message in the DOM). The length makes a hash collision on a changed text
// practically impossible. Written AND compared through this one function.
function fp(text) {
  const s = text || "";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return s.length + "." + (h >>> 0).toString(36);
}

// Cache buster — bumped on settings change or SPA navigation so cached results
// don't outlive layout/structural changes that could affect ancestor checks.
let cacheGeneration = 0;
function bustCaches() {
  cacheGeneration++;
  // WeakMap has no .clear(); we discriminate by checking generation tag on values.
  resetSidebarAncestors();
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
// SPA navigation handlers: removed at teardown, so they never outlive the site being switched off.
function onNavigation(handler) {
  window.addEventListener("rtly:navigation", handler);
  registerTeardown(() => window.removeEventListener("rtly:navigation", handler));
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
      ["fontScale", "siteModes", "mixedDirection", "font"],
      (r) => {
        if (!chrome.runtime?.lastError && r) {
          if (r.mixedDirection === "persian") SETTINGS.mixedDirection = "persian";
          SETTINGS.font = pickFont(r.font);
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

// The user's font scale is written as an inline font-size on <html>. We remember what the site had
// there (some sites set one) and put it back when the scale returns to 100% or RTLY switches off,
// instead of blindly deleting the property.
let scaleOwnsFontSize = false;
let prevRootFontSize = { value: "", priority: "" };
function restoreRootFontSize(root) {
  if (!scaleOwnsFontSize) return;
  scaleOwnsFontSize = false;
  root.style.removeProperty("font-size");
  if (prevRootFontSize.value) root.style.setProperty("font-size", prevRootFontSize.value, prevRootFontSize.priority);
}

function applyGlobalFontScale() {
  try {
    // v2.0: a site RTLY is not active on (disabled, or not yet past the enabled check) receives
    // NOTHING: no :root custom properties, no font-size. Callers that run before activation
    // (loadSettings, the storage listener) therefore have no side effect on disabled sites.
    if (!rtlyActive) return;
    const root = document && document.documentElement ? document.documentElement : null;
    if (!root) return;

    const scale = (SETTINGS && SETTINGS.fontScale) || 100;
    // v2.0: no inline custom properties on <html> any more. --rtly-font-scale had no reader and
    // --rtly-font-family now comes from the stylesheet (base.css, html.rtly-active), so the only
    // thing RTLY ever writes on <html> is the user's font-size scale.

    // Apply scale ONCE on :root so child em/rem values cascade naturally without
    // compounding. Only when scale != 100 to avoid disturbing default UA size.
    //
    // Use percentage rather than `calc(16px * scale/100)` — the latter forces
    // base to 16px and overrides a user's accessibility-adjusted browser
    // default font size. Percentage scales relative to whatever the user has
    // configured, preserving their setup.
    // The page-level font-size override is the user's font scale (permitted layout input);
    // at 100% nothing is written.
    if (scale !== 100) {
      if (!scaleOwnsFontSize) {
        prevRootFontSize = { value: root.style.getPropertyValue("font-size"), priority: root.style.getPropertyPriority("font-size") };
        scaleOwnsFontSize = true;
      }
      root.style.setProperty("font-size", `${scale}%`, "important");
    } else {
      restoreRootFontSize(root);
    }
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

// Joined response selectors of THIS site (used to recognise message-list wrappers, see
// isMessageListWrapper). Empty on unknown sites.
const RESPONSE_SELECTOR = (() => {
  const c = SITE_CFG[siteKey];
  return c && Array.isArray(c.responses) && c.responses.length ? c.responses.join(", ") : "";
})();

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

// Persian function words and verb forms: they show the grammar of a sentence, not its topic.
const PERSIAN_GRAMMAR_WORDS = new Set([
  "است", "هست", "نیست", "بود", "یک", "برای", "با", "از", "به", "در", "را", "که", "و", "هم", "این", "آن",
  "مثل", "یا", "نه", "اما", "ولی", "تا", "اگر", "چون", "بین", "روی", "بدون", "دارد", "دارند", "شود",
  "شده", "کرد", "کند", "کنید", "باید", "نباید",
]);
function countPersianGrammarWords(text) {
  let n = 0;
  const words = text.split(/[\s،؛؟.,:;!?()[\]"'«»\-–—/]+/);
  for (let i = 0; i < words.length && n < 2; i++) {
    const w = words[i];
    if (PERSIAN_GRAMMAR_WORDS.has(w) || /^ن?می‌/.test(w)) n++;
  }
  return n;
}

// `grammarWords: false` for text that holds a code block: Persian comments in code say nothing about the
// language of the message around it.
function detectDirection(text = "", { grammarWords = true } = {}) {
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
  let firstStrong = 0; // 1 = Latin letter came first, 2 = RTL character came first
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    // ASCII letter ranges first (most common in mixed text, fast path)
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      ltrChars++;
      if (!firstStrong) firstStrong = 1;
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
      if (!firstStrong) firstStrong = 2;
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
  const ratio = rtlChars / totalScripted;
  // "balanced" (default): a text that STARTS with a Latin letter is an English sentence unless
  // Persian is at least 30% of it. No grammatical-marker discount for these, so an English
  // sentence that merely ends in a Persian word keeps its period and word order. Persian text
  // that opens with a Latin term ("Docker یک ابزار است") is still RTL, being over 30% Persian.
  // Long English terms can keep a Persian sentence under 30% ("BMAD یک framework برای ... است"); two Persian
  // grammar words still mark the sentence as Persian. Nouns do not count, so "... food is قورمه‌سبزی." stays ltr,
  // and a short Persian sentence before a long English text (under 15%) does not turn the whole block.
  if (firstStrong === 1 && SETTINGS.mixedDirection !== "persian") {
    return ratio >= 0.30 || (grammarWords && ratio >= 0.15 && countPersianGrammarWords(text) >= 2) ? "rtl" : "ltr";
  }
  const threshold = AR_FA_STRONG_MARKER.test(text) ? 0.20 : 0.30;
  return ratio >= threshold ? "rtl" : "ltr";
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
// What an app shell holds and a sidebar does not.
const APP_SHELL_MARKER = "main, [role='main'], textarea, [contenteditable='true']";
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

// Nearest element at or above `el` that matches SIDEBAR_SELECTOR, or null. An app-shell element
// (the page root with a class like `side-nav-open` or `sidebar-wrapper`) matches the heuristic too,
// but it holds the whole app, so it says nothing about the elements below it: a real sidebar never
// contains the main area or the composer. Each element tests the selector list once and reuses its
// parent's answer, because `closest()` with this list re-tests every ancestor and costs about 1 ms
// per call under ChatGPT's deep tree of long class lists. The answers live until the next response
// pass (each pass follows a page mutation) or cache bust: classes such as `side-nav-open` change,
// and an app shell may not hold the main area yet when the sidebar is processed first.
let sidebarAncestorCache = new WeakMap();
function resetSidebarAncestors() {
  sidebarAncestorCache = new WeakMap();
}
function sidebarAncestor(el) {
  const chain = [];
  let value = null;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (sidebarAncestorCache.has(n)) { value = sidebarAncestorCache.get(n); break; }
    chain.push(n);
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i];
    if (n.matches(SIDEBAR_SELECTOR) && !n.querySelector(APP_SHELL_MARKER)) value = n;
    sidebarAncestorCache.set(n, value);
  }
  return value;
}

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

  // Gemini: the app root carries `side-nav-open` while the sidebar is expanded, which matches the
  // broad `[class*='nav']` heuristic for every element below it. Conversation turns are never chrome.
  if (siteKey === "gemini.google.com" &&
      el.closest &&
      el.closest("user-query, model-response, message-content")) {
    return false;
  }

  // Grok: the whole app sits inside a `group/sidebar-wrapper` element that matches the broad
  // `[class*='sidebar']` heuristic. Message bubbles are never chrome.
  if (siteKey === "grok.com" && el.closest && el.closest(".message-bubble")) return false;

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

  const closest = el.matches && el.matches(SIDEBAR_SELECTOR) ? el : sidebarAncestor(el.parentElement);
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
  // Element is an icon-font container: applying the RTLY font would replace the
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
  if (canonicalSite === "notebooklm.google.com") {
    if (el.closest("header, [role='toolbar'], .toolbar, .mdc-top-app-bar")) return true;
  }
  return false;
}

// True when `el` is the layout wrapper of a message list: it contains two or more TOP-LEVEL
// response-selector matches with the same tag + class (i.e. repeated message roots). Nested
// matches inside one message (e.g. .font-claude-response > .standard-markdown) do not count, and
// neither do heterogeneous siblings, so a single message root is never mistaken for a wrapper.
// Known limit: a thread holding a single message is not recognised (it behaves as before).
function isMessageListWrapper(el) {
  if (!RESPONSE_SELECTOR || typeof el.querySelector !== "function") return false;
  try {
    if (!el.querySelector(RESPONSE_SELECTOR)) return false;
    const hits = el.querySelectorAll(RESPONSE_SELECTOR);
    const seen = new Map();
    let top = null;
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (top && top.contains(h)) continue;
      top = h;
      const k = h.tagName + "|" + (h.getAttribute("class") || "");
      const n = (seen.get(k) || 0) + 1;
      if (n >= 2) return true;
      seen.set(k, n);
    }
  } catch (_) {}
  return false;
}

// Remove direction / font state RTLY itself wrote onto an element that turned out to be a layout
// wrapper (ownership-aware: native dir / inline styles of the site are left alone).
function releaseWrapper(el) {
  if (el.dataset.rtlyDir !== undefined) {
    el.removeAttribute("dir");
    releaseOwnedStyle(el, "direction");
    releaseOwnedStyle(el, "text-align");
    el.removeAttribute("data-rtly-dir");
  } else if (el.dataset.rtlyAutoDir === "1") {
    el.removeAttribute("dir");
    el.removeAttribute("data-rtly-auto-dir");
  }
  if (el.dataset.rtlyText !== undefined) el.removeAttribute("data-rtly-text");
  releaseOwnedStyle(el, "font-family");
}

// True when an ancestor carries an RTLY font (so `el` inherits it).
function inheritsInlineFont(el) {
  let p = el.parentElement;
  for (let i = 0; p && i < 40 && p !== document.body; i++, p = p.parentElement) {
    if (p.hasAttribute(OWNED_STYLE_ATTR["font-family"]) || (p.style && isRtlyFont(p.style.fontFamily))) return true;
  }
  return false;
}

// CodeMirror, Monaco, and Copilot's code viewer.
const CODE_EDITOR_SELECTOR = ".cm-editor, .monaco-editor, [class*='scriptor-component-code-block']";

// Sites whose list items wrap their text in nested blocks: the text blocks get their own
// direction, but the <li> / <ol> / <ul> around them keep the page default, so the marker and the
// indent sit on the wrong side. Give each list element the direction of its first text block
// (ownership-marked, so cleanup removes exactly this).
// Direction of the first ~160 characters of `node`'s own text. Text inside a nested list is
// left out, so an English item that owns a Persian sub-list stays left-to-right.
function leadingTextDirection(node) {
  let text = "";
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t && text.length < 160; t = walker.nextNode()) {
    const nested = t.parentElement && t.parentElement.closest("ol, ul");
    if (nested && nested !== node && node.contains(nested)) continue;
    if (t.parentElement && t.parentElement.closest(MATH_SELECTOR)) continue;
    text += t.nodeValue;
  }
  text = text.replace(/\$\$[^$]{1,400}\$\$|\$[^$\n]{1,200}\$/g, " ").trim();
  return text ? detectDirection(text) : "none";
}

// A list reads best with ONE direction: marker, indent and every item on the same side. The
// list takes the direction most of its items start with (ties: the first item); each item follows
// its list. An item whose own text goes the other way keeps its text direction but is aligned to
// the list's side, so the marker and its text stay next to each other.
function listMajorityDirection(list) {
  let rtl = 0, ltr = 0, first = "none";
  const items = list.children;
  for (let i = 0; i < items.length && i < 40; i++) {
    if (items[i].tagName !== "LI") continue;
    const d = leadingTextDirection(items[i]);
    if (d === "rtl") rtl++; else if (d === "ltr") ltr++; else continue;
    if (first === "none") first = d;
  }
  if (rtl === ltr) return first;
  return rtl > ltr ? "rtl" : "ltr";
}

function setOwnedDirection(node, dir) {
  // A list element takes the list's direction, not its first letter (a site rule such as z.ai's
  // `[data-expanded] * { unicode-bidi: plaintext }` would hand it back to the first letter).
  if (ownedStyle(node, "unicode-bidi") !== "isolate") setOwnedStyle(node, "unicode-bidi", "isolate");
  if (node.dataset.rtlyDir === dir && node.getAttribute("dir") === dir) return;
  setOwnedDir(node, dir);
  setOwnedStyle(node, "direction", dir);
  setOwnedStyle(node, "text-align", "start");
  node.dataset.rtlyDir = dir;
}

function syncListDirection(root) {
  const mode = getEffectiveMode();
  if (mode !== "full" && mode !== "rtl_only") return;
  const nodes = root.querySelectorAll("ol, ul, li");
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.closest("pre, code") || isInSidebarOrMenu(node)) continue;
    const ownDir = node.getAttribute("dir");
    if ((ownDir === "rtl" || ownDir === "ltr") && node.dataset.rtlyDir === undefined) continue; // site's own dir
    if (node.tagName === "LI") {
      const list = node.parentElement;
      // The list's direction: its own mark, else the majority of its items (the parent can be a custom
      // element that is not an ol/ul and carries no mark), else this item's own text.
      let listDir = list && (list.dataset.rtlyDir === "rtl" || list.dataset.rtlyDir === "ltr") ? list.dataset.rtlyDir : null;
      // Items wrapped in custom elements (NotebookLM) have no ol/ul as parent: use the closest list around.
      if (!listDir && list && list.tagName !== "OL" && list.tagName !== "UL") {
        const around = list.closest("ol, ul");
        if (around && (around.dataset.rtlyDir === "rtl" || around.dataset.rtlyDir === "ltr")) listDir = around.dataset.rtlyDir;
      }
      if (!listDir && list) {
        const majority = listMajorityDirection(list);
        if (majority === "rtl" || majority === "ltr") listDir = majority;
      }
      const dir = listDir || leadingTextDirection(node);
      if (dir !== "rtl" && dir !== "ltr") continue;
      setOwnedDirection(node, dir);
      applyListItemFont(node);
      // Text blocks of this item that run the other way: keep their direction, align to the list side.
      const side = dir === "rtl" ? "right" : "left";
      const blocks = node.querySelectorAll("[data-rtly-dir]");
      for (let j = 0; j < blocks.length; j++) {
        const b = blocks[j];
        if (b.dataset.rtlyDir === dir || b.closest("li") !== node) continue;
        if (ownedStyle(b, "text-align") !== side) {
          setOwnedStyle(b, "text-align", side);
          // Gemini sets text-align-last: start, which would keep a one-line block on the wrong side.
          setOwnedStyle(b, "text-align-last", "auto");
        }
      }
    } else {
      // A nested list follows the list around it, so one list never reads in two directions. A list right
      // after a right-to-left text block ("کار اصلی‌اش:") belongs to that sentence, even when most of its
      // items are English terms; its English items keep their own direction on the list side.
      const outer = node.parentElement && node.parentElement.closest("ol, ul");
      const outerDir = outer && outer.dataset.rtlyDir;
      const intro = !outer && node.previousElementSibling;
      const dir = outerDir === "rtl" || outerDir === "ltr" ? outerDir
        : intro && intro.dataset.rtlyDir === "rtl" ? "rtl"
        : listMajorityDirection(node);
      if (dir !== "rtl" && dir !== "ltr") continue;
      setOwnedDirection(node, dir);
    }
  }
}

// A block that RTLY made left-to-right but whose context reads right-to-left follows the context
// (`data-rtly-follow` keeps it there while its text is the same). Its inline parts get no own direction
// (see applyDirectionAndFont): drop what an earlier pass gave them.
function followDirection(el, dir) {
  setOwnedDirection(el, dir);
  el.dataset.rtlyFollow = dir;
  el.querySelectorAll("[data-rtly-dir]").forEach((c) => {
    if (!INLINE_TAGS.has(c.tagName) || c.matches(MATH_SELECTOR)) return;
    if (!releaseOwnedDir(c)) c.removeAttribute("dir");
    ["direction", "text-align", "text-align-last", "unicode-bidi"].forEach((p) => releaseOwnedStyle(c, p));
    c.removeAttribute("data-rtly-dir");
  });
}

function countDirections(nodes, limit = 400) {
  let rtl = 0, ltr = 0;
  for (let i = 0; i < nodes.length && i < limit; i++) {
    const d = nodes[i] && nodes[i].dataset.rtlyDir;
    if (d === "rtl") rtl++; else if (d === "ltr") ltr++;
  }
  return { rtl, ltr };
}

// The headings of one answer read in one direction. When most text blocks of the answer are right-to-left,
// a heading with Arabic-script text that started with an English name ("5. OpenHands — مناسب agent platform")
// follows them. Headings without Arabic-script text keep their own direction.
function syncHeadingDirection(root) {
  const mode = getEffectiveMode();
  if (mode !== "full" && mode !== "rtl_only") return;
  const headings = root.querySelectorAll(HEADING_SELECTOR);
  if (!headings.length) return;
  const { rtl, ltr } = countDirections(root.querySelectorAll("p[data-rtly-dir], li[data-rtly-dir]"));
  if (rtl <= ltr) return;
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    if (h.dataset.rtlyDir !== "ltr" || h.closest("pre, code") || isInSidebarOrMenu(h)) continue;
    if (AR_FA_WORD.test(h.textContent || "")) followDirection(h, "rtl");
  }
}

// The cells of one table read in one direction. When most cells are right-to-left, a cell with Arabic-script
// text that started with an English word ("Buildهای Debug") follows the table; an English-only cell keeps
// its direction and is aligned to the table side, like an English item of a Persian list.
function syncTableDirection(root) {
  const mode = getEffectiveMode();
  if (mode !== "full" && mode !== "rtl_only") return;
  const tables = root.querySelectorAll("table");
  for (let t = 0; t < tables.length && t < 40; t++) {
    const table = tables[t];
    if (table.closest("pre, code") || isInSidebarOrMenu(table)) continue;
    const cells = table.querySelectorAll("th, td");
    const blocks = [];
    for (let i = 0; i < cells.length && i < 400; i++) {
      const c = cells[i];
      if (c.dataset.rtlyDir !== undefined) { blocks.push(c); continue; }
      const inner = c.querySelectorAll("[data-rtly-dir]");
      for (let j = 0; j < inner.length; j++) if (!INLINE_TAGS.has(inner[j].tagName)) blocks.push(inner[j]);
    }
    // The header row names the columns in the language of the answer: it decides when it has a direction.
    // Without it, the cells vote (sizes like "15.43 GB" and names like "Build Cache" can tie the vote).
    const head = countDirections(blocks.filter((b) => b.closest("th")));
    const all = countDirections(blocks);
    if (head.rtl + head.ltr ? head.rtl <= head.ltr : all.rtl <= all.ltr) continue;
    const toSide = (b) => {
      if (ownedStyle(b, "text-align") === "right") return;
      setOwnedStyle(b, "text-align", "right");
      setOwnedStyle(b, "text-align-last", "auto");
    };
    for (const b of blocks) {
      if (b.dataset.rtlyDir !== "ltr") continue;
      if (AR_FA_WORD.test(b.textContent || "")) followDirection(b, "rtl");
      else toSide(b);
    }
    // An English cell whose text sits directly in inline elements (AI Studio: a span RTLY made left-to-right)
    // has no block above: the cell itself is aligned to the table side, its direction stays.
    for (let i = 0; i < cells.length && i < 400; i++) {
      const c = cells[i];
      if (c.dataset.rtlyDir !== undefined || AR_FA_WORD.test(c.textContent || "")) continue;
      if (blocks.some((b) => c.contains(b))) continue;
      if (c.querySelector('[data-rtly-dir="ltr"]')) toSide(c);
    }
  }
}

// Font for a list item's own text (its direct text nodes; nested blocks and lists get theirs separately).
// Arabic-script text gets the RTLY font. English text with digits inside a styled Persian list gets the
// Latin-digits stack, so its ASCII digits are not drawn as Persian digits.
function applyListItemFont(li) {
  if (ownedStyle(li, "font-family")) return;
  const mode = getEffectiveMode();
  if (mode !== "full" && mode !== "font_only") return;
  let own = "";
  for (let n = li.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) own += n.nodeValue;
  if (shouldSkipFont(li)) return;
  if (AR_FA_WORD.test(own)) setOwnedStyle(li, "font-family", FONT_STACK);
  else if (/[A-Za-z]/.test(own) && /[0-9]/.test(own) && inheritsInlineFont(li)) setOwnedStyle(li, "font-family", FONT_STACK_LTR);
}

// Some sites force direction on every descendant of a right-to-left answer with !important rules (z.ai draws
// code with CodeMirror inside such an answer). The editor and its lines get RTLY's own left-to-right value,
// which out-ranks those rules (see ownedStyleCss). Lines are re-created while scrolling, hence one pass per tick.
// Formulas read left-to-right. A site or RTLY site rule that forces every descendant of a right-to-left block
// (some at a level a page rule cannot beat) would draw H₂O as O₂H; RTLY's own value out-ranks them all.
const FORMULA_SELECTOR = ".katex, mjx-container, math, .MathJax";
function keepFormulasLtr() {
  const mode = getEffectiveMode();
  if (mode !== "full" && mode !== "rtl_only") return;
  try {
    const found = document.querySelectorAll(FORMULA_SELECTOR);
    for (let i = 0; i < found.length && i < 2000; i++) {
      const el = found[i];
      if (el.parentElement && el.parentElement.closest(FORMULA_SELECTOR)) continue;
      // The owned rule for this mark also covers the formula's own parts, which such a rule reaches too.
      if (el.dataset.rtlyKeep !== "formula") el.dataset.rtlyKeep = "formula";
    }
  } catch (_) {}
}

function keepCodeEditorsLtr() {
  try {
    const editors = document.querySelectorAll(CODE_EDITOR_SELECTOR);
    for (let i = 0; i < editors.length && i < 40; i++) {
      const parts = [editors[i], ...editors[i].querySelectorAll(".cm-content, .cm-line, .view-lines, .view-line")];
      for (let j = 0; j < parts.length && j < 400; j++) {
        const el = parts[j];
        if (ownedStyle(el, "direction") === "ltr" && ownedStyle(el, "text-align") === "left") continue;
        setOwnedStyle(el, "direction", "ltr");
        setOwnedStyle(el, "text-align", "left");
        if (el.dataset.rtlyKeep === undefined) el.dataset.rtlyKeep = "1";
      }
      // The card around the editor (language label, copy button) keeps the page's own layout too: climb
      // while the ancestor holds little besides the code.
      const codeLen = editors[i].textContent.length;
      let card = editors[i].parentElement;
      for (let k = 0; k < 4 && card && card !== document.body; k++, card = card.parentElement) {
        if (card.textContent.length > codeLen * 1.3 + 40) break;
        if (ownedStyle(card, "direction") === "ltr") continue;
        setOwnedStyle(card, "direction", "ltr");
        if (card.dataset.rtlyKeep === undefined) card.dataset.rtlyKeep = "1";
      }
    }
  } catch (_) {}
}

const ICON_DESCENDANT_SELECTOR = "svg, img, picture, mat-icon, [data-icon], [data-icon-name], [data-lucide], [data-cds='Icon'], [data-cds='icon'], [data-mat-icon-name], [data-mat-icon-type], [style*='anthropicons' i], [style*='Anthropicons'], [style*='Material Symbols'], [style*='Material Icons'], [style*='Google Symbols'], [style*='Luminous Symbols'], [style*='lumi-symbols' i], [style*='FluentSystemIcons' i], [class*='icon' i], [class*='lucide' i], [class*='anthropicon' i], [class*='material-icons' i], [class*='material-symbols' i], [class*='google-symbols' i], [class*='lumi-symbols' i], [class*='lm-icon' i], [class*='mat-ligature-font' i], [class*='fluent-icon' i], [class*='ms-Icon' i], [class*='ant-icon' i], [class*='tabler-icon' i], [class*='phosphor' i], .anticon";
const TEXT_BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th";
const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
const INLINE_OWNER_SELECTOR = "p, h1, h2, h3, h4, h5, h6, blockquote, td, th";
const INLINE_TAGS = new Set(["SPAN", "STRONG", "B", "EM", "I", "A", "BDI", "MARK", "SMALL", "SUB", "SUP", "U", "S", "LABEL"]);
const MATH_SELECTOR =".katex, ms-katex, mjx-container, math, .MathJax, [class*='math-inline'], [class*='math-display']";

// The text used to pick a direction. Formulas (rendered, or written as $...$) are Latin letters that
// say nothing about the language of the sentence around them, and rendered ones repeat their source.
function textWithoutMath(el) {
  const raw = el.textContent || "";
  if (raw.length < 2) return raw;
  let text = raw;
  if (typeof el.querySelector === "function" && el.querySelector(MATH_SELECTOR)) {
    text = "";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(), i = 0; n && i < 20000 && text.length <= 5001; n = walker.nextNode(), i++) {
      const p = n.parentElement;
      if (p && p.closest(MATH_SELECTOR)) continue;
      text += n.nodeValue;
    }
  }
  if (text.indexOf("$") !== -1) text = text.replace(/\$\$[^$]{1,400}\$\$|\$[^$\n]{1,200}\$/g, " ");
  return text;
}

// Sidebar and menu text keeps its direction and layout, but Arabic-script text in it gets the RTLY font.
const SIDEBAR_FONT_ROOTS = "nav, aside, [role='navigation'], [class*='sidebar' i]";
function processSidebarFonts() {
  const mode = getEffectiveMode();
  if (mode !== "full" && mode !== "font_only") return;
  const family = getPreferredFontFamily();
  // A recycled sidebar node that now holds Latin-only text gives the font back.
  const had = document.querySelectorAll("[data-rtly-sbfont]");
  for (let i = 0; i < had.length && i < 400; i++) {
    if (!AR_FA_WORD.test(had[i].textContent || "")) {
      releaseOwnedStyle(had[i], "font-family");
      had[i].removeAttribute("data-rtly-sbfont");
    }
  }
  const roots = document.querySelectorAll(SIDEBAR_FONT_ROOTS);
  let done = 0;
  for (let r = 0; r < roots.length && r < 12 && done < 300; r++) {
    // A wrapper that holds the conversation or the composer is the app shell, not a sidebar.
    if (roots[r].querySelector("main, [role='main'], article, textarea, [contenteditable]")) continue;
    const walker = document.createTreeWalker(roots[r], NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(), i = 0; t && i < 2000 && done < 300; t = walker.nextNode(), i++) {
      if (!AR_FA_WORD.test(t.nodeValue)) continue;
      const el = t.parentElement;
      if (!el || el.dataset.rtlySbfont === "1" || el.closest("textarea, [contenteditable]") || shouldSkipFont(el)) continue;
      if (ownedStyle(el, "font-family")) continue;
      setOwnedStyle(el, "font-family", family);
      el.dataset.rtlySbfont = "1";
      done++;
    }
  }
}

// Composer text: the browser picks a line direction from its first strong letter, so "first دومین کلمه"
// (English word first, Persian after) is laid out left-to-right and reads as a jumble. A line whose first
// strong letter is Latin but whose text is mostly Arabic-script is given the right-to-left direction.
function firstStrongIsLatin(text) {
  for (let i = 0; i < text.length && i < 200; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) return true;
    if (c >= 0x0590 && c <= 0x08ff) return false;
  }
  return false;
}

function refineComposerLine(node, text) {
  const force = !!text && firstStrongIsLatin(text) && AR_FA_WORD.test(text) && detectDirection(text) === "rtl";
  if (force) {
    if (node.dataset.rtlyLine === "1" && ownedStyle(node, "direction") === "rtl") return;
    setOwnedStyle(node, "unicode-bidi", "isolate");
    setOwnedStyle(node, "direction", "rtl");
    node.dataset.rtlyLine = "1";
  } else if (node.dataset.rtlyLine === "1") {
    releaseOwnedStyle(node, "unicode-bidi");
    releaseOwnedStyle(node, "direction");
    node.removeAttribute("data-rtly-line");
  }
}

// Rich editors (ProseMirror) rebuild their line elements and drop inline styles on them, so a rich
// editor gets one flag on its root and a stylesheet rule (base.css) does the work.
function refineComposerLines(el) {
  try {
    if (el.value !== undefined) { refineComposerLine(el, el.value); return; }
    const texts = [];
    const kids = el.children;
    for (let i = 0; i < kids.length && i < 60; i++) {
      if (/^(P|DIV|LI)$/.test(kids[i].tagName)) texts.push(kids[i].textContent || "");
    }
    let own = "";
    for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) own += n.nodeValue;
    if (own.trim() || !texts.length) texts.push(own.trim() ? own : el.textContent || "");
    let force = false, other = false;
    for (const t of texts) {
      if (!t.trim()) continue;
      if (firstStrongIsLatin(t) && AR_FA_WORD.test(t) && detectDirection(t) === "rtl") force = true;
      else if (detectDirection(t) === "ltr") other = true;
    }
    if (force && !other) {
      if (el.dataset.rtlyLine !== "root") el.dataset.rtlyLine = "root";
    } else if (el.dataset.rtlyLine === "root") {
      el.removeAttribute("data-rtly-line");
    }
  } catch (_) {}
}

// plaintext gives every line its own direction, but it ignores the strong letters of inline children (they
// are isolated), so a block whose text sits in inline spans would resolve to left-to-right.
function canUsePlaintext(el) {
  if (getComputedStyle(el).display === "inline") return false;
  const kids = el.children;
  for (let i = 0; i < kids.length && i < 20; i++) {
    if (kids[i].textContent && kids[i].textContent.trim() && getComputedStyle(kids[i]).display === "inline") return false;
  }
  return true;
}

// True when the text has several lines and at least one of them is left-to-right. Lines that mostly start
// with a number or a bullet ("۱. خرید نان", "۲. Check the email") are a list: they share the block's
// direction, so their numbers stay on one side.
function hasLtrLine(text) {
  if (!text || text.indexOf("\n") === -1) return false;
  const lines = text.split("\n");
  const filled = lines.filter((l) => l.trim());
  const marked = filled.filter((l) => /^\s*([0-9۰-۹٠-٩]+[.)\-٫]|[-*•▪●])\s/.test(l));
  if (filled.length >= 2 && marked.length * 2 >= filled.length) return false;
  for (let i = 0; i < lines.length && i < 50; i++) {
    const line = lines[i].trim();
    if (line.length >= 3 && detectDirection(line) === "ltr") return true;
  }
  return false;
}

// A flex row with exactly one child that is pushed to the end of the line.
function isEndAlignedFlexRow(el) {
  if (el.childElementCount !== 1 || (el.tagName !== "DIV" && el.tagName !== "SECTION")) return false;
  // getComputedStyle forces a style recalculation, and this runs on thousands of single-child divs while RTLY
  // is writing styles: only a row whose class or inline style asks to be pushed to the end is measured.
  const hint = (typeof el.className === "string" ? el.className : "") + " " + (el.getAttribute("style") || "");
  if (!/justify-end|justify-content\s*:\s*(flex-)?(end|right)/i.test(hint)) return false;
  const cs = getComputedStyle(el);
  return (cs.display === "flex" || cs.display === "inline-flex") &&
    (cs.flexDirection === "row") && /^(flex-end|end|right)$/.test(cs.justifyContent);
}

function applyDirectionAndFont(el) {
  try {
    if (!el || !el.nodeType || el.nodeType !== 1) return;
    if (rtlyStopped) return; // site was switched off live: never write again
    // Code editors (CodeMirror, Monaco) draw code lines themselves; their lines stay left-to-right.
    if (el.closest && el.closest(CODE_EDITOR_SELECTOR)) {
      if (el.dataset && (el.dataset.rtlyDir !== undefined || el.dataset.rtlyProcessed !== undefined)) releaseWrapper(el);
      return;
    }
    // Code is left-to-right (base.css), and RTLY's own direction would out-rank that rule: nothing inside
    // pre or code gets one, whichever scan reaches it (Claude wraps a whole code block in one span).
    if (el.closest && el.closest("pre, code") && !el.closest(MATH_SELECTOR)) {
      if (el.dataset && (el.dataset.rtlyDir !== undefined || el.dataset.rtlyProcessed !== undefined)) cleanupRTLYElement(el);
      return;
    }
    // An inline font from an older RTLY: drop it and the "processed" marks so this pass restyles the element.
    if (el.style && isLegacyRtlyFont(el.style.fontFamily)) {
      el.style.removeProperty("font-family");
      el.removeAttribute("data-rtly-processed");
      el.removeAttribute("data-rtly-tc");
      el.removeAttribute("data-rtly-text");
    }
    // Lists on these sites get their direction from syncListDirection (whole list, majority of its
    // items). Once it owns a list element, the per-element pass must not flip it back.
    if (el.dataset && el.dataset.rtlyDir !== undefined && LIST_DIRECTION_SITES.has(siteKey) &&
        (el.tagName === "OL" || el.tagName === "UL" || el.tagName === "LI")) {
      // The list keeps its direction, but an item still needs the font for its own text.
      if (el.tagName === "LI") applyListItemFont(el);
      return;
    }
    // An item that disagrees with the direction of the list around it (its own text pass ran first, or its
    // parent is a custom element): the list pass decides, once, for the whole list.
    if (el.tagName === "LI" && LIST_DIRECTION_SITES.has(siteKey) && el.dataset) {
      const par = el.parentElement;
      const outer = par && (par.tagName === "OL" || par.tagName === "UL" ? par : par.closest("ol, ul"));
      const od = outer && outer.dataset.rtlyDir;
      if ((od === "rtl" || od === "ltr") && el.dataset.rtlyDir !== od && !(el.getAttribute("dir") && el.dataset.rtlyDir === undefined)) {
        syncListDirection(outer);
        if (el.dataset.rtlyDir === od) return;
      }
    }
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
        fp(el.textContent) === el.dataset.rtlyTc) {
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
    // `ltr`: RTLY resolved this element's text as LTR. Such text gets the Latin-digits stack
    // (see FONT_STACK_LTR) so ASCII digits in English / code / version strings are not drawn as
    // Persian digits; RTL text keeps the font's own digit shapes.
    const applyFontOnly = (target, ltr = false) => {
      if (shouldSkipFont(target)) return;
      // v1.8.17: gate font application on the target's CURRENT text. The font
      // is an Arabic-script face whose Latin glyphs have ascent/descent
      // metrics different from typical site fonts (Soehne on ChatGPT,
      // ABC Diatype on Claude, etc.). Painting it over a textarea containing
      // only English caused visible vertical-baseline shift - descenders of
      // "j" / "g" / "p" rendered at a different Y position than the textarea's
      // native baseline. Restrict the paint to elements whose text actually
      // contains Arabic-script characters; when text becomes Latin-only
      // (user clears Persian and types English), strip any RTLY font we
      // applied earlier so the site's metrics are fully restored.
      //
      // Text source: el.value for <textarea>/<input> (replaced elements whose
      // textContent does NOT reflect their value); textContent for everything
      // else (cheap, no reflow - innerText would force layout).
      //
      // Empty text -> wantFont is false -> no paint, no harm. First Persian
      // keystroke triggers the next mutation cycle which re-paints.
      const txt = target.value !== undefined
        ? target.value
        : (target.textContent || "");
      // v2.0: an LTR island (no Arabic-script text of its own) nested inside a block RTLY already
      // painted with an RTLY font inherits that font. Re-state the font on
      // the island with the Latin-digits stack. It is only ever set where an RTLY font is already
      // inherited, so the island's glyphs do not change except for the digits.
      const hasAr = AR_FA_WORD.test(txt);
      const island = ltr && !hasAr && inheritsInlineFont(target);
      const wantFont = hasAr || island;
      const cur = ownedStyle(target, "font-family");
      // An inline font from an RTLY build that styled inline: replaced by the attribute.
      const inline = isRtlyFont(target.style.fontFamily);
      if (wantFont) {
        if (inline) releaseOwnedStyle(target, "font-family");
        if (!cur || inline || (cur === FONT_STACK_LTR) !== ltr) {
          setOwnedStyle(target, "font-family", ltr ? FONT_STACK_LTR : fontFamily);
        }
      } else if (cur || inline) {
        releaseOwnedStyle(target, "font-family");
      }
      // NOTE: font-size scaling is intentionally NOT applied per-element here.
      // Using `1em * scale` recursively compounded across nested elements
      // (e.g. message > p > span > strong in Claude). Scale is applied once on
      // :root via applyGlobalFontScale() - child elements using rem/em scale
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
      if (effectiveMode === "full" || effectiveMode === "rtl_only") refineComposerLines(el);
      // Guard the marker write too — same-value assignment is still a DOM
      // mutation, and assigning it on every pass kept feeding the loop above.
      if (el.dataset.rtlyProcessed !== "1") el.dataset.rtlyProcessed = "1";
      // The descendant rule of base.css keys on this mark, not on data-rtly-processed: a rule with
      // `[data-rtly-processed] *` made every processed message element restyle its whole subtree (IS-022).
      if (el.dataset.rtlyEditor !== "1") el.dataset.rtlyEditor = "1";
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
        releaseOwnedStyle(el, "direction");
        releaseOwnedStyle(el, "text-align");
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
      // v2.0: only strip what RTLY itself wrote (ownership markers). The old check
      // removed ANY dir / inline direction / text-align from the wrapper, which
      // deleted the site's own values on its layout containers.
      releaseWrapper(el);
      // v2.0: a wrapper around the composer is page chrome / layout. It must not be painted with
      // the font either: an inline font-family here would cascade over the whole subtree
      // (toolbars, buttons, other messages). The composer itself is styled by its own pass.
      return;
    }

    // v2.0: layout wrapper around the whole message list (thread container, <main>, app shell):
    // it contains two or more repeated message roots. Direction / alignment / font must live on
    // the message text blocks, never on the container that holds all of them (and the site
    // chrome around them), so the wrapper is left alone and only bookkeeping is stamped so the
    // fast-skip and the heuristic scan don't revisit it every tick.
    if (isMessageListWrapper(el)) {
      releaseWrapper(el);
      if (el.dataset.rtlyProcessed !== "1") el.dataset.rtlyProcessed = "1";
      const tcWrap = fp(el.textContent);
      if (el.dataset.rtlyTc !== tcWrap) el.dataset.rtlyTc = tcWrap;
      return;
    }

    if (inMenu) {
      applyFontOnly(el);
      return;
    }
    
    // For NotebookLM, only process elements within Chat section
    if (canonicalSite === "notebooklm.google.com") {
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
    // A row that pushes its single child to the end (a chat bubble row: `display:flex; justify-content:flex-end`)
    // keeps the page's left-to-right direction. Right-to-left would flip the push to the other side and move the
    // bubble (DEC-003: RTLY never changes the layout). The text inside the bubble gets its own direction.
    if ((effectiveMode === "full" || effectiveMode === "rtl_only") && isEndAlignedFlexRow(el)) {
      setOwnedStyle(el, "direction", "ltr");
      if (el.dataset.rtlyKeep === undefined) el.dataset.rtlyKeep = "1";
      if (el.dataset.rtlyProcessed !== "1") el.dataset.rtlyProcessed = "1";
      return;
    }
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
    const text = el.value !== undefined ? el.value : textWithoutMath(el);
    if (!text?.trim()) return;

    // A wrapper that holds (almost) only a code block is part of the code viewer, not message text:
    // Persian comments inside must not turn the whole viewer (scrollbar, alignment) right-to-left.
    if (el.tagName !== "PRE" && typeof el.querySelector === "function") {
      const innerPre = el.querySelector("pre:not(ms-katex pre):not(.katex-display pre), " + CODE_EDITOR_SELECTOR);
      if (innerPre && innerPre.textContent.length >= text.length * 0.8) {
        releaseWrapper(el);
        // The card around a code editor keeps the page's own left-to-right layout (label, copy button).
        if (el.querySelector(CODE_EDITOR_SELECTOR) && ownedStyle(el, "direction") !== "ltr") {
          setOwnedStyle(el, "direction", "ltr");
          if (el.dataset.rtlyKeep === undefined) el.dataset.rtlyKeep = "1";
        }
        if (el.dataset.rtlyProcessed !== "1") el.dataset.rtlyProcessed = "1";
        return;
      }
    }

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
      if (effectiveMode === "full" || effectiveMode === "font_only") applyFontOnly(el, false);
      // v1.9.20: stamp processed + reflow-free text marker so the next
      // observer tick fast-skips this big container (the innerText read above
      // is itself a reflow we want to avoid repeating once the text settles).
      if (el.dataset.rtlyProcessed !== "1") el.dataset.rtlyProcessed = "1";
      const tcLarge = fp(el.textContent);
      if (el.dataset.rtlyTc !== tcLarge) el.dataset.rtlyTc = tcLarge;
      return;
    }

    const normalized = text.trim();
    const alreadyDir = el.dataset.rtlyDir;
    const normalizedFp = fp(normalized);
    const alreadyText = el.dataset.rtlyText === normalizedFp;

    const dir = detectDirection(normalized, { grammarWords: !el.querySelector("pre, " + CODE_EDITOR_SELECTOR) });
    if (dir === "none") return;

    // For Gemini, always re-apply to ensure styles are set correctly
    // Only skip if text is same AND direction is unchanged AND not Gemini
    if (siteKey !== "gemini.google.com" && alreadyText && alreadyDir === dir) return;
    // A block that follows the direction around it (syncHeadingDirection, syncTableDirection) keeps it while its text is the same.
    if (alreadyText && el.dataset.rtlyFollow !== undefined && el.dataset.rtlyFollow === alreadyDir) return;

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
      const tcIcon = fp(el.textContent);
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
    // A text block is not a control: an icon inside it (a source chip in a ChatGPT paragraph) moves with
    // the text, and without a direction the block falls back to the page's left-to-right order.
    const isTextBlock = el.matches(TEXT_BLOCK_SELECTOR);
    const containsIconGate =
      NARROW_ICON_SITES.has(siteKey)
        ? isInteractiveControl
        : !isTextBlock;
    let containsIcon =
      containsIconGate && el.querySelector && !!el.querySelector(ICON_DESCENDANT_SELECTOR);
    // The glyphs of a rendered formula (root signs, fraction bars) are drawn as svg: they are not controls.
    if (containsIcon && el.querySelector(MATH_SELECTOR)) {
      const found = el.querySelectorAll(ICON_DESCENDANT_SELECTOR);
      containsIcon = false;
      for (let i = 0; i < found.length && i < 60; i++) if (!found[i].closest(MATH_SELECTOR)) { containsIcon = true; break; }
    }
    if (containsIcon) {
      if (effectiveMode === "full" || effectiveMode === "font_only") applyFontOnly(el, dir === "ltr");
      // v1.9.10: guard same-value write — see v1.8.10 input-like branch comment.
      if (el.dataset.rtlyProcessed !== "1") el.dataset.rtlyProcessed = "1";
      // v1.9.22 (ChatGPT hang, real fix): stamp the reflow-free marker HERE.
      // This branch is the dominant ChatGPT cost — assistant message containers
      // almost always contain an icon (copy/edit/code-block buttons), so they
      // bailed here EVERY 400ms tick, but only AFTER reading el.innerText (a
      // forced reflow) and running the big subtree icon `querySelector`. Without
      // rtlyTc the top-of-function fast-skip could never catch them. With it, an
      // unchanged icon-bearing container short-circuits reflow-free next tick.
      const tcIcon = fp(el.textContent);
      if (el.dataset.rtlyTc !== tcIcon) el.dataset.rtlyTc = tcIcon;
      return;
    }
    // --- end icon guard ---

    // Word-level spans (ChatGPT wraps every streamed word in one): a direction on a single word
    // isolates it and moves the spaces around it, which breaks a mixed Persian / English line.
    // The text block that holds them already carries the direction; only the font is set here.
    // The same for any inline part of a text block that has a direction: an isolated "4. Cline — "
    // would sit as one left-to-right piece next to the Persian text, with the number in the middle.
    // List items are left out: an English item of a Persian list keeps its own direction through its span.
    // A formula wrapper (Gemini's span.math-inline) keeps its own left-to-right direction: a site rule can make
    // the katex inside inherit, and it would then draw H₂O as O₂H.
    const textBlock = INLINE_TAGS.has(el.tagName) && !el.matches(MATH_SELECTOR) && el.parentElement &&
      el.parentElement.closest(INLINE_OWNER_SELECTOR);
    if (el.hasAttribute("data-d-stream-word") || (textBlock && textBlock.dataset.rtlyDir !== undefined)) {
      if (el.dataset.rtlyDir !== undefined) {
        if (!releaseOwnedDir(el)) el.removeAttribute("dir");
        ["direction", "text-align", "text-align-last", "unicode-bidi"].forEach((p) => releaseOwnedStyle(el, p));
        el.removeAttribute("data-rtly-dir");
      }
      if (effectiveMode === "full" || effectiveMode === "font_only") applyFontOnly(el, dir === "ltr");
      if (el.dataset.rtlyProcessed !== "1") el.dataset.rtlyProcessed = "1";
      const tcWord = fp(el.textContent);
      if (el.dataset.rtlyTc !== tcWord) el.dataset.rtlyTc = tcWord;
      return;
    }

    // Apply direction only for full or rtl_only
    const applyDir = effectiveMode === "full" || effectiveMode === "rtl_only";
    if (applyDir) {
      setOwnedDir(el, dir);
      setOwnedStyle(el, "direction", dir);
      // v1.7: use logical `start` instead of physical `right`/`left`.
      // `start` resolves to right when direction is rtl and left when ltr,
      // and follows the direction property automatically — so if a parent's
      // direction ever changes, alignment follows without re-applying.
      setOwnedStyle(el, "text-align", "start");
      // Right-to-left text keeps the direction RTLY decided. Inline, because a site rule such as z.ai's
      // `[data-expanded] * { unicode-bidi: plaintext }` would hand the decision back to the first letter.
      // A block whose lines are in different languages (separate lines of one paragraph) lets each line
      // pick its own direction; every other block keeps the direction decided here.
      if (dir === "rtl") setOwnedStyle(el, "unicode-bidi", hasLtrLine(text) && canUsePlaintext(el) ? "plaintext" : "isolate");
      if (siteKey === "gemini.google.com") {
        requestAnimationFrame(() => {
          if (rtlyStopped) return;
          try {
            const computedDir = getComputedStyle(el).direction;
            if (computedDir !== dir) {
              setOwnedStyle(el, "direction", dir);
              setOwnedStyle(el, "text-align", "start");
            }
          } catch (e) {}
        });
      }
    }
    
    // Apply font for full or font_only
    if (effectiveMode === "full" || effectiveMode === "font_only") applyFontOnly(el, dir === "ltr");
    
    // Mark as processed.
    //
    // v1.9.10: guard same-value writes. Setting `el.dataset.foo = "1"` when
    // the underlying `data-foo="1"` attribute already exists still produces a
    // MutationRecord — and the loop in process() runs every 400ms via the
    // body-wide MutationObserver, so without these guards every long-lived
    // text element churns its data-* attributes hundreds of times per page.
    // Same pattern as the input-like branch (~line 954) already uses.
    if (el.dataset.rtlyProcessed !== "1") el.dataset.rtlyProcessed = "1";
    if (el.dataset.rtlyText !== normalizedFp) el.dataset.rtlyText = normalizedFp;
    if (applyDir && el.dataset.rtlyDir !== dir) el.dataset.rtlyDir = dir;
    // v1.9.20: reflow-free text marker for the fast-skip at the top of this
    // function. Stored from textContent (not innerText) so the next-tick
    // compare never forces a layout. Guarded same-value write, like the rest.
    const tcDone = fp(el.textContent);
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
  if (siteKey !== "claude.ai" || rtlyStopped) return;
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
            (header.getAttribute("dir") === "rtl" || header.style.direction === "rtl" || ownedStyle(header, "direction") === "rtl")) {
          setOwnedStyle(header, "direction", "ltr");
          header.setAttribute("dir", "ltr");
        }
      }
    }
  } catch (_) {}
}

function fontFaceRules(family, faces) {
  const base = chrome.runtime.getURL("fonts/");
  let css = "";
  faces.forEach(([name, unicodeRange]) => {
    const range = unicodeRange ? "\n  unicode-range: " + unicodeRange + ";" : "";
    [[400, "normal"], [700, "bold"]].forEach(([w, label]) => {
      css += `
@font-face {
  font-family: "${family}";
  src: url("${base}${name}-${w}.woff2") format("woff2");
  font-weight: ${label};
  font-style: normal;
  font-display: swap;${range}
}`;
    });
  });
  return css;
}

// (Re)writes the @font-face rules for the fonts the user picked. Safe to call again on a setting change.
// A page can hold inline styles written by an older RTLY (a site that stores message HTML, or a tab open
// during an update). Drop the old font and the "already processed" marks so the next pass restyles them.
function sweepLegacyFont() {
  try {
    document.querySelectorAll('[style*="IranYekan"]').forEach((el) => {
      if (!isLegacyRtlyFont(el.style.fontFamily)) return;
      el.style.removeProperty("font-family");
      el.removeAttribute("data-rtly-processed");
      el.removeAttribute("data-rtly-tc");
      el.removeAttribute("data-rtly-text");
      // A container with an unchanged text fingerprint is skipped without a look at its children.
      let up = el.parentElement;
      for (let i = 0; up && i < 30; up = up.parentElement, i++) up.removeAttribute("data-rtly-tc");
    });
  } catch (_) {}
}

function injectFonts() {
  try {
    const css =
      fontFaceRules(FONT_MARK, FONT_CATALOG[pickFont(SETTINGS.font)]) +
      `
/* Keeps ASCII digits Latin in text RTLY resolved as LTR (see FONT_STACK_LTR). No metric override:
   it only swaps the digit glyphs. */
@font-face {
  font-family: "RTLY Latin Digits";
  src: local("Segoe UI"), local("Helvetica Neue"), local("Roboto"), local("Arial");
  unicode-range: U+0030-0039;
}`;
    let style = document.getElementById("rtly-font-face");
    if (!style) {
      style = document.createElement("style");
      style.id = "rtly-font-face";
      (document.head || document.documentElement).appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
  } catch (_) {}
}

async function bootstrap() {
  // v2.0: bootstrap writes NOTHING to the page until the per-site enabled check passes. The
  // @font-face <style>, the :root custom properties (--rtly-font-scale / --rtly-font-family) and
  // the font scale itself used to be applied before that check, so a site the user had switched
  // off still got a style element and :root variables. They now live in initRTLY() (active only).
  //
  // v1.9.12: patchHistory() + setupMessageListener() are likewise registered only AFTER the
  // enabled check; they have page-observable side effects. They still live inside bootstrap
  // (not at top level), so a duplicate content-script injection can't stack listeners or
  // double-patch history (the window.__RTLY_CONTENT_V1__ gate guarantees bootstrap runs at most
  // once per document).
  await loadSettings();
  if (chrome?.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.mixedDirection) {
        SETTINGS.mixedDirection = changes.mixedDirection.newValue === "persian" ? "persian" : "balanced";
        bustCaches();
        if (rtlyActive && !rtlyStopped) reapplyRTLY();
      }
      if (changes.font) {
        SETTINGS.font = pickFont(changes.font.newValue);
        if (rtlyActive && !rtlyStopped) injectFonts();
      }
      if (changes.fontScale) {
        SETTINGS.fontScale = Number(changes.fontScale.newValue) || 100;
        applyGlobalFontScale(); // no-op unless RTLY is active on this site
        bustCaches();
      }
      // v2.0: the site was toggled from another tab, the popup or the options page. Only the
      // disable direction is handled live (stop + clean up); enabling goes through the
      // background's tab reload, so a fresh content script picks it up.
      if (changes.siteSettings) {
        const next = changes.siteSettings.newValue;
        const stillEnabled = !next || typeof next !== "object" || next[canonicalSite] !== false;
        if (!stillEnabled && rtlyActive && !rtlyStopped) deactivateRTLY();
      }
      if (changes.siteModes && changes.siteModes.newValue) {
        // Compute the effective mode for THIS site before and after the
        // update so we only do work when the change actually affects us
        // (the user may have changed a different site's mode in Options).
        const prevMode = getEffectiveMode();
        SETTINGS.siteModes = changes.siteModes.newValue;
        const nextMode = getEffectiveMode();
        bustCaches();
        if (rtlyActive && !rtlyStopped) applyModeStyles();
        // v1.9.20: live mode propagation, no reload. applyModeStyles() only
        // toggles the .rtly-with-font / .rtly-with-rtl body-class gates that
        // drive the STATIC stylesheet rules. The inline dir / direction /
        // text-align / font-family that applyDirectionAndFont wrote DIRECTLY
        // onto elements are not class-gated, so a full->font_only switch from
        // the Options page used to leave stale RTL on already-processed
        // elements until a manual reload. reapplyRTLY() strips that inline
        // state and re-runs under the new effective mode. Gated on rtlyActive
        // so it never fires on a disabled site, and on an actual mode change.
        if (rtlyActive && !rtlyStopped && prevMode !== nextMode) reapplyRTLY();
      }
    });
  }
  const enabled = await isSiteEnabled(canonicalSite);
  if (!enabled) {
    log("Site disabled via settings, exiting");
    return;
  }
  // Site is enabled - now safe to take page-observable side effects.
  patchHistory();
  setupMessageListener();
  initRTLY();
}

// v2.0: live "site switched off" path. Stops every observer / interval, strips the marks and
// inline state RTLY wrote (ownership-aware, same helper as the popup's "reapply"), and removes the
// page-level additions: html/body classes and data-rtly-mode, the :root custom properties and
// font scale, and the injected @font-face <style>. Event listeners that cannot be unregistered
// (they are anonymous) stay attached but are inert: every writer checks rtlyStopped.
function deactivateRTLY() {
  if (rtlyStopped) return;
  rtlyStopped = true;
  try { runTeardown(); } catch (_) {}
  try {
    document.querySelectorAll("[data-rtly-processed], [data-rtly-keep], [data-rtly-line], [data-rtly-sbfont], [data-rtly-dir], [data-rtly-auto-dir], [data-rtly-card-rtl], [data-rtly-listeners-added]").forEach((el) => {
      cleanupRTLYElement(el);
      el.removeAttribute("data-rtly-card-rtl");
      el.removeAttribute("data-rtly-listeners-added");
    });
    document.querySelectorAll(OWNED_STYLE_SELECTOR).forEach((el) => {
      for (const prop in OWNED_STYLE_ATTR) el.removeAttribute(OWNED_STYLE_ATTR[prop]);
    });
    removeOwnedStyleSheet();
    const root = document.documentElement;
    restoreRootFontSize(root);
    rtlyActive = false;
    for (const t of [document.documentElement, document.body]) {
      if (!t) continue;
      const cls = [getBodyClassName(), "rtly-active", "rtly-with-font", "rtly-with-rtl"].filter(Boolean);
      t.classList.remove(...cls);
      if (!t.getAttribute("class")) t.removeAttribute("class");
      t.removeAttribute("data-rtly-mode");
    }
    if (!root.getAttribute("style")) root.removeAttribute("style");
    const face = document.getElementById("rtly-font-face");
    if (face) face.remove();
  } catch (e) {
    log("deactivateRTLY error", e);
  }
  rtlyActive = false;
}

function initRTLY() {
  log("Init for", siteKey);
  const siteCfg = CONFIG.SITES[siteKey];
  if (!siteCfg) return;

  // v1.9.20: we've passed the per-site enabled check — RTLY is now active on
  // this tab. Mark it so applyGlobalFontScale() applies the page-level scale
  // (it is a no-op until this point) and so live mode changes can reapply.
  rtlyActive = true;
  injectFonts(); // only on active sites
  sweepLegacyFont();
  [1500, 5000].forEach((ms) => {
    const id = setTimeout(() => { if (!rtlyStopped) sweepLegacyFont(); }, ms);
    registerTeardown(() => clearTimeout(id));
  });
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
        releaseOwnedStyle(stale, "direction");
        releaseOwnedStyle(stale, "text-align");
      });
    document
      .querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""]')
      .forEach((input) => {
        let cur = input.parentElement;
        let levels = 0;
        while (cur && cur !== document.body && cur !== document.documentElement && levels < 6) {
          if (cur.hasAttribute("data-rtly-dir") ||
              cur.hasAttribute("data-rtly-processed") ||
              cur.hasAttribute(OWNED_STYLE_ATTR["direction"]) ||
              cur.style.direction ||
              cur.style.textAlign ||
              cur.getAttribute("dir") === "rtl" ||
              cur.getAttribute("dir") === "ltr") {
            cur.removeAttribute("data-rtly-dir");
            cur.removeAttribute("data-rtly-text");
            cur.removeAttribute("data-rtly-processed");
            cur.removeAttribute("dir");
            releaseOwnedStyle(cur, "direction");
            releaseOwnedStyle(cur, "text-align");
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
  onNavigation(() => bustCaches());
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
    if (rtlyStopped) return;
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
        if (rtlyStopped) return;
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
// Removes only the direction RTLY gave an element (its dir mark and owned styles); the site's own dir,
// inline direction and inline text-align stay.
function releaseRtlyDirection(el) {
  if (el.dataset.rtlyDir !== undefined) {
    if (!releaseOwnedDir(el)) el.removeAttribute("dir");
    el.removeAttribute("data-rtly-dir");
  } else if (el.dataset.rtlyAutoDir === "1") {
    el.removeAttribute("dir");
    el.removeAttribute("data-rtly-auto-dir");
  }
  releaseOwnedStyle(el, "direction");
  releaseOwnedStyle(el, "text-align");
}

function setupMenuProtection() {
  // Flag to prevent infinite loops
  let isProtecting = false;
  const protectedElements = new WeakSet();

  // Function to remove direction from menu elements (debounced and optimized)
  const protectMenus = debounce(() => {
    if (isProtecting || rtlyStopped) return; // Prevent re-entrance
    isProtecting = true;

    try {
      // DeepSeek/Z.ai/Claude/...: the top-level layout must keep the direction the SITE gave it.
      // v2.0: this used to force dir="ltr" + inline "direction: ltr !important" on <body> and its
      // first two descendants unconditionally - a write onto page chrome that also overrode a
      // natively RTL site UI. RTLY no longer writes direction on layout containers at all
      // (message-list wrappers are skipped, see isMessageListWrapper), so the only thing left to
      // do here is to release a direction mark RTLY itself may have left there.
      if (LAYOUT_LTR_SITES.has(siteKey)) {
        [document.body, document.body?.firstElementChild, document.body?.firstElementChild?.firstElementChild].forEach((el) => {
          if (!el) return;
          if (el.dataset.rtlyDir !== undefined || el.dataset.rtlyAutoDir === "1") releaseWrapper(el);
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

              releaseRtlyDirection(el);

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
            // Only a direction RTLY wrote: a dir the site gives its own menu stays (DEC-003).
            if ((target.dataset.rtlyDir !== undefined || target.dataset.rtlyAutoDir === "1") && isInSidebarOrMenu(target)) {
              // Use requestAnimationFrame to avoid blocking
              requestAnimationFrame(() => {
                if (!rtlyStopped) releaseRtlyDirection(target);
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
        // v2.0: revert only a direction RTLY itself put there (ownership marker). Forcing
        // ltr whenever the container merely *computes* rtl also overrode sites whose own UI
        // is right-to-left.
        if (el.dataset.rtlyDir !== undefined && isLayoutContainer(el)) releaseWrapper(el);
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
        // v2.0: only a direction RTLY wrote is reverted (see forceLayoutLTR).
        if (el?.nodeType === 1 && el.dataset.rtlyDir !== undefined && el.getAttribute("dir") === "rtl") {
          const txt = (el.textContent || "").slice(0, 400);
          const hasChatArea = el.querySelector?.("textarea, .ds-message, main, article");
          if (/new\s*chat/i.test(txt) && hasChatArea && el.childElementCount >= 2) releaseWrapper(el);
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
  "notebook.google.com": "rtly-notebooklm",
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
  if (rtlyStopped) return;
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
  onNavigation(() => { setTimeout(syncBodyClass, 50); });
}

// --- Inputs ---
async function setupInputs(cfg) {
  const el = await waitForSelectors(cfg.inputs);
  if (rtlyStopped) return;
  // Gemini mounts its composer late; keep going so the watcher below binds it.
  if (!el && siteKey !== "gemini.google.com") return;
  if (el) applyDirectionAndFont(el);

  // Debounced handler - only process after user stops typing (avoids input lag)
  const debouncedHandler = debounce((target) => {
    requestAnimationFrame(() => applyDirectionAndFont(target));
  }, 250);
  const handler = (ev) => {
    const target = ev?.target || el;
    if (target) debouncedHandler(target);
  };

  // Editors that are mounted or replaced after the pass above (Claude re-creates its composer) never got
  // the listeners below. One delegated listener covers every editable on the page.
  const delegatedInput = (ev) => {
    if (rtlyStopped) return;
    const t = ev.target;
    if (!t || t.nodeType !== 1 || typeof t.closest !== "function") return;
    const root = t.closest('textarea, input, [contenteditable="true"], [contenteditable=""]');
    if (root && !isInSidebarOrMenu(root)) debouncedHandler(root);
  };
  document.addEventListener("input", delegatedInput, { passive: true, capture: true });
  registerTeardown(() => document.removeEventListener("input", delegatedInput, true));

  if (el) {
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
  }

  // 1.8.10: re-bind on SPA navigation. Some routes re-mount the composer when
  // switching chats; the element our listeners/observer were attached to then
  // detaches, so freshly-typed Persian stops flipping to RTL until an
  // unrelated pass happens to touch it. On navigation, re-apply to the current
  // input(s) and attach listeners only where missing (dataset-guarded — never
  // double-binds, never stacks observers).
  const rebindInputs = debounce(() => {
    if (rtlyStopped) return;
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
  onNavigation(() => { if (!rtlyStopped) setTimeout(rebindInputs, 100); });

  // Gemini: check for new inputs less aggressively (reduces input lag)
  if (siteKey === "gemini.google.com") {
    const checkInputs = debounce(() => {
      if (rtlyStopped) return;
      cfg.inputs.forEach((sel) => {
        try {
          document.querySelectorAll(sel).forEach((inputEl) => {
            if (isInSidebarOrMenu(inputEl)) return;
            const txt = (inputEl.value ?? inputEl.textContent ?? "").trim();
            if (txt || !inputEl.dataset.rtlyListenersAdded) requestAnimationFrame(() => applyDirectionAndFont(inputEl));
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
    const iv = trackInterval(setInterval(checkInputs, 5000));
    const ivStop = setTimeout(() => clearInterval(iv), 60000);
    registerTeardown(() => clearTimeout(ivStop));
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
  const isNotebookLM = canonicalSite === "notebooklm.google.com";
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
      // The composer keeps focus after a message is sent, so responses must still be processed
      // while it is focused. Only the focused composer itself is left alone (no work while typing).
      const typingEl = document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.getAttribute?.("contenteditable") === "true"
        ? document.activeElement : null;
      let mainContainer = document.querySelector("main") || document.querySelector("[role='main']");
      if (mainContainer) {
        const chatArea = mainContainer.querySelector("[data-qa*='chat'], [data-qa*='conversation'], [class*='chat'], [class*='Chat']");
        if (chatArea && !isInSidebarOrMenu(chatArea)) mainContainer = chatArea;
      }
      if (!mainContainer) mainContainer = document.body;
      // <main> sits under the app root, whose `side-nav-open` class trips the sidebar heuristic;
      // every element is still checked individually below.
      if (!mainContainer) return;

      // First, process all input boxes
      cfg.inputs.forEach((sel) => {
        try {
          const inputs = document.querySelectorAll(sel);
          inputs.forEach((inputEl) => {
            if (!isInSidebarOrMenu(inputEl) && inputEl !== typingEl) {
              const txt = inputEl.value !== undefined ? inputEl.value : inputEl.textContent || "";
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
              const childTxt = childEl.textContent || "";
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
        // first avoids the text read.
        //
        // v2.0: processGemini reads textContent, never innerText. innerText forces a
        // synchronous layout, and this pass runs over up to ~150 elements per tick on
        // Gemini. textContent differs only for hidden/collapsed text and whitespace,
        // and every use here is a "does this have >= 2 chars / any Persian" gate whose
        // outcome is then re-decided by applyDirectionAndFont (which itself uses
        // textContent), so the swap cannot change which elements end up styled in any
        // way that matters.
        if (el.dataset.rtlyProcessed === "1" && !el.dataset.rtlyText) {
          // safe: explicitly tagged as processed via non-text path
          continue;
        }

        if (el.closest("code, pre")) continue;

        const txt = el.textContent || "";
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

      if (LIST_DIRECTION_SITES.has(siteKey)) {
        mainContainer.querySelectorAll("message-content, user-query").forEach(syncListDirection);
      }

      const messageElements = mainContainer.querySelectorAll("[data-message], [data-role], [data-qa], [role='article']");
      let messageCount = 0;
      const maxMessages = 30;
      for (let i = 0; i < messageElements.length && messageCount < maxMessages; i++) {
        const el = messageElements[i];
        if (isInSidebarOrMenu(el)) continue;
        const txt = el.textContent || "";
        if (!txt || txt.trim().length < 2) continue;
        applyDirectionAndFont(el);
        messageCount++;
        // Process only first 10 direct children to reduce overhead
        const kids = el.children;
        const kidLimit = Math.min(kids.length, 10);
        for (let j = 0; j < kidLimit; j++) {
          const child = kids[j];
          if (isInSidebarOrMenu(child)) continue;
          const childTxt = child.textContent || "";
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
  let lastLegacySweep = 0;
  // IS-022: on a page with many message containers, a container is styled once it comes near the view.
  // Styling every container of a long ChatGPT page at once made the browser restyle the same subtrees
  // under the site's large stylesheet for many seconds. Containers far away wait for the observer.
  const DEFER_MIN_CONTAINERS = 40;
  const nearContainers = new WeakMap();
  let nearObserver = null;
  const process = () => {
    if (rtlyStopped) return;
    resetSidebarAncestors();
    keepCodeEditorsLtr();
    keepFormulasLtr();
    // Content can arrive late with old inline styles (a site that stores message HTML); sweep them
    // here too, throttled, because a container with old "processed" marks is skipped otherwise.
    const nowTs = Date.now();
    if (nowTs - lastLegacySweep > 2000) { lastLegacySweep = nowTs; sweepLegacyFont(); processSidebarFonts(); }
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
      if (nearObserver && containerEls.length > DEFER_MIN_CONTAINERS) {
        containerEls = containerEls.filter((el) => {
          const near = nearContainers.get(el);
          if (near === undefined) { nearContainers.set(el, false); nearObserver.observe(el); return false; }
          return near;
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
          fp(el.textContent) === el.dataset.rtlyTc;

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
        if (LIST_DIRECTION_SITES.has(siteKey)) syncListDirection(el);
        syncHeadingDirection(el);
        syncTableDirection(el);
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

        // Sites whose answers are found by the scans above have no container for the list pass: give the
        // lists (and items added while streaming) that no pass has marked yet their direction here.
        if (LIST_DIRECTION_SITES.has(siteKey) && !COMPREHENSIVE_SELECTOR_SITES.has(siteKey)) {
          const scope = (isNotebookLM && chatContainer) || document.querySelector("main") || document.querySelector("[role='main']") || document.body;
          const loose = scope ? scope.querySelectorAll("ol:not([data-rtly-dir]), ul:not([data-rtly-dir]), li:not([data-rtly-dir])") : [];
          const parents = new Set();
          for (let i = 0; i < loose.length && i < 300 && parents.size < 40; i++) {
            const n = loose[i];
            if (!n.parentElement || n.closest("pre, code") || isInSidebarOrMenu(n)) continue;
            if (AR_FA_WORD.test(n.textContent || "")) parents.add(n.parentElement);
          }
          // Items marked by their own text that disagree with the list around them (custom-element lists).
          const marked = scope ? scope.querySelectorAll("li[data-rtly-dir]") : [];
          for (let i = 0; i < marked.length && i < 300; i++) {
            const n = marked[i];
            const outer = n.parentElement && n.parentElement.closest("ol, ul");
            const od = outer && outer.dataset.rtlyDir;
            if ((od === "rtl" || od === "ltr") && n.dataset.rtlyDir !== od && outer.parentElement) parents.add(outer);
          }
          parents.forEach((p) => syncListDirection(p.parentElement || p));
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
      let sliceHandle = null;
      registerTeardown(() => {
        if (!sliceHandle) return;
        if (sliceHandle.idle !== undefined && typeof cancelIdleCallback !== "undefined") cancelIdleCallback(sliceHandle.idle);
        if (sliceHandle.timer !== undefined) clearTimeout(sliceHandle.timer);
      });
      const SLICE_MS = 8;
      const now = () => (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      const runSlice = () => {
        if (rtlyStopped || myGen !== responsePassGen) return; // switched off, or superseded by a newer pass
        try {
          const start = now();
          while (idx < containerEls.length) {
            processOneContainer(containerEls[idx++]);
            if (now() - start >= SLICE_MS) break;
          }
        } catch (e) {
          log("process slice error", e);
        }
        if (rtlyStopped) return;
        if (idx < containerEls.length) {
          if (typeof requestIdleCallback !== "undefined") sliceHandle = { idle: requestIdleCallback(runSlice, { timeout: 200 }) };
          else sliceHandle = { timer: setTimeout(runSlice, 0) };
        } else {
          try { runScans(); } catch (e) { log("process scans error", e); }
        }
      };
      runSlice();
    } catch (e) {
      log("process responses error", e);
    }
  };

  if (typeof IntersectionObserver === "function") {
    let nearPassQueued = false;
    nearObserver = trackObserver(new IntersectionObserver((entries) => {
      let came = false;
      for (const e of entries) {
        nearContainers.set(e.target, e.isIntersecting);
        if (e.isIntersecting) came = true;
      }
      if (!came || nearPassQueued) return;
      nearPassQueued = true;
      setTimeout(() => { nearPassQueued = false; process(); }, 50);
    }, { rootMargin: "1200px 0px" }));
  }
  process();

  if (isGemini) {
    const runProcess = () => {
      if (rtlyStopped) return;
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
    onNavigation(debounce(() => setTimeout(runProcess, 500), 500));
    let n = 0;
    // Aggressive polling for ~60s during initial load while the chat tree
    // settles, then self-terminate.
    const iv = trackInterval(setInterval(() => { runProcess(); if (++n >= 12) clearInterval(iv); }, 5000));
    // Long-running keepalive — gated on visibility, registered for teardown.
    trackInterval(setInterval(() => {
      if (document.visibilityState !== "visible") return;
      runProcess();
    }, 15000));
    return;
  }

  // A container whose text did not change is skipped as stable. A site can render its children again
  // with the same text (ChatGPT replaces the lists after the first pass on a full load), so new
  // elements with text clear the stable mark of every container above them.
  const clearStableMarks = (records) => {
    for (const r of records) {
      let added = false;
      for (const n of r.addedNodes) {
        if (n.nodeType === 1 && (n.textContent || "").trim()) { added = true; break; }
      }
      if (!added) continue;
      for (let n = r.target; n && n.nodeType === 1; n = n.parentElement) {
        if (n.hasAttribute("data-rtly-tc")) n.removeAttribute("data-rtly-tc");
      }
    }
  };
  const debouncedProcess = debounce(process, 400);
  const mo = trackObserver(new MutationObserver((records) => {
    if (rtlyStopped) return;
    clearStableMarks(records);
    debouncedProcess();
  }));
  mo.observe(document.body || document.documentElement, CONFIG.OBSERVER_CONFIG);
  onNavigation(() => setTimeout(process, 100));

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

    let timer = 0;
    const finish = (value) => {
      obs.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    const obs = new MutationObserver(() => {
      const el = selectors.map((s) => document.querySelector(s)).find(Boolean);
      if (el) finish(el);
    });
    obs.observe(document.documentElement, CONFIG.OBSERVER_CONFIG);
    timer = setTimeout(() => finish(null), 5000);
    registerTeardown(() => finish(null));
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
// Font (which RTLY always owns when it paints an RTLY font) and the bookkeeping
// markers are always cleared.
function cleanupRTLYElement(el) {
  try {
    if (el.dataset.rtlySbfont !== undefined) {
      releaseOwnedStyle(el, "font-family");
      el.removeAttribute("data-rtly-sbfont");
    }
    if (el.dataset.rtlyLine !== undefined) {
      if (el.dataset.rtlyLine !== "root") {
        releaseOwnedStyle(el, "unicode-bidi");
        releaseOwnedStyle(el, "direction");
      }
      el.removeAttribute("data-rtly-line");
    }
    if (el.dataset.rtlyKeep !== undefined) {
      releaseOwnedStyle(el, "direction");
      releaseOwnedStyle(el, "text-align");
      el.removeAttribute("data-rtly-keep");
    }
    const ownsDir = el.dataset.rtlyDir !== undefined;     // real dir (rtl/ltr) set by us
    const ownsAutoDir = el.dataset.rtlyAutoDir === "1";   // dir="auto" set by us
    if (ownsDir) {
      if (!releaseOwnedDir(el)) el.removeAttribute("dir");
      releaseOwnedStyle(el, "direction");
      releaseOwnedStyle(el, "text-align");
      releaseOwnedStyle(el, "text-align-last");
      releaseOwnedStyle(el, "unicode-bidi");
    } else if (ownsAutoDir) {
      el.removeAttribute("dir");
    }
    // NOTE: when neither marker is present the element had a NATIVE dir (or no
    // dir) that RTLY never created — leave its dir/direction/text-align alone.
    el.removeAttribute("data-rtly-processed");
    el.removeAttribute("data-rtly-dir");
    el.removeAttribute("data-rtly-follow");
    el.removeAttribute("data-rtly-editor");
    el.removeAttribute("data-rtly-auto-dir");
    el.removeAttribute("data-rtly-text");
    el.removeAttribute("data-rtly-tc");
    // Only a font-family RTLY wrote is removed; the site's own inline values stay.
    releaseOwnedStyle(el, "font-family");
  } catch (_) {}
}

function reapplyRTLY() {
  if (!siteKey || !CONFIG.SITES[siteKey] || rtlyStopped) return;
  // Cache bust — settings or display state may have changed; force a fresh
  // pass through isInSidebarOrMenu / isIcon / shouldSkipFont.
  bustCaches();

  document.querySelectorAll("[data-rtly-processed], [data-rtly-keep]").forEach(cleanupRTLYElement);
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
    SETTINGS,
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
