/* RTLY — dynamic rotating footer
 *
 * Renders a panel + nav strip with auto-rotation and a progress indicator.
 * Reads window.FOOTER_NAV_CONFIG (set by footerConfig.js) or falls back to
 * a built-in default. Hover, focus-in, or manual tab clicks pause rotation;
 * removing focus/hover resumes it. Pre-existing i18n is honored via the
 * supplied `t()` resolver.
 *
 * Public API:
 *   const footer = createRtlyFooter({ root, t, openUrl });
 *   footer.start();            // mount + begin rotation
 *   footer.stop();             // cancel animation frame
 *   footer.refreshLocale();    // re-pull text after a locale change
 *
 * Loaded as a classic <script> after i18n.js in popup.html / options.html.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || window.RTLY_FOOTER) return;

  const DEFAULT_FOOTER_NAV_CONFIG = {
    autoRotate: true,
    rotateEveryMs: 5000,
    items: [
      { id: "about",   labelKey: "footerNavAbout",   messageKey: "footerAboutCopy",   ctaLabelKey: "footerAboutCta",   showCtaButton: true, url: "https://www.enaloo.com", action: "link" },
      { id: "github",  labelKey: "footerNavGithub",  messageKey: "footerGithubCopy",  ctaLabelKey: "footerGithubCta",  showCtaButton: true, url: "https://github.com/ehsanenaloo/RTLY", action: "link" },
      { id: "rate",    labelKey: "footerNavRate",    messageKey: "footerRateCopy",    ctaLabelKey: "footerRateCta",    showCtaButton: true, url: "", action: "link" },
      { id: "support", labelKey: "footerNavSupport", messageKey: "footerSupportCopy", ctaLabelKey: "footerSupportCta", showCtaButton: true, url: "https://buymeacoffee.com/enaloo", action: "link" }
    ]
  };

  function getStoreReviewUrl() {
    if (/firefox/i.test(navigator.userAgent)) return "https://github.com/ehsanenaloo/RTLY";
    return "https://chromewebstore.google.com/detail/hhifipkafndnildgldggiohfkbpikmkd/reviews";
  }

  function resolveConfig() {
    const raw = (typeof window.FOOTER_NAV_CONFIG === "object" && window.FOOTER_NAV_CONFIG)
      ? window.FOOTER_NAV_CONFIG
      : DEFAULT_FOOTER_NAV_CONFIG;
    const items = Array.isArray(raw.items) && raw.items.length ? raw.items : DEFAULT_FOOTER_NAV_CONFIG.items;
    return {
      autoRotate: raw.autoRotate !== false,
      rotateEveryMs: Math.max(1500, Number(raw.rotateEveryMs) || 5000),
      items: items.map((it, idx) => ({
        id: it.id || `item-${idx + 1}`,
        labelKey: it.labelKey || it.label || "",
        messageKey: it.messageKey || it.message || "",
        ctaLabelKey: it.ctaLabelKey || it.ctaLabel || "",
        showCtaButton: it.showCtaButton !== false,
        url: it.id === "rate" ? (it.url || getStoreReviewUrl()) : (it.url || ""),
        action: it.action || "info"
      }))
    };
  }

  // Resolve a key OR literal through i18n.
  function localize(t, value) {
    const s = String(value || "").trim();
    if (!s) return "";
    // Heuristic: a short identifier-like string is treated as an i18n key.
    if (/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(s)) {
      const out = t(s, s);
      // If t() returned the bare key, treat the original as a literal fallback.
      return out === s ? s : out;
    }
    return s;
  }

  function createRtlyFooter(opts) {
    const root = opts.root;
    const t = opts.t || ((k) => k);
    const openUrl = opts.openUrl || ((u) => {
      if (!u) return;
      try { chrome?.tabs?.create?.({ url: u, active: true }); }
      catch (_) { window.open(u, "_blank", "noopener,noreferrer"); }
    });

    let cfg = resolveConfig();
    let activeId = cfg.items[0]?.id || "";
    let progress = 0;
    let raf = null;
    let cycleStart = null;
    let hoverPaused = false;
    let cleanupHandlers = [];

    let refs = { shell: null, message: null, controls: null, nav: null, activeLine: null, progressLine: null };

    function getActive() {
      return cfg.items.find((it) => it.id === activeId) || cfg.items[0];
    }

    function actionFor(item) {
      if (!item) return null;
      if (item.action === "link") {
        return () => {
          if (item.url) openUrl(item.url);
        };
      }
      return null;
    }

    function positionIndicator() {
      if (!refs.nav) return;
      const activeBtn = refs.nav.querySelector(".rtly-footer-nav-item.is-active");
      if (!activeBtn || !refs.activeLine || !refs.progressLine) return;
      const navRect = refs.nav.getBoundingClientRect();
      const itemRect = activeBtn.getBoundingClientRect();
      const left = Math.max(0, itemRect.left - navRect.left + 8);
      const width = Math.max(18, itemRect.width - 16);
      refs.activeLine.style.left = `${left}px`;
      refs.activeLine.style.width = `${width}px`;
      refs.progressLine.style.left = `${left}px`;
      refs.progressLine.style.width = `${width}px`;
      refs.progressLine.style.transform = `scaleX(${progress})`;
    }

    function updatePanel() {
      const item = getActive();
      if (!item) return;

      // Render: [label]  [short message]   [CTA]
      // The label is the bold active-tab name (e.g., "Rate"), the message is
      // the optional supporting copy (e.g., "Enjoying RTLY?"). Both share one
      // row with the CTA, separated visually so the row never wraps.
      refs.message.textContent = "";
      const labelText = localize(t, item.labelKey);
      const messageText = localize(t, item.messageKey);
      if (labelText) {
        const labelEl = document.createElement("span");
        labelEl.className = "rtly-footer-active-label";
        labelEl.textContent = labelText;
        refs.message.appendChild(labelEl);
      }
      if (messageText) {
        const messageEl = document.createElement("span");
        messageEl.className = "rtly-footer-active-message";
        messageEl.textContent = messageText;
        refs.message.appendChild(messageEl);
      }

      // Rebuild controls (CTA button if applicable)
      refs.controls.textContent = "";
      const ctaLabel = localize(t, item.ctaLabelKey);
      if (ctaLabel && item.showCtaButton !== false) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "rtly-footer-cta";
        btn.textContent = ctaLabel;
        const handler = actionFor(item);
        if (handler) {
          btn.addEventListener("click", handler);
        } else {
          btn.disabled = true;
          btn.classList.add("is-disabled");
        }
        refs.controls.appendChild(btn);
      }

      // Update nav active state
      refs.nav.querySelectorAll(".rtly-footer-nav-item").forEach((b) => {
        const isActive = b.dataset.footerId === item.id;
        b.classList.toggle("is-active", isActive);
        b.setAttribute("aria-selected", isActive ? "true" : "false");
        b.setAttribute("tabindex", isActive ? "0" : "-1");
      });

      requestAnimationFrame(positionIndicator);
    }

    function tick(now) {
      if (!cfg.autoRotate || hoverPaused) {
        raf = null;
        return;
      }
      if (!cycleStart) cycleStart = now;
      const elapsed = now - cycleStart;
      progress = Math.max(0, Math.min(1, elapsed / cfg.rotateEveryMs));
      if (refs.progressLine) refs.progressLine.style.transform = `scaleX(${progress})`;
      if (progress >= 1) {
        const idx = cfg.items.findIndex((it) => it.id === activeId);
        const next = (idx + 1) % cfg.items.length;
        activeId = cfg.items[next].id;
        cycleStart = now;
        progress = 0;
        updatePanel();
      }
      raf = requestAnimationFrame(tick);
    }

    function ensureLoop() {
      if (!cfg.autoRotate || hoverPaused) return;
      if (raf) return;
      cycleStart = performance.now() - (progress * cfg.rotateEveryMs);
      raf = requestAnimationFrame(tick);
    }

    function pause() {
      hoverPaused = true;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }

    function resume() {
      hoverPaused = false;
      ensureLoop();
    }

    function render() {
      // Clear root and build DOM
      root.textContent = "";
      const shell = document.createElement("div");
      shell.className = "rtly-footer-shell";

      const panel = document.createElement("div");
      panel.className = "rtly-footer-panel";
      const top = document.createElement("div");
      top.className = "rtly-footer-panel-top";
      const message = document.createElement("div");
      message.className = "rtly-footer-message";
      const controls = document.createElement("div");
      controls.className = "rtly-footer-controls";
      top.appendChild(message);
      top.appendChild(controls);
      panel.appendChild(top);

      const nav = document.createElement("div");
      nav.className = "rtly-footer-nav";
      nav.setAttribute("role", "tablist");
      nav.style.gridTemplateColumns = `repeat(${Math.max(1, cfg.items.length)}, minmax(0, 1fr))`;
      const activeLine = document.createElement("div");
      activeLine.className = "rtly-footer-nav-active";
      const progressLine = document.createElement("div");
      progressLine.className = "rtly-footer-nav-progress";
      nav.appendChild(activeLine);
      nav.appendChild(progressLine);

      cfg.items.forEach((item) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "rtly-footer-nav-item";
        btn.dataset.footerId = item.id;
        btn.setAttribute("role", "tab");
        const label = localize(t, item.labelKey);
        btn.title = label;
        btn.setAttribute("aria-label", label);
        const labelSpan = document.createElement("span");
        labelSpan.className = "rtly-footer-nav-label";
        labelSpan.textContent = label;
        btn.appendChild(labelSpan);
        btn.addEventListener("click", () => {
          activeId = item.id;
          progress = 0;
          cycleStart = performance.now();
          updatePanel();
          ensureLoop();
        });
        nav.appendChild(btn);
      });

      // Hover/focus pause
      const onEnter = () => pause();
      const onLeave = () => resume();
      const onFocusIn = () => pause();
      const onFocusOut = (e) => { if (!shell.contains(e.relatedTarget)) resume(); };
      shell.addEventListener("mouseenter", onEnter);
      shell.addEventListener("mouseleave", onLeave);
      shell.addEventListener("focusin", onFocusIn);
      shell.addEventListener("focusout", onFocusOut);
      cleanupHandlers.push(() => {
        shell.removeEventListener("mouseenter", onEnter);
        shell.removeEventListener("mouseleave", onLeave);
        shell.removeEventListener("focusin", onFocusIn);
        shell.removeEventListener("focusout", onFocusOut);
      });

      shell.appendChild(panel);
      shell.appendChild(nav);
      root.appendChild(shell);

      refs.shell = shell;
      refs.message = message;
      refs.controls = controls;
      refs.nav = nav;
      refs.activeLine = activeLine;
      refs.progressLine = progressLine;

      updatePanel();
    }

    function start() {
      cfg = resolveConfig();
      if (!cfg.items.length) return;
      if (!cfg.items.find((it) => it.id === activeId)) activeId = cfg.items[0].id;
      render();
      ensureLoop();
      // Reposition on resize
      const onResize = () => positionIndicator();
      window.addEventListener("resize", onResize);
      cleanupHandlers.push(() => window.removeEventListener("resize", onResize));
    }

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      cleanupHandlers.forEach((fn) => { try { fn(); } catch (_) {} });
      cleanupHandlers = [];
    }

    function refreshLocale() {
      if (!refs.shell) return;
      // Re-label tabs
      refs.nav.querySelectorAll(".rtly-footer-nav-item").forEach((b) => {
        const id = b.dataset.footerId;
        const item = cfg.items.find((it) => it.id === id);
        if (!item) return;
        const label = localize(t, item.labelKey);
        b.title = label;
        b.setAttribute("aria-label", label);
        const span = b.querySelector(".rtly-footer-nav-label");
        if (span) span.textContent = label;
      });
      updatePanel();
    }

    return { start, stop, refreshLocale };
  }

  window.RTLY_FOOTER = { create: createRtlyFooter };
})();
