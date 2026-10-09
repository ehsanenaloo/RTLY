#!/usr/bin/env node
// Static repo validation for RTLY. Exits non-zero on any failure.
//   node scripts/validate.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');

const failures = [];
let passed = 0;
function check(name, fn) {
  try {
    const problems = fn() || [];
    if (problems.length) {
      failures.push({ name, problems });
      console.log(`FAIL  ${name}`);
      for (const p of problems) console.log(`        - ${p}`);
    } else {
      passed++;
      console.log(`ok    ${name}`);
    }
  } catch (e) {
    failures.push({ name, problems: [`check crashed: ${e.message}`] });
    console.log(`FAIL  ${name}\n        - check crashed: ${e.message}`);
  }
}

function walk(dir, filter = () => true, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const extFile = (r) => path.join(EXT, r);

// Remove comments crudely but safely enough for pattern scanning (keeps strings).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(^|[^:'"`\\])\s\/\/\s.*$/gm, '$1');
}

// ---------------------------------------------------------------- manifest
let manifest;
check('manifest.json parses', () => {
  manifest = JSON.parse(fs.readFileSync(extFile('manifest.json'), 'utf8'));
  const p = [];
  if (manifest.manifest_version !== 3) p.push(`manifest_version must be 3, got ${manifest.manifest_version}`);
  for (const f of ['name', 'version', 'description', 'default_locale']) if (!manifest[f]) p.push(`missing "${f}"`);
  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version || '')) p.push(`invalid version "${manifest.version}"`);
  return p;
});
if (!manifest) { console.log('\nCannot continue without a valid manifest.'); process.exit(1); }

check('manifest has no "key" or "update_url"', () =>
  ['key', 'update_url'].filter((k) => k in manifest).map((k) => `manifest contains "${k}" (must not ship in store builds)`));

check('every file referenced by manifest exists', () => {
  const refs = new Set();
  const add = (v) => { if (typeof v === 'string' && v) refs.add(v); };
  Object.values(manifest.icons || {}).forEach(add);
  Object.values(manifest.action?.default_icon || {}).forEach(add);
  add(manifest.action?.default_popup);
  add(manifest.background?.service_worker);
  add(manifest.options_ui?.page);
  add(manifest.options_page);
  for (const cs of manifest.content_scripts || []) { (cs.js || []).forEach(add); (cs.css || []).forEach(add); }
  for (const war of manifest.web_accessible_resources || []) (war.resources || []).forEach(add);
  const p = [];
  for (const r of refs) if (!fs.existsSync(extFile(r))) p.push(`missing: extension/${r}`);
  return p;
});

check('default_locale and __MSG_*__ references resolve', () => {
  const p = [];
  const msgs = path.join(EXT, '_locales', manifest.default_locale, 'messages.json');
  if (!fs.existsSync(msgs)) return [`_locales/${manifest.default_locale}/messages.json missing`];
  const en = JSON.parse(fs.readFileSync(msgs, 'utf8'));
  const raw = fs.readFileSync(extFile('manifest.json'), 'utf8');
  for (const m of raw.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) if (!(m[1] in en)) p.push(`__MSG_${m[1]}__ not in en messages.json`);
  return p;
});

const KNOWN_PERMISSIONS = new Set([
  'activeTab', 'alarms', 'background', 'bookmarks', 'browsingData', 'clipboardRead', 'clipboardWrite', 'contentSettings',
  'contextMenus', 'cookies', 'debugger', 'declarativeContent', 'declarativeNetRequest', 'declarativeNetRequestFeedback',
  'declarativeNetRequestWithHostAccess', 'desktopCapture', 'downloads', 'fontSettings', 'gcm', 'geolocation', 'history',
  'identity', 'idle', 'management', 'nativeMessaging', 'notifications', 'offscreen', 'pageCapture', 'power', 'printing',
  'privacy', 'proxy', 'scripting', 'search', 'sessions', 'sidePanel', 'storage', 'system.cpu', 'system.display',
  'system.memory', 'system.storage', 'tabCapture', 'tabGroups', 'tabs', 'topSites', 'tts', 'ttsEngine', 'unlimitedStorage',
  'webNavigation', 'webRequest', 'webRequestBlocking',
]);
// permission -> regex that proves the code uses it
const PERMISSION_USAGE = {
  storage: /\bchrome\.storage\b/,
  contextMenus: /\bchrome\.contextMenus\b/,
  tabs: /\bchrome\.tabs\b/,
  activeTab: /\bchrome\.(tabs|scripting)\b/,
  scripting: /\bchrome\.scripting\b/,
  alarms: /\bchrome\.alarms\b/,
  notifications: /\bchrome\.notifications\b/,
  cookies: /\bchrome\.cookies\b/,
  downloads: /\bchrome\.downloads\b/,
  history: /\bchrome\.history\b/,
  webNavigation: /\bchrome\.webNavigation\b/,
  clipboardWrite: /(clipboard\.writeText|execCommand\(['"]copy)/,
  clipboardRead: /clipboard\.read/,
  identity: /\bchrome\.identity\b/,
  offscreen: /\bchrome\.offscreen\b/,
  sidePanel: /\bchrome\.sidePanel\b/,
};

const jsFiles = walk(EXT, (f) => f.endsWith('.js'));
const allJs = jsFiles.map((f) => ({ file: rel(f), src: stripComments(fs.readFileSync(f, 'utf8')) }));

check('permissions are valid and each one is used', () => {
  const p = [];
  for (const perm of manifest.permissions || []) {
    if (!KNOWN_PERMISSIONS.has(perm)) { p.push(`unknown/invalid permission "${perm}"`); continue; }
    const re = PERMISSION_USAGE[perm];
    if (!re) { p.push(`permission "${perm}" has no usage rule in validate.mjs (add one or remove the permission)`); continue; }
    if (!allJs.some((j) => re.test(j.src))) p.push(`permission "${perm}" is declared but never used in extension JS`);
  }
  const dup = (manifest.permissions || []).filter((x, i, a) => a.indexOf(x) !== i);
  if (dup.length) p.push(`duplicate permissions: ${dup.join(', ')}`);
  return p;
});

check('host_permissions are https-only, specific, and cover every content-script match', () => {
  const p = [];
  const hp = manifest.host_permissions || [];
  for (const h of hp) {
    if (!/^https:\/\/[^*/]+\/\*$/.test(h) && !/^https:\/\/[^*/]+\/[^*]+\*$/.test(h)) p.push(`broad/non-https host permission: ${h}`);
  }
  for (const cs of manifest.content_scripts || []) {
    for (const m of cs.matches) {
      const host = m.replace(/^https:\/\//, '').split('/')[0];
      if (!hp.some((h) => h.replace(/^https:\/\//, '').split('/')[0] === host)) p.push(`content script match ${m} lacks a host_permission`);
    }
  }
  return p;
});

check('manifest has no <all_urls> / wildcard-host content scripts', () => {
  const p = [];
  for (const cs of manifest.content_scripts || []) for (const m of cs.matches) {
    if (m === '<all_urls>' || /^\*:\/\//.test(m) || /\/\/\*\//.test(m) || /\/\/\*\./.test(m)) p.push(`wildcard match pattern: ${m}`);
  }
  return p;
});

// ------------------------------------------------------------ code safety
check('no remote code: eval / new Function / fetch / XMLHttpRequest / importScripts(http) in extension JS', () => {
  const p = [];
  const rules = [
    [/(^|[^.\w$])eval\s*\(/, 'eval('],
    [/\bnew\s+Function\b/, 'new Function'],
    [/(^|[^.\w$]|\b(?:window|self|globalThis)\.)fetch\s*\(/, 'fetch('],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/\bWebSocket\s*\(/, 'WebSocket('],
    [/\bsendBeacon\s*\(/, 'sendBeacon('],
    [/\bimportScripts\s*\(\s*['"`]https?:/, 'importScripts(remote)'],
    [/\bimport\s*\(\s*['"`]https?:/, 'import(remote)'],
    [/\bsetTimeout\s*\(\s*['"`]/, 'setTimeout(string)'],
    [/\bsetInterval\s*\(\s*['"`]/, 'setInterval(string)'],
  ];
  for (const { file, src } of allJs) {
    for (const [re, label] of rules) if (re.test(src)) p.push(`${file}: uses ${label}`);
  }
  return p;
});

check('JS syntax (compiled as classic scripts)', () => {
  const p = [];
  for (const f of jsFiles) {
    try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: rel(f) }); }
    catch (e) { p.push(`${rel(f)}: ${e.message}`); }
  }
  return p;
});

check('manifest.json and _locales JSON parse', () => {
  const p = [];
  for (const f of walk(EXT, (x) => x.endsWith('.json'))) {
    try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { p.push(`${rel(f)}: ${e.message}`); }
  }
  return p;
});

// ------------------------------------------------------------------ HTML/CSS
const REMOTE = /^(https?:)?\/\//i;
check('HTML: references resolve, no remote scripts/styles/frames, no inline handlers', () => {
  const p = [];
  for (const f of walk(EXT, (x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(f, 'utf8');
    const dir = path.dirname(f);
    const attrRe = /<(script|link|img|source|iframe|video|audio)\b([^>]*)>/gi;
    for (const m of html.matchAll(attrRe)) {
      const tag = m[1].toLowerCase();
      const attrs = m[2];
      const urlAttr = tag === 'link' ? /\bhref\s*=\s*["']([^"']+)["']/i : /\bsrc\s*=\s*["']([^"']+)["']/i;
      const u = attrs.match(urlAttr)?.[1];
      if (!u) continue;
      if (/^(data:|#|mailto:)/i.test(u)) continue;
      if (REMOTE.test(u)) {
        if (tag === 'script' || tag === 'iframe' || (tag === 'link' && /stylesheet|preload|modulepreload/i.test(attrs)) || tag !== 'link') {
          p.push(`${rel(f)}: remote <${tag}> ${u}`);
        }
        continue;
      }
      const target = path.resolve(dir, u.split(/[?#]/)[0]);
      if (!fs.existsSync(target)) p.push(`${rel(f)}: <${tag}> ${u} does not exist`);
    }
    if (/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html)) p.push(`${rel(f)}: inline <script> (blocked by MV3 CSP)`);
    if (/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<script[\s\S]*?<\/script>/gi, ''))) p.push(`${rel(f)}: inline event handler attribute (blocked by MV3 CSP)`);
  }
  return p;
});

check('CSS: no remote @import / url() and local url() targets exist', () => {
  const p = [];
  for (const f of walk(EXT, (x) => x.endsWith('.css'))) {
    const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) if (REMOTE.test(m[1])) p.push(`${rel(f)}: remote @import ${m[1]}`);
    for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      const u = m[1].trim();
      if (/^(data:|#|chrome-extension:|var\()/i.test(u)) continue;
      if (REMOTE.test(u)) { p.push(`${rel(f)}: remote url(${u})`); continue; }
      if (!fs.existsSync(path.resolve(path.dirname(f), u.split(/[?#]/)[0]))) p.push(`${rel(f)}: url(${u}) does not exist`);
    }
  }
  return p;
});

check('JS: no dynamically created remote <script>/<link>/<iframe> src', () => {
  const p = [];
  for (const { file, src } of allJs) {
    if (/\.(src|href)\s*=\s*['"`]https?:\/\/[^'"`]*\.(js|css)\b/i.test(src)) p.push(`${file}: assigns remote script/style URL`);
    if (/createElement\(\s*['"]script['"]\s*\)/.test(src)) p.push(`${file}: creates <script> element (review for remote code)`);
  }
  return p;
});

// --------------------------------------------------------------- repo hygiene
const ROOT_ALLOW = new Set([
  'README.md', 'LICENSE', 'CHANGELOG.md', 'package.json', '.gitignore', '.gitattributes', '.editorconfig', 'AGENTS.md',
  'extension', 'docs', 'tests', 'scripts', 'technical-docs', '.github',
  // tooling artifacts that are never published / are gitignored:
  'package-lock.json', 'node_modules', '.git', 'dist',
]);
// Development-only root files are listed (one per line) in technical-docs/dev-root-files.txt.
// That folder is not published, so the public copy of this script allows nothing extra.
try {
  for (const line of fs.readFileSync(path.join(ROOT, 'technical-docs', 'dev-root-files.txt'), 'utf8').split(/\r?\n/)) {
    if (line.trim() && !line.startsWith('#')) ROOT_ALLOW.add(line.trim());
  }
} catch { /* public tree: no technical-docs */ }
check('repo root contains only allowlisted entries', () =>
  fs.readdirSync(ROOT).filter((n) => !ROOT_ALLOW.has(n)).map((n) => `unexpected root entry: ${n}`));

check('package.json version === extension/manifest.json version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return pkg.version === manifest.version ? [] : [`package.json ${pkg.version} !== manifest ${manifest.version}`];
});

check('no stray/secret files inside extension/', () => {
  const bad = /(\.(map|zip|crx|pem|key|log|bak|orig|tmp)|\.env|Thumbs\.db|\.DS_Store|~)$/i;
  return walk(EXT, (f) => bad.test(f)).map((f) => `unexpected file: ${rel(f)}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
