// Shared helpers for unit tests: load extension scripts into node:vm sandboxes.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXT = path.join(ROOT, 'extension');
export const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');
export const readJson = (rel) => JSON.parse(read(rel));

/** Tiny DOM stub: only what content.js touches at module scope in test mode. */
function makeDocument() {
  const el = () => ({
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, appendChild() {}, addEventListener() {},
  });
  return {
    documentElement: el(), body: el(), head: el(),
    readyState: 'complete',
    addEventListener() {}, createElement: el,
    querySelector: () => null, querySelectorAll: () => [],
  };
}

/**
 * Load content/sites/<site files> then content/content.js with the test hook on.
 * @param {string} hostname  location.hostname to emulate
 * @param {string[]} siteFiles  e.g. ['content/sites/chatgpt.js']; default: all site configs
 */
export function loadContent(hostname = 'chatgpt.com', siteFiles = null) {
  const files = siteFiles ?? fs.readdirSync(path.join(EXT, 'content/sites'))
    .filter((f) => f.endsWith('.js')).map((f) => `content/sites/${f}`);
  const window = { __RTLY_TEST__: true, addEventListener() {}, RTLY_SITE_CONFIG: undefined };
  const sandbox = {
    window, document: makeDocument(),
    location: { hostname, href: `https://${hostname}/` },
    chrome: { runtime: { getManifest: () => ({ version: 'test' }), id: 'test' } },
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (f) => f(),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of [...files, 'content/content.js']) {
    vm.runInContext(read(f), sandbox, { filename: f });
  }
  if (!window.__RTLY_TEST_API__) throw new Error('test API not exposed by content.js');
  return { api: window.__RTLY_TEST_API__, window, sandbox };
}

/** Load background/service-worker.js with a recording chrome stub. */
export function loadServiceWorker() {
  const listeners = {};
  const ev = (name) => ({ addListener: (fn) => { (listeners[name] ||= []).push(fn); } });
  const calls = { storageSet: [], reload: [], queries: [] };
  const store = {};
  const chrome = {
    runtime: { id: 'self-id', lastError: undefined, onInstalled: ev('onInstalled'), onStartup: ev('onStartup'), onMessage: ev('onMessage') },
    contextMenus: { onClicked: ev('menuClicked'), removeAll: (cb) => cb && cb(), create: (_o, cb) => cb && cb() },
    commands: { onCommand: ev('onCommand') },
    i18n: { getMessage: () => '' },
    storage: {
      local: {
        get: (_k, cb) => cb({ siteSettings: store.siteSettings }),
        set: (o, cb) => { Object.assign(store, o); calls.storageSet.push(o); cb && cb(); },
      },
      onChanged: ev('storageChanged'),
    },
    tabs: {
      query: (q, cb) => { calls.queries.push(q.url); cb([]); },
      reload: (id, cb) => { calls.reload.push(id); cb && cb(); },
      onActivated: ev('tabsActivated'), onUpdated: ev('tabsUpdated'),
    },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {}, setBadgeTextColor() {} },
    windows: { onFocusChanged: ev('winFocus') },
  };
  const sandbox = { chrome, console: { ...console, debug() {}, error() {} }, URL, Date, Set, Object, Array };
  vm.createContext(sandbox);
  // Top-level const/function declarations are script-scoped, not globals;
  // append an export shim that runs in the same script scope.
  const src = read('background/service-worker.js') +
    '\n;globalThis.__SW__ = { HOST_TO_SITE, ALLOWED_SITE_IDS, getSiteFromUrl, canonicalizeSettings, applyToggleToSettings, nudgeIsDue };';
  vm.runInContext(src, sandbox, { filename: 'service-worker.js' });
  return { sw: sandbox.__SW__, chrome, listeners, store, calls };
}

/** Load shared/i18n.js and return its internal catalog (M) via a source shim. */
export function loadI18n() {
  const window = {};
  const sandbox = {
    window, document: { documentElement: { setAttribute() {} }, querySelectorAll: () => [] },
    chrome: undefined, navigator: { language: 'en' }, console,
  };
  vm.createContext(sandbox);
  const src = read('shared/i18n.js').replace('window.RTLY_I18N = {', 'window.__CATALOG__ = M; window.RTLY_I18N = {');
  if (!src.includes('__CATALOG__')) throw new Error('i18n.js shape changed: could not locate RTLY_I18N export');
  vm.runInContext(src, sandbox, { filename: 'i18n.js' });
  return { catalog: window.__CATALOG__, i18n: window.RTLY_I18N };
}

/** Extract the `const SITES = [ { id: "..." }, ... ]` id list from a page script. */
export function extractSiteIds(rel) {
  const src = read(rel);
  const m = src.match(/const SITES = \[([\s\S]*?)\n\s*\];/);
  if (!m) throw new Error(`SITES array not found in ${rel}`);
  return [...m[1].matchAll(/id:\s*"([^"]+)"/g)].map((x) => x[1]);
}
