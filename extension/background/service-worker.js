// RTLY — background service worker (version lives in manifest.json)
//
// Responsibilities:
//   1. Right-click context menu ("RTLY: Toggle for this site")
//   2. Global keyboard shortcut (Alt+Shift+R) toggles current site
//   3. Listens for "toggleSiteStatus" messages from popup/options and
//      reloads matching tabs after persisting the new state
//
// Storage schema: see popup.js header.

// ── Host → canonical site id ─────────────────────────────────────────
const HOST_TO_SITE = {
  "chat.openai.com": "chatgpt.com",
  "www.chat.openai.com": "chatgpt.com",
  "chatgpt.com": "chatgpt.com",
  "claude.ai": "claude.ai",
  "copilot.microsoft.com": "copilot.microsoft.com",
  "www.copilot.microsoft.com": "copilot.microsoft.com",
  "copilot.com": "copilot.microsoft.com",
  "www.copilot.com": "copilot.microsoft.com",
  "gemini.google.com": "gemini.google.com",
  "www.gemini.google.com": "gemini.google.com",
  "perplexity.ai": "perplexity.ai",
  "www.perplexity.ai": "perplexity.ai",
  "poe.com": "poe.com",
  "aistudio.google.com": "aistudio.google.com",
  "notebooklm.google.com": "notebooklm.google.com",
  "notebook.google.com": "notebooklm.google.com",
  "grok.com": "grok.com",
  "chat.z.ai": "z.ai",
  "z.ai": "z.ai",
  "chat.deepseek.com": "chat.deepseek.com",
  "qwen.ai": "qwen.ai",
  "www.qwen.ai": "qwen.ai",
  "chat.qwen.ai": "qwen.ai",
  "www.bing.com": "bing.com",
  "bing.com": "bing.com",
  "mistral.ai": "mistral.ai",
  "huggingface.co": "huggingface.co",
  "cohere.com": "cohere.com",
};

// Note: legacy aliases used at runtime are mapped via HOST_TO_SITE above
// (e.g. "chat.openai.com" → "chatgpt.com"). Storage migration is handled by
// canonicalizeSettings() — no separate alias table needed.

// Canonical site ids we accept in runtime messages. Derived from the values
// of HOST_TO_SITE (deduped) so it can never drift from the supported set.
const ALLOWED_SITE_IDS = new Set(Object.values(HOST_TO_SITE));

function getSiteFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (HOST_TO_SITE[host]) return HOST_TO_SITE[host];
    for (const h of Object.keys(HOST_TO_SITE)) {
      if (host === h || host.endsWith("." + h)) return HOST_TO_SITE[h];
    }
    return null;
  } catch (_) {
    return null;
  }
}

function canonicalizeSettings(settings) {
  if (!settings || typeof settings !== "object") return {};
  if (Object.prototype.hasOwnProperty.call(settings, "chat.openai.com")) {
    const legacy = settings["chat.openai.com"];
    if (!Object.prototype.hasOwnProperty.call(settings, "chatgpt.com")) {
      settings["chatgpt.com"] = legacy;
    }
    delete settings["chat.openai.com"];
  }
  return settings;
}

function applyToggleToSettings(settings, site, value) {
  canonicalizeSettings(settings);
  settings[site] = value;
}

// Reload every open tab of a site (apex and subdomains). `*://*.example.com/*`
// does not match the apex domain, so both patterns are queried and unioned.
function reloadSiteTabs(site, fallbackTabId, done) {
  const ALIASES = { "chatgpt.com": ["chat.openai.com"], "copilot.microsoft.com": ["copilot.com"] };
  const sites = [site, ...(ALIASES[site] || [])];
  const patterns = sites.flatMap((s) => [`*://${s}/*`, `*://*.${s}/*`]);
  const seen = new Set();
  if (fallbackTabId != null) seen.add(fallbackTabId);
  let pending = patterns.length;
  patterns.forEach((url) => {
    chrome.tabs.query({ url }, (tabs) => {
      void chrome.runtime.lastError;
      (tabs || []).forEach((t) => { if (t.id != null) seen.add(t.id); });
      if (--pending === 0) {
        seen.forEach((id) => chrome.tabs.reload(id, () => { void chrome.runtime.lastError; }));
        if (done) done(seen.size);
      }
    });
  });
}

// ── Context menu setup ───────────────────────────────────────────────
// Re-create on install/update AND on startup. While MV3 context menus
// generally persist across service-worker restarts, registering on
// onStartup is cheap defense against edge cases (corrupted state, profile
// migration) and ensures the menu is present on first launch even if
// onInstalled hasn't fired in this session.
function createContextMenu() {
  try {
    chrome.contextMenus.removeAll(() => {
      // removeAll's callback may have a lastError if the API is racing —
      // we still proceed with create.
      void chrome.runtime.lastError;
      chrome.contextMenus.create({
        id: "rtly-toggle",
        title: chrome.i18n.getMessage("contextMenuToggle") || "RTLY: Toggle for this site",
        contexts: ["page", "action"],
      }, () => { void chrome.runtime.lastError; });
    });
  } catch (e) {
    console.debug("RTLY: contextMenu setup error", e);
  }
}

chrome.runtime.onInstalled.addListener(createContextMenu);
chrome.runtime.onStartup.addListener(createContextMenu);

// ── enaloo.com pages: welcome after install, survey after removal ────
// The extension only opens these links. It sends nothing itself. The query holds
// the version, UI language, browser name and major version, system and install age.
const ENALOO_APP_URL = "https://enaloo.com/apps/rtly";
const ext = globalThis.browser || chrome;

function detectBrowser() {
  const ua = (globalThis.navigator && navigator.userAgent) || "";
  let m;
  if ((m = /\bEdg\/(\d+)/.exec(ua))) return { name: "edge", major: m[1] };
  if ((m = /\bFirefox\/(\d+)/.exec(ua))) return { name: "firefox", major: m[1] };
  if (/\bOPR\/|\bVivaldi\//.test(ua)) return { name: "other", major: "" };
  if ((m = /\bChrome\/(\d+)/.exec(ua))) return { name: "chrome", major: m[1] };
  return { name: "other", major: "" };
}

function installAgeBucket(installedAt, now) {
  if (typeof installedAt !== "number" || !isFinite(installedAt)) return "unknown";
  const days = (now - installedAt) / 864e5;
  if (days < 1) return "d1";
  if (days < 7) return "w1";
  if (days < 30) return "m1";
  if (days < 90) return "m3";
  return "more";
}

function mapPlatformOs(os) {
  return ["win", "mac", "linux", "cros", "android"].includes(os) ? os : "other";
}

async function openWelcomePage() {
  const b = detectBrowser();
  const q = new URLSearchParams({
    v: ext.runtime.getManifest().version,
    lang: ext.i18n.getUILanguage(),
    b: b.name,
  });
  await ext.tabs.create({ url: `${ENALOO_APP_URL}/welcome/?${q}`, active: false });
}

async function setSurveyUrl() {
  const { installedAt } = await ext.storage.local.get("installedAt");
  const b = detectBrowser();
  let os = "other";
  try { os = mapPlatformOs((await ext.runtime.getPlatformInfo()).os); } catch (_) {}
  const q = new URLSearchParams({
    v: ext.runtime.getManifest().version,
    lang: ext.i18n.getUILanguage(),
    b: b.name,
    os,
    age: installAgeBucket(installedAt, Date.now()),
  });
  if (b.major) q.set("bv", b.major);
  await ext.runtime.setUninstallURL(`${ENALOO_APP_URL}/uninstall/?${q}`);
}

ext.runtime.onInstalled.addListener(async (details) => {
  try {
    if (details.reason === "install") {
      await ext.storage.local.set({ installedAt: Date.now() });
      await openWelcomePage();
    }
  } catch (e) {
    console.debug("RTLY: welcome page error", e);
  }
  try { await setSurveyUrl(); } catch (e) { console.debug("RTLY: survey url error", e); }
});
ext.runtime.onStartup.addListener(async () => {
  try { await setSurveyUrl(); } catch (e) { console.debug("RTLY: survey url error", e); }
});

// ── Site setting writes ──────────────────────────────────────────────
// The service worker is the single writer of siteSettings. Every change is a get -> modify -> set
// round trip, and two quick changes (popup, options, context menu, shortcut) would otherwise
// interleave: both read the same snapshot and the second set drops the first change. All writers
// go through this queue and run one at a time.
let toggleQueue = Promise.resolve();
function enqueueToggle(task) {
  const run = toggleQueue.then(() => new Promise((resolve) => {
    try { task(resolve); } catch (_) { resolve(); }
  }));
  toggleQueue = run.catch(() => {});
}

// decide(settings) returns the new boolean status for `site`. callback(error) runs after the write.
function updateSiteSetting(site, decide, callback) {
  enqueueToggle((done) => {
    chrome.storage.local.get(["siteSettings"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("RTLY: storage get error", chrome.runtime.lastError);
        callback(chrome.runtime.lastError.message || "storage get failed");
        done();
        return;
      }
      try {
        const settings = canonicalizeSettings(result.siteSettings || {});
        applyToggleToSettings(settings, site, decide(settings));
        chrome.storage.local.set({ siteSettings: settings }, () => {
          // The write is complete: let the next queued change read the fresh map.
          done();
          if (chrome.runtime.lastError) {
            console.error("RTLY: storage set error", chrome.runtime.lastError);
            callback(chrome.runtime.lastError.message || "storage set failed");
            return;
          }
          callback(null);
        });
      } catch (error) {
        console.error("RTLY: error updating settings", error);
        callback(error.message || "update failed");
        done();
      }
    });
  });
}

// ── Toggle handlers (context menu + keyboard shortcut) ───────────────
function toggleSiteForTab(tab) {
  if (!tab?.id) return;
  const site = getSiteFromUrl(tab.url);
  if (!site) return;
  // toggle: false → true, otherwise → false
  updateSiteSetting(site, (settings) => settings[site] === false, (err) => {
    if (!err) reloadSiteTabs(site, tab.id);
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "rtly-toggle") return;
  toggleSiteForTab(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "toggle_site") return;
  toggleSiteForTab(tab);
});

// ── Messages from popup/options ──────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Defense-in-depth: only accept messages from our own extension's pages.
  // Strict equality — previously `sender.id && sender.id !== ...` allowed
  // an undefined sender.id to fall through, defeating the check.
  if (sender?.id !== chrome.runtime.id) return false;

  if (message?.action !== "toggleSiteStatus") return false; // unhandled

  try {
    const { site, status } = message;

    // v1.9.20: strict payload validation. sender.id is already checked above,
    // but validating shape here means a malformed internal caller can't
    // pollute storage with an unknown site id or a non-boolean status (which
    // would also generate invalid reload patterns). Reject before any get/set.
    if (!ALLOWED_SITE_IDS.has(site) || typeof status !== "boolean") {
      sendResponse({ success: false, error: "Invalid toggle payload" });
      return true;
    }

    updateSiteSetting(site, () => status, (err) => {
      if (err) {
        sendResponse({ success: false, error: err });
        return;
      }
      reloadSiteTabs(site, null, (count) => sendResponse({ success: true, reloadedTabs: count }));
    });
  } catch (error) {
    console.error("RTLY: error handling message", error);
    sendResponse({ success: false, error: error.message });
  }

  return true; // async response — keep channel open
});

// ── Support nudge: monthly toolbar-icon badge (v1.9.15) ──────────────
// A quiet, opt-out-friendly invitation. The badge (a small heart on the
// extension's toolbar icon) appears at most once a month AND only while the
// active tab is a supported AI site — so it surfaces in the "value moment"
// (e.g. while using Claude) without ever injecting anything into the page.
// Opening the popup is what shows the actual support banner (see popup.js),
// which advances the monthly timer and clears this badge.
//
// The "is it due?" rule here mirrors nudgeIsDue() in popup.js. Tunables:
const NUDGE_INITIAL_DELAY_DAYS = 14; // grace period after install
const NUDGE_INTERVAL_DAYS = 30;      // the "monthly" cadence
const NUDGE_BADGE_TEXT = "\u2665";   // ♥
const NUDGE_BADGE_COLOR = "#DC2626";

function nudgeIsDue(nudge, now) {
  if (!nudge || nudge.optOut) return false;
  const installedAt = nudge.installedAt || now;
  if (!nudge.lastShownAt) return now >= installedAt + NUDGE_INITIAL_DELAY_DAYS * 86400000;
  return (now - nudge.lastShownAt) >= NUDGE_INTERVAL_DAYS * 86400000;
}

function setNudgeBadge(on) {
  try {
    chrome.action.setBadgeText({ text: on ? NUDGE_BADGE_TEXT : "" });
    if (on) {
      chrome.action.setBadgeBackgroundColor({ color: NUDGE_BADGE_COLOR });
      // setBadgeTextColor exists from Chrome 110+; guard for older Chrome versions.
      try { chrome.action.setBadgeTextColor?.({ color: "#FFFFFF" }); } catch (_) {}
    }
  } catch (e) { void e; }
}

// Show the badge only when (a) the nudge is due AND (b) the active tab is a
// supported site. Otherwise clear it. Cheap and idempotent — safe to spam.
function refreshNudgeBadge() {
  try {
    chrome.storage.local.get(["supportNudge"], (res) => {
      if (chrome.runtime.lastError) return;
      const nudge = res.supportNudge;
      if (!nudgeIsDue(nudge, Date.now())) { setNudgeBadge(false); return; }
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) { setNudgeBadge(false); return; }
        // tab.url is only populated for hosts we have permission for, which is
        // exactly the supported AI sites — so this naturally gates to them.
        const supported = !!(tabs && tabs[0] && getSiteFromUrl(tabs[0].url));
        setNudgeBadge(supported);
      });
    });
  } catch (e) { void e; }
}

// Seed installedAt once. On a fresh install OR an upgrade where the key is
// absent, anchor to "now" so the user gets the full grace period instead of
// an immediate nudge.
function seedSupportNudge() {
  try {
    chrome.storage.local.get(["supportNudge"], (res) => {
      if (chrome.runtime.lastError) return;
      if (!res.supportNudge || typeof res.supportNudge !== "object") {
        chrome.storage.local.set({ supportNudge: { installedAt: Date.now() } }, () => {
          void chrome.runtime.lastError;
          refreshNudgeBadge();
        });
      } else {
        refreshNudgeBadge();
      }
    });
  } catch (e) { void e; }
}

chrome.runtime.onInstalled.addListener(() => { seedSupportNudge(); });
chrome.runtime.onStartup.addListener(() => { refreshNudgeBadge(); });

// Re-evaluate the badge as the user moves between tabs/windows so it only
// shows while a supported site is in front.
chrome.tabs.onActivated.addListener(() => refreshNudgeBadge());
chrome.tabs.onUpdated.addListener((_id, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.url) refreshNudgeBadge();
});
try {
  chrome.windows.onFocusChanged.addListener(() => refreshNudgeBadge());
} catch (e) { void e; }

// When the popup advances the timer (lastShownAt) or the state otherwise
// changes, recompute immediately so the badge clears without waiting a day.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.supportNudge) refreshNudgeBadge();
});
