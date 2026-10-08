/* RTLY — popup logic (version lives in manifest.json)
 *
 * Storage schema (kept backward compatible with content.js / background.js):
 *   siteSettings:  { [domain]: boolean }   // per-site on/off
 *   siteModes:     { [domain]: "full"|"font_only"|"rtl_only" }
 *   pinnedSites:   { [domain]: boolean }
 *   fontScale:     number (85..120)
 *   theme:         "light"|"dark"|"system"
 *   colorPalette:  "teal"|"blue"|"indigo"|"neutral"
 *   uiLocale:      string
 *
 * Background protocol (unchanged): { action: "toggleSiteStatus", site, status }
 *
 * Removed in 1.8: legacy global `liteMode` toggle (redundant with the per-site
 * "rtl_only" mode chip, and caused confusion when the popup chip showed "Full"
 * but the content script applied "rtl_only" via the liteMode fallback).
 *
 * New in 1.8: overflow menu (settings / about / theme / color palette), About
 * modal, support button (buymeacoffee), dynamic rotating footer (see footer.js
 * + footerConfig.js), popup-level theme application, color palette feature.
 */
(function () {
  "use strict";

  const HELP_URL = "https://ehsanenaloo.github.io/RTLY/";
  const WEBSITE_URL = "https://www.enaloo.com";
  const SUPPORT_URL = "https://buymeacoffee.com/enaloo";

  // ── Support nudge config ───────────────────────────────────────────
  // A quiet, in-popup banner shown at most once a month. The toolbar-icon
  // badge (managed by background.js) is the *invitation*; this banner is what
  // the user sees once they open the popup. Tunables live here only:
  //   variant         "card" (richer) | "slim" (one-line, most minimal)
  //   initialDelayDays grace period after install before the first nudge
  //   intervalDays     minimum gap between nudges (the "monthly" cadence)
  const NUDGE = { variant: "card", initialDelayDays: 14, intervalDays: 30 };

  // Public store listing (Chrome Web Store id). Edge installs the same listing;
  // Firefox has no listing yet, so it points to the GitHub repository.
  function nudgeStoreUrl() {
    if (/firefox/i.test(navigator.userAgent)) return "https://github.com/ehsanenaloo/RTLY";
    return "https://chromewebstore.google.com/detail/hhifipkafndnildgldggiohfkbpikmkd/reviews";
  }
  // Single source of the "is it time?" rule — mirrored in background.js.
  function nudgeIsDue(nudge, now) {
    if (!nudge || nudge.optOut) return false;
    const installedAt = nudge.installedAt || now;
    if (!nudge.lastShownAt) return now >= installedAt + NUDGE.initialDelayDays * 86400000;
    return (now - nudge.lastShownAt) >= NUDGE.intervalDays * 86400000;
  }

  // ── Catalog of supported sites ─────────────────────────────────────
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

  // Hostname → canonical site id (matches background.js HOST_TO_SITE)
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

  // Tiny helpers
  const t = (k, fb) => window.RTLY_I18N ? window.RTLY_I18N.t(k, fb) : (fb || k);
  const fmt = (str, ...args) => str.replace(/\{(\d+)\}/g, (_, i) => args[i] != null ? args[i] : "");
  const $ = (id) => document.getElementById(id);
  // Static, extension-owned SVG markup only. Parsed as XML and imported rather
  // than assigned through innerHTML (AMO lint, defence in depth).
  const svgNode = (markup) => {
    const doc = new DOMParser().parseFromString(
      String(markup).replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"'), "image/svg+xml");
    return document.importNode(doc.documentElement, true);
  };
  const setSvg = (node, markup) => { node.replaceChildren(svgNode(markup)); };
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "html") node.replaceChildren(svgNode(v));
      else if (k.startsWith("data-")) node.setAttribute(k, v);
      else if (k.startsWith("aria-")) node.setAttribute(k, v);
      else if (k === "for") node.htmlFor = v;
      else node[k] = v;
    });
    children.flat().forEach((c) => {
      if (c == null) return;
      if (typeof c === "string") node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  };

  function openTab(url) {
    if (!url) return;
    try {
      if (chrome?.tabs?.create) chrome.tabs.create({ url, active: true });
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (_) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  // Storage helpers — Promise wrappers around chrome.storage.local
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

  // ── Theme handling (popup edition) ───────────────────────────────
  function applyTheme(theme) {
    // Always write the *effective* theme so CSS needs a single dark selector.
    let effective = theme;
    if (theme === "system") {
      effective = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", effective === "dark" ? "dark" : "light");
  }

  // ── Resolve current tab → site id ────────────────────────────────
  function resolveCurrentSite() {
    return new Promise((resolve) => {
      if (!chrome?.tabs?.query) return resolve(null);
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (chrome.runtime?.lastError || !tabs || !tabs[0] || !tabs[0].url) {
            return resolve(null);
          }
          try {
            const u = new URL(tabs[0].url);
            const host = u.hostname.toLowerCase();
            if (HOST_TO_SITE[host]) return resolve(HOST_TO_SITE[host]);
            for (const h of Object.keys(HOST_TO_SITE)) {
              if (host === h || host.endsWith("." + h)) return resolve(HOST_TO_SITE[h]);
            }
            resolve(null);
          } catch (_) {
            resolve(null);
          }
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function iconUrl(logoKey) {
    return logoKey ? `../../logos/${logoKey}.svg` : null;
  }

  // ── Rendering ─────────────────────────────────────────────────────
  // Renders replace whole subtrees, so keyboard focus is captured by a
  // data-fk key before and restored after (otherwise toggling with the
  // keyboard would drop focus to <body>).
  function withFocusKept(render) {
    const key = document.activeElement?.dataset?.fk;
    render();
    if (key) {
      const next = document.querySelector(`[data-fk="${key}"]`);
      if (next) next.focus({ preventScroll: true });
    }
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  const STAR_PATH = "M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7L12 2z";
  const INFO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4M12 8h.01"></path></svg>';

  function siteTile(site, large) {
    const tile = el("div", { class: "tile" + (large ? " tile--lg" : "") });
    if (site.logo) tile.appendChild(el("img", { src: iconUrl(site.logo), alt: "" }));
    else tile.appendChild(el("span", { class: "tile__fallback" }, site.label[0]));
    return tile;
  }

  function pinIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "site-row__pin");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", t("columnPin"));
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", STAR_PATH);
    svg.appendChild(path);
    return svg;
  }

  function switchControl(size, checked, label, fk, onChange) {
    const wrap = el("label", { class: `toggle toggle--${size}` });
    const input = el("input", { type: "checkbox", "aria-label": label, "data-fk": fk });
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    wrap.append(input, el("span", { class: "track" }));
    return wrap;
  }

  const MODE_HINT_KEYS = { full: "modeFull", font_only: "modeFontOnly", rtl_only: "modeRtlOnly" };

  function renderHero(currentSite, state) {
    withFocusKept(() => {
      const host = $("hero");
      host.textContent = "";
      const site = SITES.find((s) => s.id === currentSite);
      if (!site) {
        const card = el("div", { class: "hero hero--empty" });
        card.appendChild(el("div", { class: "tile", html: INFO_SVG }));
        const body = el("div");
        body.appendChild(el("div", { class: "hero__title" }, t("heroNotSupported")));
        body.appendChild(el("div", { class: "hero__hint" }, t("heroNotSupportedHint")));
        card.appendChild(body);
        host.appendChild(card);
        return;
      }

      const enabled = state.siteSettings[site.id] !== false;
      const mode = state.siteModes[site.id] || "full";
      const card = el("section", { class: "hero", "aria-label": site.label });
      card.setAttribute("data-active", String(enabled));

      const top = el("div", { class: "hero__top" });
      top.appendChild(siteTile(site, true));
      const meta = el("div", { class: "hero__meta" });
      meta.appendChild(el("div", { class: "hero__eyebrow" }, t("popupCurrentSite")));
      const nameLine = el("div", { class: "hero__site" });
      nameLine.appendChild(el("span", { class: "hero__name" }, site.label));
      nameLine.appendChild(el("bdi", { class: "hero__domain" }, site.id));
      meta.appendChild(nameLine);
      const status = el("div", { class: "hero__status", role: "status" });
      status.appendChild(el("span", { class: "hero__dot", "aria-hidden": "true" }));
      status.appendChild(el("span", {}, enabled ? t("heroStatusOn") : t("heroStatusOff")));
      meta.appendChild(status);
      top.appendChild(meta);
      top.appendChild(switchControl("lg", enabled, `${site.label} — ${t("columnStatus")}`, "hero-toggle",
        (on) => onMasterToggle(site.id, on)));
      card.appendChild(top);

      const controls = el("div", { class: "hero__controls" });

      // Mode: segmented radio group
      const seg = el("div", { class: "seg", role: "radiogroup", "aria-label": t("columnMode") });
      const hint = el("p", { class: "hero__modehint", id: "modeHint" }, t(MODE_HINT_KEYS[mode]));
      [
        { id: "full",      label: t("modeChipFull") },
        { id: "font_only", label: t("modeChipFontOnly") },
        { id: "rtl_only",  label: t("modeChipRtlOnly") },
      ].forEach((m) => {
        const inputId = `mode-${m.id}`;
        const input = el("input", { type: "radio", name: "mode", id: inputId, "data-fk": inputId });
        input.checked = mode === m.id;
        input.addEventListener("change", () => {
          if (!input.checked) return;
          hint.textContent = t(MODE_HINT_KEYS[m.id]);
          onModeChange(site.id, m.id);
        });
        seg.append(input, el("label", { for: inputId }, m.label));
      });
      controls.append(seg, hint);

      // Font size stepper
      const row = el("div", { class: "fontrow" });
      row.appendChild(el("span", { class: "fontrow__label" }, t("fontSizeShort")));
      const stepper = el("div", { class: "stepper" });
      const down = el("button", { type: "button", id: "fontDownBtn", "aria-label": t("fontDecreaseAria"), title: t("fontDecreaseAria"), "data-fk": "font-down" }, "A−");
      const value = el("span", { class: "stepper__value", id: "fontScaleValue", "aria-live": "polite" }, (state.fontScale || 100) + "%");
      const up = el("button", { type: "button", id: "fontUpBtn", "aria-label": t("fontIncreaseAria"), title: t("fontIncreaseAria"), "data-fk": "font-up" }, "A+");
      down.disabled = (state.fontScale || 100) <= 85;
      up.disabled = (state.fontScale || 100) >= 120;
      down.addEventListener("click", () => onFontScaleChange(-5));
      up.addEventListener("click", () => onFontScaleChange(5));
      stepper.append(down, value, up);
      row.appendChild(stepper);
      controls.appendChild(row);

      card.appendChild(controls);
      host.appendChild(card);
    });
  }

  function renderSitesList(currentSite, state) {
    withFocusKept(() => {
      const list = $("sitesList");
      list.textContent = "";

      const pinned = [];
      const others = [];
      SITES.forEach((site) => {
        const isPinned = typeof state.pinnedSites[site.id] === "boolean"
          ? state.pinnedSites[site.id]
          : DEFAULT_PINNED.includes(site.id);
        (isPinned ? pinned : others).push({ site, isPinned });
      });

      [...pinned, ...others].forEach(({ site, isPinned }) => {
        const enabled = state.siteSettings[site.id] !== false;
        const mode = state.siteModes[site.id] || "full";
        const isCurrent = currentSite === site.id;

        const row = el("div", { class: "site-row", role: "listitem" });
        if (isCurrent) row.setAttribute("data-current", "true");
        row.appendChild(siteTile(site, false));

        const text = el("div", { class: "site-row__name" }, site.label);
        const tags = [];
        if (isCurrent) tags.push(el("span", { class: "tag tag--current" }, t("heroCurrent")));
        if (mode === "font_only") tags.push(el("span", { class: "tag" }, t("modeBadgeFontOnly")));
        else if (mode === "rtl_only") tags.push(el("span", { class: "tag" }, t("modeBadgeRtlOnly")));
        if (tags.length) text.appendChild(el("div", { class: "site-row__tags" }, ...tags));
        row.appendChild(text);

        if (isPinned) row.appendChild(pinIcon());
        row.appendChild(switchControl("sm", enabled, site.label, `site-${site.id}`,
          (on) => onMasterToggle(site.id, on)));
        list.appendChild(row);
      });

      const enabledCount = SITES.filter((s) => state.siteSettings[s.id] !== false).length;
      $("sitesCount").textContent = fmt(t("sitesCountFmt"), enabledCount, SITES.length);
    });
  }

  // ── Mutations: forward through background for live reload ─────────
  function onMasterToggle(siteId, status) {
    // Optimistic update with rollback (v1.9.20). Enable/disable genuinely
    // needs a tab reload (a disabled tab's content script bootstrapped out,
    // so it can't self-activate from a storage event) — that reload happens
    // in background.js, which also handles the chatgpt.com↔chat.openai.com
    // alias. If the background update fails, revert the UI so it doesn't lie.
    const previous = State.siteSettings[siteId];
    State.siteSettings[siteId] = status;
    renderHero(State.currentSite, State);
    renderSitesList(State.currentSite, State);

    const rollback = () => {
      State.siteSettings[siteId] = previous;
      renderHero(State.currentSite, State);
      renderSitesList(State.currentSite, State);
    };

    if (chrome?.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage(
          { action: "toggleSiteStatus", site: siteId, status },
          (response) => {
            const failed = chrome.runtime.lastError || !response || response.success !== true;
            if (failed) {
              if (chrome.runtime.lastError) console.debug("RTLY:", chrome.runtime.lastError.message);
              rollback();
            }
          }
        );
      } catch (e) {
        console.debug("RTLY: sendMessage failed", e);
        rollback();
      }
    } else {
      setStorage({ siteSettings: { ...State.siteSettings, [siteId]: status } });
    }
  }

  function onModeChange(siteId, mode) {
    // v1.9.20: mode changes propagate LIVE via content.js's storage.onChanged
    // (which reapplies under the new effective mode without a reload). No tab
    // matching / reload here — that removes the popup-only reload flash and
    // the chatgpt alias gap that used to miss open chat.openai.com tabs.
    State.siteModes[siteId] = mode;
    setStorage({ siteModes: State.siteModes });
    renderSitesList(State.currentSite, State);
  }

  function onFontScaleChange(delta) {
    let scale = (State.fontScale || 100) + delta;
    if (scale < 85) scale = 85;
    if (scale > 120) scale = 120;
    if (scale === State.fontScale) return;
    State.fontScale = scale;
    setStorage({ fontScale: scale });
    // Update the value display + button disabled-states in place.
    const valueEl = document.getElementById("fontScaleValue");
    if (valueEl) valueEl.textContent = scale + "%";
    updateFontScaleButtons();
  }

  function updateFontScaleButtons() {
    const dn = document.getElementById("fontDownBtn");
    const up = document.getElementById("fontUpBtn");
    if (dn) dn.disabled = State.fontScale <= 85;
    if (up) up.disabled = State.fontScale >= 120;
  }

  // ── Color palette ────────────────────────────────────────────────
  const PALETTES = ["teal", "blue", "indigo", "neutral"];
  function applyPalette(palette) {
    const valid = PALETTES.includes(palette) ? palette : "teal";
    document.documentElement.dataset.palette = valid;
  }

  // ── Overflow menu (Settings / About / Theme) ──────────────────────
  let menuOutsideHandlersBound = false;

  function setMenuExpanded(expanded) {
    const trigger = $("overflowBtn");
    if (trigger) trigger.setAttribute("aria-expanded", expanded ? "true" : "false");
    const menu = $("overflowMenu");
    if (!menu) return;
    if (expanded) menu.removeAttribute("hidden");
    else menu.setAttribute("hidden", "");
    menu.classList.toggle("is-open", expanded);
  }

  function onMenuPointerDown(event) {
    const menu = $("overflowMenu");
    const trigger = $("overflowBtn");
    if (!menu || menu.hidden) return;
    if (menu.contains(event.target) || trigger?.contains(event.target)) return;
    closeOverflowMenu();
  }
  function onMenuKeyDown(event) {
    const menu = $("overflowMenu");
    if (!menu || menu.hidden) return;
    if (event.key === "Escape") {
      closeOverflowMenu();
      $("overflowBtn")?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const items = [...menu.querySelectorAll("button")];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length].focus();
      event.preventDefault();
    }
  }
  function attachMenuDismissHandlers() {
    if (menuOutsideHandlersBound) return;
    document.addEventListener("pointerdown", onMenuPointerDown, true);
    document.addEventListener("keydown", onMenuKeyDown, true);
    menuOutsideHandlersBound = true;
  }
  function detachMenuDismissHandlers() {
    if (!menuOutsideHandlersBound) return;
    document.removeEventListener("pointerdown", onMenuPointerDown, true);
    document.removeEventListener("keydown", onMenuKeyDown, true);
    menuOutsideHandlersBound = false;
  }
  function closeOverflowMenu() {
    setMenuExpanded(false);
    detachMenuDismissHandlers();
  }
  function openOverflowMenu() {
    renderOverflowMenuBody();
    setMenuExpanded(true);
    attachMenuDismissHandlers();
    $("overflowMenu")?.querySelector("[role=menuitem]")?.focus();
  }
  function toggleOverflowMenu() {
    const menu = $("overflowMenu");
    if (!menu) return;
    if (menu.hidden) openOverflowMenu();
    else closeOverflowMenu();
  }

  function themeIconSvg(name) {
    if (name === "light") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>';
    if (name === "dark") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg>';
  }

  function renderOverflowMenuBody() {
    const menu = $("overflowMenu");
    if (!menu) return;
    menu.textContent = "";

    // Settings item
    const settingsItem = el("button", { class: "rtly-overflow-item", type: "button", role: "menuitem" });
    settingsItem.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
    settingsItem.appendChild(el("span", {}, t("menuSettings")));
    settingsItem.addEventListener("click", (e) => {
      e.stopPropagation();
      closeOverflowMenu();
      try {
        if (chrome?.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
        else if (chrome?.runtime?.getURL) window.open(chrome.runtime.getURL("pages/options/options.html"));
      } catch (_) {}
    });

    // Help item: the user guide hosted on GitHub Pages
    const helpItem = el("button", { class: "rtly-overflow-item", type: "button", role: "menuitem" });
    setSvg(helpItem, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>');
    helpItem.appendChild(el("span", {}, t("menuHelp")));
    helpItem.addEventListener("click", (e) => {
      e.stopPropagation();
      closeOverflowMenu();
      openTab(HELP_URL);
    });

    // About item
    const aboutItem = el("button", { class: "rtly-overflow-item", type: "button", role: "menuitem" });
    aboutItem.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4M12 8h.01"></path></svg>';
    aboutItem.appendChild(el("span", {}, t("menuAbout")));
    aboutItem.addEventListener("click", (e) => {
      e.stopPropagation();
      closeOverflowMenu();
      openAboutModal();
    });

    // Support item
    const supportItem = el("button", { class: "rtly-overflow-item", type: "button", role: "menuitem" });
    supportItem.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.5-9.5-9.5C1.1 8.2 3.2 5 6.5 5c2 0 3.5 1 4.5 2.5 1-1.5 2.5-2.5 4.5-2.5 3.3 0 5.4 3.2 4 6.5C19.5 16.5 12 21 12 21z"></path></svg>';
    supportItem.appendChild(el("span", {}, t("menuSupportShort")));
    supportItem.addEventListener("click", (e) => {
      e.stopPropagation();
      closeOverflowMenu();
      openTab(SUPPORT_URL);
    });

    // Theme block
    const themeBlock = el("div", { class: "rtly-overflow-theme" });
    themeBlock.appendChild(el("div", { class: "rtly-overflow-section-label" }, t("menuTheme")));
    const themeButtons = el("div", { class: "rtly-overflow-theme-buttons" });
    [
      { mode: "light",  iconKey: "light",  label: t("themeLight") },
      { mode: "dark",   iconKey: "dark",   label: t("themeDark") },
      { mode: "system", iconKey: "system", label: t("themeSystem") },
    ].forEach((item) => {
      const btn = el("button", { class: "rtly-theme-pip", type: "button" });
      btn.dataset.themePip = item.mode;
      btn.title = item.label;
      btn.setAttribute("aria-label", item.label);
      btn.setAttribute("aria-pressed", String(State.theme === item.mode));
      btn.classList.toggle("is-active", State.theme === item.mode);
      setSvg(btn, themeIconSvg(item.iconKey));
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        State.theme = item.mode;
        applyTheme(item.mode);
        setStorage({ theme: item.mode });
        themeButtons.querySelectorAll("[data-theme-pip]").forEach((b) => {
          const active = b.dataset.themePip === item.mode;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-pressed", String(active));
        });
      });
      themeButtons.appendChild(btn);
    });
    themeBlock.appendChild(themeButtons);

    // Palette block
    const paletteBlock = el("div", { class: "rtly-overflow-palette" });
    paletteBlock.appendChild(el("div", { class: "rtly-overflow-section-label" }, t("colorPaletteLabel")));
    const paletteButtons = el("div", { class: "rtly-overflow-palette-buttons" });
    [
      { id: "teal",    label: t("paletteTeal"),    color: "#0E7C95" },
      { id: "blue",    label: t("paletteBlue"),    color: "#1A73E8" },
      { id: "indigo",  label: t("paletteIndigo"),  color: "#3949AB" },
      { id: "neutral", label: t("paletteNeutral"), color: "#5F6368" },
    ].forEach((item) => {
      const btn = el("button", { class: "rtly-palette-swatch", type: "button" });
      btn.dataset.paletteId = item.id;
      btn.title = item.label;
      btn.setAttribute("aria-label", item.label);
      btn.setAttribute("aria-pressed", String(State.colorPalette === item.id));
      btn.classList.toggle("is-active", State.colorPalette === item.id);
      btn.style.setProperty("--swatch-color", item.color);
      btn.innerHTML = '<span class="rtly-palette-dot" aria-hidden="true"></span>';
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        State.colorPalette = item.id;
        applyPalette(item.id);
        setStorage({ colorPalette: item.id });
        paletteButtons.querySelectorAll("[data-palette-id]").forEach((b) => {
          const active = b.dataset.paletteId === item.id;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-pressed", String(active));
        });
      });
      paletteButtons.appendChild(btn);
    });
    paletteBlock.appendChild(paletteButtons);

    menu.append(settingsItem, helpItem, aboutItem, supportItem, themeBlock, paletteBlock);
  }

  // ── About modal ───────────────────────────────────────────────────
  function openAboutModal() {
    const root = $("aboutModalRoot");
    if (!root) return;
    if (root.querySelector(".rtly-about-overlay")) return; // already open

    const overlay = el("div", { class: "rtly-about-overlay" });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeAboutModal();
    });

    const modal = el("div", { class: "rtly-about-modal", role: "dialog", "aria-modal": "true" });
    modal.setAttribute("aria-label", t("aboutModalTitle"));

    const version = (() => {
      try { return chrome?.runtime?.getManifest?.()?.version || ""; }
      catch (_) { return ""; }
    })();

    const head = el("div", { class: "rtly-about-head" });
    const headLogo = el("div", { class: "rtly-about-logo", "aria-hidden": "true" });
    const logoImg = el("img");
    logoImg.alt = "";
    try { logoImg.src = chrome.runtime.getURL("icons/icon-48.png"); }
    catch (_) {}
    headLogo.appendChild(logoImg);

    const meta = el("div", { class: "rtly-about-meta" });
    meta.appendChild(el("div", { class: "rtly-about-title" }, t("aboutModalTitle")));
    if (version) meta.appendChild(el("div", { class: "rtly-about-version" }, fmt(t("aboutVersionFmt"), version)));

    const closeBtn = el("button", {
      class: "rtly-about-close",
      type: "button",
      "aria-label": t("closeAria")
    });
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"></path></svg>';
    closeBtn.addEventListener("click", closeAboutModal);

    head.append(headLogo, meta, closeBtn);

    // Hero — 1.8.6: the prominent text is the author copyright, per request.
    // The marketing kicker/copy that used to live here was generic and not
    // useful to users opening About; the bottom Copyright section is now
    // promoted into the hero, with the author line on top.
    const websiteLink = el("button", { class: "rtly-about-link", type: "button", title: t("footerAboutCta") }, "www.enaloo.com");
    websiteLink.addEventListener("click", () => openTab(WEBSITE_URL));
    const hero = el("section", { class: "rtly-about-hero" });
    hero.append(
      el("div", { class: "rtly-about-badge" }, t("aboutBadge")),
      el("div", { class: "rtly-about-kicker" }, t("aboutCopyrightAuthor")),
      el("div", { class: "rtly-about-copy" }, t("aboutCopyrightLine")),
      websiteLink
    );

    // Tagline (kept short, taken from the old kicker) — provides one line of
    // context about what RTLY does, below the copyright.
    const tagline = el("section", { class: "rtly-about-copyright" });
    tagline.appendChild(el("div", { class: "rtly-about-copyright-line" }, t("aboutKicker")));

    // Support card
    const support = el("section", { class: "rtly-about-support-card" });
    support.appendChild(el("div", { class: "rtly-about-section-title" }, t("aboutSupportTitle")));
    support.appendChild(el("div", { class: "rtly-about-copy" }, t("aboutSupportCopy")));
    const supportActions = el("div", { class: "rtly-about-actions" });
    const coffeeBtn = el("button", {
      class: "rtly-about-primary-btn",
      type: "button"
    }, t("aboutSupportCta"));
    coffeeBtn.addEventListener("click", () => openTab(SUPPORT_URL));
    supportActions.appendChild(coffeeBtn);
    support.appendChild(supportActions);

    const body = el("div", { class: "rtly-about-body" }, hero, tagline, support);
    modal.append(head, body);
    overlay.appendChild(modal);
    root.appendChild(overlay);

    // Trap focus minimal: focus the close button
    setTimeout(() => closeBtn.focus(), 0);

    const onKey = (e) => {
      if (e.key === "Escape") closeAboutModal();
    };
    overlay.dataset.keyListener = "1";
    overlay.addEventListener("keydown", onKey);
    document.addEventListener("keydown", onKey, true);
    overlay._rtlyKey = onKey;
  }

  function closeAboutModal() {
    const root = $("aboutModalRoot");
    if (!root) return;
    const overlay = root.querySelector(".rtly-about-overlay");
    if (!overlay) return;
    if (overlay._rtlyKey) document.removeEventListener("keydown", overlay._rtlyKey, true);
    overlay.remove();
  }

  // ── Support nudge (monthly, in-popup) ──────────────────────────────
  const COFFEE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8h1a4 4 0 010 8h-1"></path><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"></path><path d="M6 1v3M10 1v3M14 1v3"></path></svg>';
  const STAR_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7L12 2z"></path></svg>';
  const X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"></path></svg>';

  function dismissNudge(node) {
    if (!node) return;
    node.classList.add("rtly-nudge--leaving");
    setTimeout(() => node.remove(), 340);
  }

  function renderNudgeBanner(mount) {
    const slim = NUDGE.variant === "slim";
    const card = el("section", { class: "rtly-nudge" + (slim ? " rtly-nudge--slim" : ""), role: "region", "aria-label": t("nudgeTitle") });

    const x = el("button", { class: "rtly-nudge__x", type: "button", "aria-label": t("closeAria"), html: X_SVG });
    x.addEventListener("click", () => dismissNudge(card));

    const badge = el("span", { class: "rtly-nudge__badge", "aria-hidden": "true", html: COFFEE_SVG });
    const strip = el("div", { class: "rtly-nudge__strip" });
    const top = el("div", { class: "rtly-nudge__top" }, badge, el("span", { class: "rtly-nudge__title" }, t("nudgeTitle")));
    const slimText = el("span", { class: "rtly-nudge__slimtext" }, t("nudgeSlimText"));
    strip.append(top, slimText);

    const copy = el("p", { class: "rtly-nudge__copy" }, t("nudgeCopy"));

    const coffee = el("button", { class: "rtly-nudge__coffee", type: "button" });
    setSvg(coffee, COFFEE_SVG);
    coffee.appendChild(el("span", {}, t("aboutSupportCta")));
    coffee.addEventListener("click", () => { openTab(SUPPORT_URL); dismissNudge(card); });

    const rate = el("button", { class: "rtly-nudge__rate", type: "button" });
    setSvg(rate, STAR_SVG);
    rate.appendChild(el("span", {}, t("footerRateCta")));
    rate.addEventListener("click", () => { const u = nudgeStoreUrl(); if (u) openTab(u); dismissNudge(card); });

    const later = el("button", { class: "rtly-nudge__later", type: "button" }, t("nudgeLater"));
    later.addEventListener("click", () => dismissNudge(card));

    const actions = el("div", { class: "rtly-nudge__actions" }, coffee, rate, later);

    card.append(x, strip, copy, actions);
    mount.appendChild(card);
  }

  // Decide whether to show the nudge this open. Showing it (a) advances the
  // monthly timer and (b) clears the toolbar badge, so it won't reappear until
  // the next interval. If state is missing (fresh install / upgrade), seed
  // installedAt = now so the user gets the full grace period rather than an
  // instant nudge.
  async function maybeRenderSupportNudge() {
    const mount = $("supportNudgeMount");
    if (!mount) return;
    const now = Date.now();
    const store = await getStorage(["supportNudge"]);
    let nudge = store.supportNudge;
    if (!nudge || typeof nudge !== "object") {
      await setStorage({ supportNudge: { installedAt: now } });
      return;
    }
    if (!nudgeIsDue(nudge, now)) return;

    nudge.lastShownAt = now;
    nudge.shownCount = (nudge.shownCount || 0) + 1;
    await setStorage({ supportNudge: nudge });
    try { chrome?.action?.setBadgeText?.({ text: "" }); } catch (_) {}

    renderNudgeBanner(mount);
  }

  // ── Boot ──────────────────────────────────────────────────────────
  const State = {
    currentSite: null,
    siteSettings: {},
    siteModes: {},
    pinnedSites: {},
    fontScale: 100,
    theme: "system",
    colorPalette: "teal",
  };

  let footerInstance = null;

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      if (window.RTLY_I18N) await window.RTLY_I18N.init();

      const [storage, currentSite] = await Promise.all([
        getStorage(["siteSettings", "siteModes", "pinnedSites", "fontScale", "theme", "colorPalette"]),
        resolveCurrentSite(),
      ]);
      State.siteSettings = canonicalizeLegacyKeys(storage.siteSettings || {});
      State.siteModes = canonicalizeLegacyKeys(storage.siteModes || {});
      State.pinnedSites = storage.pinnedSites || {};
      State.fontScale = typeof storage.fontScale === "number" ? storage.fontScale : 100;
      State.theme = storage.theme || "system";
      State.colorPalette = PALETTES.includes(storage.colorPalette) ? storage.colorPalette : "teal";
      State.currentSite = currentSite;

      // Apply theme + palette BEFORE first paint so the popup doesn't flash.
      applyTheme(State.theme);
      applyPalette(State.colorPalette);

      // Version stamp
      const manifest = chrome?.runtime?.getManifest?.();
      if (manifest?.version) $("popupVersion").textContent = "v" + manifest.version;

      // Render
      renderHero(State.currentSite, State);
      renderSitesList(State.currentSite, State);

      // Listeners (note: font +/- buttons are bound per-render inside
      // renderHero since they live inside the dynamically-built hero card).
      $("supportBtn").addEventListener("click", () => openTab(SUPPORT_URL));
      $("overflowBtn").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleOverflowMenu();
      });

      // Mount dynamic footer
      const footerMount = $("footerMount");
      if (footerMount && window.RTLY_FOOTER?.create) {
        footerInstance = window.RTLY_FOOTER.create({
          root: footerMount,
          t,
          openUrl: openTab,
        });
        footerInstance.start();
      }

      // Support nudge — shown at most monthly (see NUDGE config). Safe to call
      // unconditionally; it no-ops unless the monthly interval has elapsed.
      maybeRenderSupportNudge();

      // React to OS theme when "system"
      try {
        window.matchMedia?.("(prefers-color-scheme: dark)")
          .addEventListener?.("change", () => { if (State.theme === "system") applyTheme("system"); });
      } catch (_) {}

      // 1.8.6: single consolidated storage listener — earlier versions
      // registered two `chrome.storage.onChanged` handlers, one for locale
      // and one for settings, doubling the cost of every storage event.
      try {
        chrome?.storage?.onChanged?.addListener?.((changes, area) => {
          if (area !== "local") return;

          if (changes.uiLocale && footerInstance) {
            // i18n.js will have applied the new locale by now via its own listener.
            footerInstance.refreshLocale();
          }

          let touched = false;
          if (changes.siteSettings) { State.siteSettings = canonicalizeLegacyKeys(changes.siteSettings.newValue || {}); touched = true; }
          if (changes.siteModes) { State.siteModes = canonicalizeLegacyKeys(changes.siteModes.newValue || {}); touched = true; }
          if (changes.pinnedSites) { State.pinnedSites = changes.pinnedSites.newValue || {}; touched = true; }
          if (changes.fontScale) {
            State.fontScale = typeof changes.fontScale.newValue === "number" ? changes.fontScale.newValue : 100;
            const valueEl = document.getElementById("fontScaleValue");
            if (valueEl) valueEl.textContent = State.fontScale + "%";
            updateFontScaleButtons();
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
              // Refresh open overflow menu so the active swatch reflects new value
              const menu = $("overflowMenu");
              if (menu && !menu.hidden) renderOverflowMenuBody();
            }
          }
          if (touched) {
            renderHero(State.currentSite, State);
            renderSitesList(State.currentSite, State);
          }
        });
      } catch (_) {}
    } catch (err) {
      console.error("RTLY: popup init error", err);
    }
  });

  window.addEventListener("pagehide", () => {
    if (footerInstance) {
      try { footerInstance.stop(); } catch (_) {}
      footerInstance = null;
    }
    detachMenuDismissHandlers();
  });
})();
