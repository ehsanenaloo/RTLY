import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadServiceWorker, loadContent, readJson, extractSiteIds } from '../helpers/load.mjs';

const { sw, chrome, listeners, store, calls } = loadServiceWorker();
const manifest = readJson('manifest.json');

describe('getSiteFromUrl', () => {
  const cases = [
    ['https://chatgpt.com/c/123', 'chatgpt.com'],
    ['https://chat.openai.com/', 'chatgpt.com'],
    ['https://www.chat.openai.com/', 'chatgpt.com'],
    ['https://claude.ai/chat/abc?x=1#y', 'claude.ai'],
    ['https://CLAUDE.AI/', 'claude.ai'],
    ['https://gemini.google.com/app', 'gemini.google.com'],
    ['https://chat.z.ai/', 'z.ai'],
    ['https://chat.qwen.ai/', 'qwen.ai'],
    ['https://chat.mistral.ai/chat', 'mistral.ai'],
    ['https://coral.cohere.com/', 'cohere.com'],
    ['https://huggingface.co/chat/', 'huggingface.co'],
    ['https://www.bing.com/chat', 'bing.com'],
    ['https://example.com/', null],
    ['https://claude.ai.evil.com/', null],
    ['https://notclaude.ai/', null],
    ['https://google.com/', null],
    ['chrome://extensions', null],
    ['not a url', null],
    ['', null],
    [undefined, null],
    [null, null],
  ];
  for (const [url, expected] of cases) {
    test(`${JSON.stringify(url)} -> ${expected}`, () => assert.equal(sw.getSiteFromUrl(url), expected));
  }
});

describe('canonicalizeSettings', () => {
  test('migrates legacy chat.openai.com key', () => {
    assert.deepEqual({ ...sw.canonicalizeSettings({ 'chat.openai.com': false }) }, { 'chatgpt.com': false });
  });
  test('does not clobber an existing canonical value; still drops legacy', () => {
    assert.deepEqual({ ...sw.canonicalizeSettings({ 'chat.openai.com': false, 'chatgpt.com': true }) }, { 'chatgpt.com': true });
  });
  test('leaves other keys untouched', () => {
    assert.deepEqual({ ...sw.canonicalizeSettings({ 'claude.ai': false }) }, { 'claude.ai': false });
  });
  test('non-object input yields {}', () => {
    for (const bad of [null, undefined, 'x', 5]) assert.deepEqual({ ...sw.canonicalizeSettings(bad) }, {});
  });
  test('applyToggleToSettings canonicalises then sets', () => {
    const s = { 'chat.openai.com': false };
    sw.applyToggleToSettings(s, 'claude.ai', false);
    assert.deepEqual({ ...s }, { 'chatgpt.com': false, 'claude.ai': false });
  });
});

describe('ALLOWED_SITE_IDS / HOST_TO_SITE', () => {
  test('ALLOWED_SITE_IDS equals the unique values of HOST_TO_SITE', () => {
    assert.deepEqual([...sw.ALLOWED_SITE_IDS].sort(), [...new Set(Object.values(sw.HOST_TO_SITE))].sort());
  });
  test('every HOST_TO_SITE value is itself a host key (canonical ids are real hosts or known aliases)', () => {
    const ok = new Set([...Object.keys(sw.HOST_TO_SITE)]);
    for (const id of sw.ALLOWED_SITE_IDS) assert.ok(ok.has(id), `${id} is not a HOST_TO_SITE key`);
  });
  test('every manifest host_permissions host maps to a known site', () => {
    for (const p of manifest.host_permissions) {
      const host = new URL(p.replace('/*', '/')).hostname;
      assert.ok(sw.getSiteFromUrl(`https://${host}/`), `host ${host} not resolved by service worker`);
    }
  });
  test('service-worker canonical ids agree with content.js (TARGET_DOMAINS + CANONICAL) for every manifest host', () => {
    const { api } = loadContent('chatgpt.com');
    for (const cs of manifest.content_scripts) {
      for (const m of cs.matches) {
        const host = new URL(m.replace('/*', '/')).hostname;
        const key = api.TARGET_DOMAINS.find((d) => host === d || host.endsWith('.' + d));
        const contentCanonical = api.CANONICAL[host] || api.CANONICAL[key] || key;
        assert.equal(sw.getSiteFromUrl(`https://${host}/`), contentCanonical, `canonical id mismatch for ${host}`);
      }
    }
  });
  test('popup and options SITES lists equal ALLOWED_SITE_IDS', () => {
    const allowed = [...sw.ALLOWED_SITE_IDS].sort();
    assert.deepEqual(extractSiteIds('pages/popup/popup.js').sort(), allowed, 'popup.js');
    assert.deepEqual(extractSiteIds('pages/options/options.js').sort(), allowed, 'options.js');
  });
});

describe('nudgeIsDue', () => {
  const DAY = 86400000;
  test('opt-out / missing -> false', () => {
    assert.equal(sw.nudgeIsDue(null, 1), false);
    assert.equal(sw.nudgeIsDue({ optOut: true, installedAt: 1000 }, 1e12), false);
  });
  test('14-day grace after install, then due', () => {
    assert.equal(sw.nudgeIsDue({ installedAt: 1000 }, 1000 + 13 * DAY), false);
    assert.equal(sw.nudgeIsDue({ installedAt: 1000 }, 1000 + 14 * DAY), true);
  });
  test('30-day cadence after lastShownAt', () => {
    assert.equal(sw.nudgeIsDue({ installedAt: 0, lastShownAt: 100 * DAY }, 129 * DAY), false);
    assert.equal(sw.nudgeIsDue({ installedAt: 0, lastShownAt: 100 * DAY }, 130 * DAY), true);
  });
});

describe('toggleSiteStatus message handler', () => {
  const handler = listeners.onMessage[0];
  const send = (msg, sender = { id: 'self-id' }) => new Promise((resolve) => {
    const async_ = handler(msg, sender, resolve);
    if (async_ === false) resolve({ unhandled: true });
  });

  test('rejects foreign senders and undefined sender id', async () => {
    assert.deepEqual(await send({ action: 'toggleSiteStatus', site: 'claude.ai', status: false }, { id: 'evil' }), { unhandled: true });
    assert.deepEqual(await send({ action: 'toggleSiteStatus', site: 'claude.ai', status: false }, {}), { unhandled: true });
  });
  test('ignores other actions', async () => {
    assert.deepEqual(await send({ action: 'nope' }), { unhandled: true });
  });
  test('rejects unknown site ids and non-boolean status without touching storage', async () => {
    const before = calls.storageSet.length;
    assert.equal((await send({ action: 'toggleSiteStatus', site: 'evil.com', status: true })).success, false);
    assert.equal((await send({ action: 'toggleSiteStatus', site: 'claude.ai', status: 'false' })).success, false);
    assert.equal((await send({ action: 'toggleSiteStatus', site: '__proto__', status: true })).success, false);
    assert.equal(calls.storageSet.length, before);
  });
  test('valid toggle persists to siteSettings and queries both apex and subdomain patterns', async () => {
    calls.queries.length = 0;
    const res = await send({ action: 'toggleSiteStatus', site: 'chatgpt.com', status: false });
    assert.equal(res.success, true);
    assert.equal(store.siteSettings['chatgpt.com'], false);
    assert.deepEqual([...calls.queries].sort(), [
      '*://*.chat.openai.com/*', '*://*.chatgpt.com/*', '*://chat.openai.com/*', '*://chatgpt.com/*',
    ].sort());
  });
});

void chrome;
