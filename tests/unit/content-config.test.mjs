import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, readJson } from '../helpers/load.mjs';

const manifest = readJson('manifest.json');
const { api } = loadContent('chatgpt.com');
const { TARGET_DOMAINS, CANONICAL, CONFIG } = api;

const manifestHosts = [...new Set(manifest.content_scripts.flatMap((cs) =>
  cs.matches.map((m) => new URL(m.replace('/*', '/')).hostname)))];

const covered = (host) => TARGET_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
const siteKeyFor = (host) => TARGET_DOMAINS.find((d) => host === d || host.endsWith('.' + d));

describe('TARGET_DOMAINS / CANONICAL', () => {
  test('no duplicate TARGET_DOMAINS entries', () => {
    assert.equal(new Set(TARGET_DOMAINS).size, TARGET_DOMAINS.length);
  });
  test('every manifest content_scripts host is covered by TARGET_DOMAINS', () => {
    const missing = manifestHosts.filter((h) => !covered(h));
    assert.deepEqual([...missing], []);
  });
  test('every TARGET_DOMAINS entry is reachable from a manifest match', () => {
    const unreachable = TARGET_DOMAINS.filter((d) => !manifestHosts.some((h) => h === d || h.endsWith('.' + d)));
    assert.deepEqual([...unreachable], []);
  });
  test('every manifest host resolves to a site key with a per-site config', () => {
    for (const h of manifestHosts) {
      const key = siteKeyFor(h);
      assert.ok(CONFIG.SITES[key], `no CONFIG.SITES entry for ${h} (siteKey ${key})`);
    }
  });
  test('CANONICAL maps only onto known domains, never to itself or chains', () => {
    for (const [from, to] of Object.entries(CANONICAL)) {
      assert.notEqual(from, to);
      assert.ok(!(to in CANONICAL), `CANONICAL chain ${from} -> ${to} -> ${CANONICAL[to]}`);
      assert.ok(covered(to), `CANONICAL target ${to} is not a supported domain`);
    }
  });
  test('legacy chat.openai.com canonicalises to chatgpt.com', () => {
    assert.equal(CANONICAL['chat.openai.com'], 'chatgpt.com');
  });
});

describe('domain gate (loaded per hostname)', () => {
  const cases = [
    ['chatgpt.com', 'chatgpt.com'],
    ['claude.ai', 'claude.ai'],
    ['chat.openai.com', 'chat.openai.com'],
    ['chat.qwen.ai', 'qwen.ai'],
    ['chat.mistral.ai', 'mistral.ai'],
    ['coral.cohere.com', 'cohere.com'],
    ['www.bing.com', 'bing.com'],
    ['claude.ai.attacker.com', undefined],
    ['notclaude.ai', undefined],
    ['example.com', undefined],
  ];
  for (const [host, expected] of cases) {
    test(`${host} -> ${expected}`, () => {
      const { api: a } = loadContent(host);
      assert.equal(a.siteKey, expected);
    });
  }
});

describe('per-site configs (content/sites/*.js)', () => {
  test('every config has non-empty inputs/responses string arrays', () => {
    for (const [key, cfg] of Object.entries(CONFIG.SITES)) {
      for (const field of ['inputs', 'responses']) {
        assert.ok(Array.isArray(cfg[field]) && cfg[field].length > 0, `${key}.${field}`);
        for (const s of cfg[field]) assert.equal(typeof s, 'string', `${key}.${field}`);
      }
    }
  });
  test('flag names are from the documented set', () => {
    const allowed = new Set(['inputs', 'responses', 'layoutLtr', 'heuristicFaScan', 'narrowIcons', 'cleanupStaleMark', 'comprehensiveSelectors']);
    for (const [key, cfg] of Object.entries(CONFIG.SITES)) {
      for (const k of Object.keys(cfg)) assert.ok(allowed.has(k), `${key} has unknown field ${k}`);
    }
  });
  test('every site key in a config is a TARGET_DOMAIN or its alias', () => {
    for (const key of Object.keys(CONFIG.SITES)) {
      assert.ok(TARGET_DOMAINS.includes(key) || key in CANONICAL, `config for unsupported host ${key}`);
    }
  });
  test('BODY_CLASS_MAP covers every TARGET_DOMAINS entry', () => {
    for (const d of TARGET_DOMAINS) assert.ok(api.BODY_CLASS_MAP[d], `no body class for ${d}`);
  });
  test('every manifest content script css/js file is loaded for hosts matching its site config', () => {
    for (const cs of manifest.content_scripts) {
      const hosts = cs.matches.map((m) => new URL(m.replace('/*', '/')).hostname);
      for (const h of hosts) assert.ok(covered(h), h);
      assert.ok(cs.js.includes('content/content.js'));
      assert.equal(cs.js.at(-1), 'content/content.js', 'content.js must load after the site config');
    }
  });
});

describe('isInSidebarOrMenu (fake-element unit checks)', () => {
  // Minimal element double: closest(sel) answers from a table of substring -> result.
  const fake = (table) => ({
    closest: (sel) => { for (const [needle, res] of table) if (sel.includes(needle)) return res; return null; },
    innerText: '', textContent: '',
  });
  test('null element is not a sidebar', () => assert.equal(api.isInSidebarOrMenu(null), false));
  test('composer (textarea/contenteditable subtree) is never a sidebar even inside nav', () => {
    const el = fake([['textarea', {}], ['nav', {}]]);
    assert.equal(api.isInSidebarOrMenu(el), false);
  });
  test('element inside nav is a sidebar', () => {
    const navAncestor = { closest: () => null };
    const el = fake([['nav', navAncestor]]);
    assert.equal(api.isInSidebarOrMenu(el), true);
  });
  test('nav ancestor nested inside a chat message does not count as sidebar', () => {
    const navAncestor = { closest: () => ({}) };
    const el = fake([['nav', navAncestor]]);
    assert.equal(api.isInSidebarOrMenu(el), false);
  });
  test('element with no sidebar ancestor is not a sidebar', () => {
    assert.equal(api.isInSidebarOrMenu(fake([])), false);
  });
});
