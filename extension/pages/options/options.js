/* RTLY — options page logic (version lives in manifest.json)
 *
 * Layout: single-column flow.
 *   1. Live preview pane (reactive to font-scale, theme, language)
 *   2. Display card (font scale slider, color palette, theme, UI language)
 *   3. Sites card (search + table: site / mode / pin / status)
 *   4. Footer with collapsible changelog + about + version
 *
 * Storage schema mirrors popup.js. Theme is "light" | "dark" | "system".
 */
(function () {
  "use strict";

  const SITES = [
    { id: "chatgpt.com",            label: "ChatGPT",      logo: "chatgpt" },
    { id: "claude.ai",              label: "Claude",       logo: "claude" },
    { id: "gemini.google.com",      label: "Gemini",       logo: "gemini" },
    { id: "perplexity.ai",          label: "Perplexity",   logo: "perplexity" },
    { id: "copilot.microsoft.com",  label: "Copilot",      logo: "copilot" },
    { id: "aistudio.google.com",    label: "AI Studio",    logo: "aistudio" },
    { id: "notebooklm.google.com",  label: "NotebookLM",   logo: "notebooklm" },
    { id: "grok.com",               label: "Grok",         logo: "grok" },
    { id: "poe.com",                label: "Poe",          logo: "poe" },
    { id: "z.ai",                   label: "Z.ai",         logo: "zai" },
    { id: "chat.deepseek.com",      label: "DeepSeek",     logo: "deepseek-color" },
    { id: "qwen.ai",                label: "Qwen",         logo: "qwen-color" },
    { id: "bing.com",               label: "Bing",         logo: "bing" },
    { id: "mistral.ai",             label: "Mistral",      logo: "mistral" },
    { id: "huggingface.co",         label: "Hugging Face", logo: "huggingface" },
    { id: "cohere.com",             label: "Cohere",       logo: "cohere" },
  ];

  const DEFAULT_PINNED = ["chatgpt.com", "claude.ai", "gemini.google.com", "perplexity.ai"];
  const MODES = ["full", "font_only", "rtl_only"];

  const t = (k, fb) => window.RTLY_I18N ? window.RTLY_I18N.t(k, fb) : (fb || k);
  const fmt = (str, ...args) => str.replace(/\{(\d+)\}/g, (_, i) => args[i] != null ? args[i] : "");
  const $ = (id) => document.getElementById(id);

  // Storage promises
  function getStorage(keys) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) return resolve({});
      chrome.storage.local.get(keys, (r) => resolve(chrome.runtime?.lastError ? {} : r));
    });
  }
  function setStorage(obj) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) return resolve();
      chrome.storage.local.set(obj, () => resolve());
    });
  }


  // Fallback writer (only used when chrome.runtime.sendMessage is unavailable). The background
  // service worker is the single writer of siteSettings; if we must write from a page we re-read
  // the stored map IMMEDIATELY before the write instead of writing a possibly stale in-memory
  // snapshot, so a toggle made elsewhere in the meantime (another tab, the background) survives.
  async function writeSiteSettingFallback(siteId, status) {
    const stored = await getStorage(["siteSettings"]);
    const cur = canonicalizeLegacyKeys({ ...(stored.siteSettings || {}) });
    cur[siteId] = status;
    await setStorage({ siteSettings: cur });
  }

  // Debounce for slider
  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  // Save-status toast
  let saveStatusTimer = null;
  function flashSaved(ok = true) {
    const node = $("saveStatus");
    if (!node) return;
    // v1.9.21: ok===false flashes an error state (used by the toggle rollback).
    // Backward compatible: existing `.then(flashSaved)` calls pass the storage
    // resolve value (undefined) → treated as success; bare flashSaved() too.
    node.classList.toggle("is-error", ok === false);
    node.classList.add("is-visible");
    clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(() => {
      node.classList.remove("is-visible");
      node.classList.remove("is-error");
    }, 1500);
  }


  function canonicalizeLegacyKeys(map) {
    if (!map || typeof map !== "object") return {};
    if (Object.prototype.hasOwnProperty.call(map, "chat.openai.com")) {
      if (!Object.prototype.hasOwnProperty.call(map, "chatgpt.com")) {
        map["chatgpt.com"] = map["chat.openai.com"];
      }
      delete map["chat.openai.com"];
    }
    return map;
  }

  // App state
  const State = {
    siteSettings: {},
    siteModes: {},
    pinnedSites: {},
    fontScale: 100,
    theme: "system",
    uiLocale: "en",
    colorPalette: "teal",
  };

  // ── Color palette ────────────────────────────────────────────────
  const PALETTES = ["teal", "blue", "indigo", "neutral"];
  function applyPalette(palette) {
    const valid = PALETTES.includes(palette) ? palette : "teal";
    document.documentElement.dataset.palette = valid;
  }
  function setupPalettePicker() {
    const root = $("palettePicker");
    if (!root) return;
    root.textContent = "";
    [
      { id: "teal",    label: t("paletteTeal"),    color: "#0E7C95" },
      { id: "blue",    label: t("paletteBlue"),    color: "#1A73E8" },
      { id: "indigo",  label: t("paletteIndigo"),  color: "#3949AB" },
      { id: "neutral", label: t("paletteNeutral"), color: "#5F6368" },
    ].forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "palette-swatch";
      btn.dataset.paletteId = item.id;
      btn.setAttribute("role", "radio");
      btn.title = item.label;
      btn.setAttribute("aria-label", item.label);
      btn.setAttribute("aria-checked", String(State.colorPalette === item.id));
      btn.classList.toggle("is-active", State.colorPalette === item.id);
      btn.style.setProperty("--swatch-color", item.color);
      const dot = document.createElement("span");
      dot.className = "palette-dot";
      dot.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.className = "palette-name";
      name.textContent = item.label;
      btn.append(dot, name);
      btn.addEventListener("click", () => {
        State.colorPalette = item.id;
        applyPalette(item.id);
        setStorage({ colorPalette: item.id }).then(flashSaved);
        root.querySelectorAll("[data-palette-id]").forEach((b) => {
          const active = b.dataset.paletteId === item.id;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-checked", String(active));
        });
      });
      root.appendChild(btn);
    });
  }

  // ── Theme handling ────────────────────────────────────────────────
  function applyTheme(theme) {
    let effective = theme;
    if (theme === "system") {
      effective = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", effective === "dark" ? "dark" : "light");

    // Reflect in topbar radios
    document.querySelectorAll("#themeSwitcher button").forEach((b) => {
      const on = b.getAttribute("data-theme") === theme;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }

  function setupThemeSwitcher() {
    const root = $("themeSwitcher");
    const choose = (theme) => {
      State.theme = theme;
      applyTheme(theme);
      setStorage({ theme }).then(flashSaved);
    };
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-theme]");
      if (btn) choose(btn.getAttribute("data-theme"));
    });
    // Radio-group keyboard model: arrows move the selection.
    root.addEventListener("keydown", (e) => {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!(e.key in keys)) return;
      const btns = [...root.querySelectorAll("button[data-theme]")];
      const rtl = document.documentElement.dir === "rtl";
      const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
      const step = keys[e.key] * (rtl && horizontal ? -1 : 1);
      const at = btns.findIndex((b) => b.getAttribute("data-theme") === State.theme);
      const next = btns[(at + step + btns.length) % btns.length];
      choose(next.getAttribute("data-theme"));
      next.focus();
      e.preventDefault();
    });
    // React to OS theme changes when "system" is selected
    try {
      window.matchMedia?.("(prefers-color-scheme: dark)")
        .addEventListener?.("change", () => { if (State.theme === "system") applyTheme("system"); });
    } catch (_) {}
  }

  // ── Live preview pane ─────────────────────────────────────────────
  //
  // v1.9.11: dynamic per-locale preview.
  //
  // Previously this was a hardcoded list of 4 languages (fa, ar, he, en) with
  // static buttons in options.html. Now:
  //   - Tabs are built from RTLY_I18N.SUPPORTED_LOCALES at startup, so adding
  //     a UI language automatically adds a preview tab.
  //   - Each locale's bubble text is sourced from i18n keys
  //     `previewBubbleUser<XX>` / `previewBubbleAi<XX>` where XX is the locale
  //     code with first-letter capitalized (en → "" suffix as legacy).
  //   - When the user changes UI language, the preview switches to that same
  //     language automatically. The user can still click a tab to inspect
  //     other languages without changing the UI.
  let previewLang = "fa";

  function localeSuffix(code) {
    // EN uses bare keys (`previewBubbleUser`, `previewBubbleAi`) for legacy
    // reasons. Every other locale appends a capitalized code: fa → "Fa",
    // ckb → "Ckb", etc.
    if (code === "en") return "";
    return code.charAt(0).toUpperCase() + code.slice(1).toLowerCase();
  }

  function previewKeysFor(code) {
    const sfx = localeSuffix(code);
    return { user: "previewBubbleUser" + sfx, ai: "previewBubbleAi" + sfx };
  }

  function previewDirFor(code) {
    return window.RTLY_I18N?.isRtl?.(code) ? "rtl" : "ltr";
  }

  function applyPreview() {
    const keys = previewKeysFor(previewLang);
    const stage = $("previewStage");
    if (!stage) return;
    const dir = previewDirFor(previewLang);
    const user = t(keys.user);
    const ai = t(keys.ai);

    stage.setAttribute("lang", previewLang);
    stage.setAttribute("dir", dir);
    $("previewBubbleUser").textContent = user;
    $("previewBubbleAi").textContent = ai;
    // Font scale → scale font-size of the stage
    stage.style.fontSize = (15 * (State.fontScale / 100)) + "px";

    // "Without RTLY" only makes sense for right-to-left text: same words,
    // browser defaults (left-aligned, system font).
    const before = $("paneBefore");
    before.hidden = dir !== "rtl";
    $("previewStageBefore").setAttribute("lang", previewLang);
    $("previewBubbleUserBefore").textContent = user;
    $("previewBubbleAiBefore").textContent = ai;

    const tabs = $("previewLangTabs");
    if (tabs) {
      tabs.querySelectorAll("button[data-lang]").forEach((b) => {
        b.setAttribute("aria-pressed", b.dataset.lang === previewLang ? "true" : "false");
      });
    }
  }

  function setupPreviewTabs() {
    const tabs = $("previewLangTabs");
    if (!tabs) return;
    tabs.textContent = "";

    const codes = window.RTLY_I18N?.SUPPORTED_LOCALES || ["en"];
    const names = window.RTLY_I18N?.LOCALE_NAMES || {};

    codes.forEach((code) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.lang = code;
      btn.textContent = names[code] || code;
      btn.setAttribute("lang", code);
      btn.setAttribute("aria-pressed", code === previewLang ? "true" : "false");
      btn.addEventListener("click", () => {
        previewLang = code;
        applyPreview();
      });
      tabs.appendChild(btn);
    });
  }

  // ── Display section ───────────────────────────────────────────────
  // The filled part of the slider track is driven by --fill (see ui.css).
  function paintRange(range) {
    const min = Number(range.min), max = Number(range.max);
    range.style.setProperty("--fill", ((Number(range.value) - min) / (max - min) * 100) + "%");
  }

  function setupDisplaySection() {
    // Font scale
    const range = $("fontScale");
    const val = $("fontScaleValue");
    range.value = String(State.fontScale);
    val.textContent = State.fontScale + "%";
    paintRange(range);
    const persistFontScale = debounce((n) => {
      setStorage({ fontScale: n }).then(flashSaved);
    }, 250);
    range.addEventListener("input", () => {
      State.fontScale = parseInt(range.value, 10) || 100;
      val.textContent = State.fontScale + "%";
      paintRange(range);
      applyPreview();
      persistFontScale(State.fontScale);
    });

    // UI language
    populateLocalePicker();

    // Color palette
    setupPalettePicker();
  }

  function populateLocalePicker() {
    const sel = $("uiLocale");
    sel.innerHTML = "";
    if (!window.RTLY_I18N) return;
    const codes = window.RTLY_I18N.SUPPORTED_LOCALES || ["en"];
    const names = window.RTLY_I18N.LOCALE_NAMES || {};
    codes.forEach((code) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = names[code] || code;
      sel.appendChild(opt);
    });
    sel.value = window.RTLY_I18N.currentLocale();
    sel.addEventListener("change", () => {
      window.RTLY_I18N.setLocale(sel.value).then(() => {
        // v1.9.11: switching UI language also switches the preview to the
        // same language so the user sees the bubbles in their chosen UI
        // locale immediately. They can still click another preview tab to
        // inspect a different language without changing the UI.
        previewLang = sel.value;
        // Re-render texts that JS produced
        renderSiteTable();
        // Rebuild tabs so their labels (LOCALE_NAMES are native names and
        // don't change with locale, but the aria-selected / active classes
        // need refreshing).
        setupPreviewTabs();
        setupPalettePicker();
        applyPreview();
        if (footerInstance) footerInstance.refreshLocale();
        updateCounts();
        flashSaved();
      });
    });
  }

  // ── Sites table ───────────────────────────────────────────────────
  function isPinned(siteId) {
    return typeof State.pinnedSites[siteId] === "boolean"
      ? State.pinnedSites[siteId]
      : DEFAULT_PINNED.includes(siteId);
  }

  const STAR_D = "M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7L12 2z";
  const SVG_NS = "http://www.w3.org/2000/svg";

  function starIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", STAR_D);
    svg.appendChild(path);
    return svg;
  }

  function cell(className) {
    const td = document.createElement("td");
    td.className = className;
    return td;
  }

  function renderSiteTable() {
    const body = $("siteTableBody");
    body.textContent = "";

    SITES.forEach((site) => {
      const enabled = State.siteSettings[site.id] !== false;
      const mode = State.siteModes[site.id] || "full";
      const pinned = isPinned(site.id);

      const tr = document.createElement("tr");
      tr.setAttribute("data-site", site.id);
      tr.setAttribute("data-search", (site.label + " " + site.id).toLowerCase());

      // Site cell
      const tdSite = cell("col-site");
      const wrap = document.createElement("div");
      wrap.className = "site-cell";
      const tile = document.createElement("div");
      tile.className = "tile";
      if (site.logo) {
        const img = document.createElement("img");
        img.src = "../../logos/" + site.logo + ".svg";
        img.alt = "";
        tile.appendChild(img);
      } else {
        const span = document.createElement("span");
        span.className = "tile__fallback";
        span.textContent = site.initial || site.label[0];
        tile.appendChild(span);
      }
      const text = document.createElement("div");
      text.className = "site-cell__text";
      const nameSpan = document.createElement("span");
      nameSpan.className = "site-cell__name";
      nameSpan.textContent = site.label;
      const domSpan = document.createElement("bdi");
      domSpan.className = "site-cell__domain";
      domSpan.textContent = site.id;
      text.append(nameSpan, domSpan);
      wrap.append(tile, text);
      tdSite.appendChild(wrap);
      tr.appendChild(tdSite);

      // Mode: segmented buttons
      const tdMode = cell("col-mode");
      const chips = document.createElement("div");
      chips.className = "seg seg--sm";
      chips.setAttribute("role", "group");
      chips.setAttribute("aria-label", site.label + " — " + t("columnMode"));
      MODES.forEach((m) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = m === "full" ? t("modeChipFull") : m === "font_only" ? t("modeChipFontOnly") : t("modeChipRtlOnly");
        b.title = t(m === "full" ? "modeFull" : m === "font_only" ? "modeFontOnly" : "modeRtlOnly");
        b.setAttribute("aria-pressed", String(m === mode));
        b.addEventListener("click", () => {
          State.siteModes[site.id] = m;
          setStorage({ siteModes: State.siteModes }).then(flashSaved);
          [...chips.children].forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
        });
        chips.appendChild(b);
      });
      tdMode.appendChild(chips);
      tr.appendChild(tdMode);

      // Pin
      const tdPin = cell("col-pin");
      const star = document.createElement("button");
      star.type = "button";
      star.className = "star-btn";
      star.setAttribute("aria-label", site.label + " — " + t("columnPin"));
      star.setAttribute("aria-pressed", String(pinned));
      star.appendChild(starIcon());
      star.addEventListener("click", () => {
        const next = star.getAttribute("aria-pressed") !== "true";
        State.pinnedSites[site.id] = next;
        star.setAttribute("aria-pressed", String(next));
        setStorage({ pinnedSites: State.pinnedSites }).then(() => {
          flashSaved();
          updateCounts();
        });
      });
      tdPin.appendChild(star);
      tr.appendChild(tdPin);

      // Toggle
      const tdToggle = cell("col-status");
      const lbl = document.createElement("label");
      lbl.className = "toggle";
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.checked = enabled;
      inp.setAttribute("aria-label", site.label + " — " + t("columnStatus"));
      inp.addEventListener("change", () => {
        // Optimistic update with rollback: if the background rejects or fails
        // the update, revert the checkbox + State so the UI never lies.
        const previous = State.siteSettings[site.id];
        const next = inp.checked;
        State.siteSettings[site.id] = next;
        updateCounts();

        const rollback = () => {
          State.siteSettings[site.id] = previous;
          inp.checked = previous !== false; // default = enabled
          updateCounts();
          flashSaved(false);
        };

        if (chrome?.runtime?.sendMessage) {
          try {
            chrome.runtime.sendMessage(
              { action: "toggleSiteStatus", site: site.id, status: next },
              (response) => {
                const failed = chrome.runtime.lastError || !response || response.success !== true;
                if (failed) {
                  if (chrome.runtime.lastError) console.debug("RTLY:", chrome.runtime.lastError.message);
                  rollback();
                } else {
                  flashSaved();
                }
              }
            );
          } catch (e) {
            console.debug("RTLY: sendMessage failed", e);
            rollback();
          }
        } else {
          writeSiteSettingFallback(site.id, next).then(flashSaved);
        }
      });
      const track = document.createElement("span");
      track.className = "track";
      lbl.append(inp, track);
      tdToggle.appendChild(lbl);
      tr.appendChild(tdToggle);

      body.appendChild(tr);
    });
    updateCounts();
    filterSites();
  }

  function makeCountFragment(count, labelKey) {
    const span = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = String(count);
    const labelText = t(labelKey).replace(/\{0\}/, "").trim();
    span.appendChild(strong);
    span.appendChild(document.createTextNode(" " + labelText));
    return span;
  }

  function updateCounts() {
    const enabledCount = SITES.filter((s) => State.siteSettings[s.id] !== false).length;
    const pinnedCount = SITES.filter((s) => isPinned(s.id)).length;

    const head = $("siteHeadMeta");
    head.textContent = "";
    head.appendChild(makeCountFragment(enabledCount, "enabledCountFmt"));
    head.appendChild(document.createTextNode(" · "));
    head.appendChild(makeCountFragment(pinnedCount, "pinnedCountFmt"));
  }

  function filterSites() {
    const q = $("siteSearch").value.trim().toLowerCase();
    let visible = 0;
    $("siteTableBody").querySelectorAll("tr").forEach((tr) => {
      const match = !q || (tr.getAttribute("data-search") || "").includes(q);
      tr.classList.toggle("is-hidden", !match);
      if (match) visible++;
    });
    $("siteEmpty").hidden = visible > 0;
  }

  function setupSiteSearch() {
    $("siteSearch").addEventListener("input", filterSites);
  }

  // ── Dynamic footer ────────────────────────────────────────────────
  // Replaces the previous static changelog+email+website footer.
  const SUPPORT_URL = "https://buymeacoffee.com/enaloo";
  let footerInstance = null;

  function openTab(url) {
    if (!url) return;
    try {
      if (chrome?.tabs?.create) chrome.tabs.create({ url, active: true });
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (_) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  function setupFooter() {
    const mount = $("footerMount");
    if (!mount || !window.RTLY_FOOTER?.create) return;
    footerInstance = window.RTLY_FOOTER.create({
      root: mount,
      t,
      openUrl: openTab,
    });
    footerInstance.start();
  }

  function setupSupportButton() {
    const btn = $("optionsSupportBtn");
    if (!btn) return;
    btn.addEventListener("click", () => openTab(SUPPORT_URL));
  }

  // ── Boot ──────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      if (window.RTLY_I18N) await window.RTLY_I18N.init();

      const st = await getStorage([
        "siteSettings", "siteModes", "pinnedSites",
        "fontScale", "theme", "uiLocale", "colorPalette",
      ]);
      State.siteSettings = canonicalizeLegacyKeys(st.siteSettings || {});
      State.siteModes = canonicalizeLegacyKeys(st.siteModes || {});
      State.pinnedSites = st.pinnedSites || {};
      State.fontScale = typeof st.fontScale === "number" ? st.fontScale : 100;
      State.theme = st.theme || "system";
      State.uiLocale = st.uiLocale || (window.RTLY_I18N?.currentLocale?.() || "en");
      State.colorPalette = PALETTES.includes(st.colorPalette) ? st.colorPalette : "teal";

      // Apply theme + palette first to avoid flash
      applyTheme(State.theme);
      applyPalette(State.colorPalette);

      // v1.9.11: seed previewLang from the active UI locale BEFORE building
      // tabs, so the correct tab is marked active on first paint. If the UI
      // locale isn't supported in i18n, fall back to "fa" (matches legacy
      // default).
      const initialLocale = window.RTLY_I18N?.currentLocale?.() || State.uiLocale || "fa";
      const supported = window.RTLY_I18N?.SUPPORTED_LOCALES || ["fa"];
      previewLang = supported.includes(initialLocale) ? initialLocale : "fa";

      setupThemeSwitcher();
      setupPreviewTabs();
      setupPalettePicker();
      setupDisplaySection();
      setupSiteSearch();
      setupSupportButton();
      renderSiteTable();
      applyPreview();
      setupFooter();

      // External changes (e.g. from popup) → reflect here
      chrome?.storage?.onChanged?.addListener?.((changes, area) => {
        if (area !== "local") return;
        let needTable = false;
        if (changes.siteSettings) { State.siteSettings = canonicalizeLegacyKeys(changes.siteSettings.newValue || {}); needTable = true; }
        if (changes.siteModes) { State.siteModes = canonicalizeLegacyKeys(changes.siteModes.newValue || {}); needTable = true; }
        if (changes.pinnedSites) { State.pinnedSites = changes.pinnedSites.newValue || {}; needTable = true; }
        if (changes.fontScale) {
          State.fontScale = typeof changes.fontScale.newValue === "number" ? changes.fontScale.newValue : 100;
          const r = $("fontScale"); const v = $("fontScaleValue");
          if (r) { r.value = String(State.fontScale); paintRange(r); }
          if (v) v.textContent = State.fontScale + "%";
          applyPreview();
        }
        if (changes.theme) {
          State.theme = changes.theme.newValue || "system";
          applyTheme(State.theme);
        }
        if (changes.colorPalette) {
          const next = changes.colorPalette.newValue;
          if (next && PALETTES.includes(next) && next !== State.colorPalette) {
            State.colorPalette = next;
            applyPalette(next);
            // Refresh swatch active states
            const root = $("palettePicker");
            if (root) {
              root.querySelectorAll("[data-palette-id]").forEach((b) => {
                const active = b.dataset.paletteId === next;
                b.classList.toggle("is-active", active);
                b.setAttribute("aria-checked", String(active));
              });
            }
          }
        }
        // v1.9.11: uiLocale change from another window (popup or another
        // options tab) — sync the dropdown, switch the preview to the new
        // locale, and re-render. i18n.js has its own listener that handles
        // applyDirection/applyToDom; this block handles options-page state
        // that lives outside the i18n module.
        if (changes.uiLocale) {
          const nextLocale = changes.uiLocale.newValue;
          const supported = window.RTLY_I18N?.SUPPORTED_LOCALES || [];
          if (nextLocale && supported.includes(nextLocale)) {
            State.uiLocale = nextLocale;
            const sel = $("uiLocale");
            if (sel && sel.value !== nextLocale) sel.value = nextLocale;
            previewLang = nextLocale;
            setupPreviewTabs();
            setupPalettePicker();
            applyPreview();
            // Re-render JS-produced texts so they reflect the new locale.
            renderSiteTable();
            updateCounts();
            if (footerInstance) footerInstance.refreshLocale();
          }
        }
        if (needTable) renderSiteTable();
      });
    } catch (err) {
      console.error("RTLY: options init error", err);
    }
  });
})();
