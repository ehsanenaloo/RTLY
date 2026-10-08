"use strict";
/*
 * Progressive enhancement only. Every page is complete without this file.
 * It adds the theme switch, guide search, guide-card filtering, a highlighted
 * table of contents and a note where a screenshot file is missing.
 */
(function () {
  var root = document.documentElement;
  var base = root.getAttribute("data-root") || "./";
  var isFa = root.getAttribute("lang") === "fa";

  function safeGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function safeSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* storage may be blocked */ } }

  /* ---------- Theme ---------- */
  var themeButton = document.querySelector("[data-theme-toggle]");
  function effectiveTheme() {
    var set = root.getAttribute("data-theme");
    if (set === "light" || set === "dark") return set;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function paintThemeButton() {
    if (!themeButton) return;
    var next = effectiveTheme() === "dark" ? "light" : "dark";
    if (isFa) {
      themeButton.textContent = next === "dark" ? "پوستهٔ تیره" : "پوستهٔ روشن";
      themeButton.setAttribute("aria-label", next === "dark" ? "تغییر به پوستهٔ تیره" : "تغییر به پوستهٔ روشن");
    } else {
      themeButton.textContent = next === "dark" ? "Dark mode" : "Light mode";
      themeButton.setAttribute("aria-label", "Switch to " + next + " theme");
    }
  }
  if (themeButton) {
    themeButton.hidden = false;
    paintThemeButton();
    themeButton.addEventListener("click", function () {
      var next = effectiveTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      safeSet("rtly-docs-theme", next);
      paintThemeButton();
    });
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", paintThemeButton);
    }
  }

  /* ---------- Sidebar: collapse on small screens ---------- */
  var sideDetails = document.querySelector(".sidebar details");
  if (sideDetails && window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
    sideDetails.removeAttribute("open");
  }

  /* ---------- Missing screenshots ---------- */
  Array.prototype.forEach.call(document.querySelectorAll(".shot img"), function (img) {
    img.addEventListener("error", function () {
      var note = document.createElement("div");
      note.className = "missing";
      note.textContent = (isFa ? "تصویر در دسترس نیست: " : "Screenshot not available: ") + (img.getAttribute("data-file") || img.getAttribute("src"));
      if (img.parentNode) img.parentNode.replaceChild(note, img);
    });
  });

  /* ---------- Guide search (English pages) ---------- */
  var searchHost = document.querySelector("[data-search-host]");
  if (searchHost) {
    var script = document.createElement("script");
    script.src = base + "search-index.js";
    script.defer = true;
    document.head.appendChild(script);

    var box = document.createElement("div");
    box.className = "search-box";
    var input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Search the guide";
    input.setAttribute("aria-label", "Search the guide");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-controls", "search-results");
    var results = document.createElement("div");
    results.className = "search-results";
    results.id = "search-results";
    results.hidden = true;
    box.appendChild(input);
    box.appendChild(results);
    searchHost.appendChild(box);

    var active = -1;
    var links = [];
    var score = function (entry, terms) {
      var total = 0;
      for (var i = 0; i < terms.length; i++) {
        var term = terms[i];
        var hit = 0;
        if (entry.t.toLowerCase().indexOf(term) !== -1) hit += 10;
        if (entry.d.toLowerCase().indexOf(term) !== -1) hit += 5;
        if (entry.h.join(" ").toLowerCase().indexOf(term) !== -1) hit += 4;
        if (entry.x.toLowerCase().indexOf(term) !== -1) hit += 1;
        if (!hit) return 0;
        total += hit;
      }
      return total;
    };
    var render = function (query) {
      results.textContent = "";
      links = [];
      active = -1;
      var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) { results.hidden = true; return; }
      var entries = window.RTLY_DOCS || [];
      var ranked = entries
        .map(function (e) { return { e: e, s: score(e, terms) }; })
        .filter(function (r) { return r.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 8);
      if (!ranked.length) {
        var none = document.createElement("div");
        none.className = "none";
        none.textContent = "No pages match.";
        results.appendChild(none);
      }
      ranked.forEach(function (r) {
        var a = document.createElement("a");
        a.href = base + r.e.u;
        var strong = document.createElement("strong");
        strong.textContent = r.e.t;
        var span = document.createElement("span");
        span.textContent = r.e.d;
        a.appendChild(strong);
        a.appendChild(span);
        results.appendChild(a);
        links.push(a);
      });
      results.hidden = false;
    };
    input.addEventListener("input", function () { render(input.value); });
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { results.hidden = true; input.blur(); return; }
      if (!links.length) return;
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (active >= 0) links[active].classList.remove("is-active");
        active = ev.key === "ArrowDown" ? (active + 1) % links.length : (active <= 0 ? links.length - 1 : active - 1);
        links[active].classList.add("is-active");
        links[active].scrollIntoView({ block: "nearest" });
      } else if (ev.key === "Enter" && active >= 0) {
        ev.preventDefault();
        window.location.href = links[active].href;
      }
    });
    document.addEventListener("click", function (ev) {
      if (!box.contains(ev.target)) results.hidden = true;
    });
  }

  /* ---------- Guide card filter (guide library page) ---------- */
  var filterInput = document.querySelector("[data-guide-filter]");
  if (filterInput) {
    var cards = Array.prototype.slice.call(document.querySelectorAll("[data-guide-card]"));
    var status = document.querySelector("[data-filter-status]");
    filterInput.addEventListener("input", function () {
      var q = filterInput.value.toLowerCase().trim();
      var shown = 0;
      cards.forEach(function (c) {
        var match = !q || c.textContent.toLowerCase().indexOf(q) !== -1;
        c.hidden = !match;
        if (match) shown++;
      });
      if (status) status.textContent = q ? shown + " of " + cards.length + " guides shown" : "";
    });
  }

  /* ---------- Table of contents highlight ---------- */
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
  if (tocLinks.length && "IntersectionObserver" in window) {
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { seen[en.target.id] = en.isIntersecting; });
      var current = null;
      tocLinks.forEach(function (a) {
        var id = a.getAttribute("href").slice(1);
        if (seen[id] && !current) current = a;
      });
      if (current) {
        tocLinks.forEach(function (a) { a.classList.toggle("is-current", a === current); });
      }
    }, { rootMargin: "-80px 0px -65% 0px" });
    Object.keys(map).forEach(function (id) {
      var h = document.getElementById(id);
      if (h) io.observe(h);
    });
  }
})();
