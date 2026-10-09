# Contributing to RTLY

Thank you for wanting to help. RTLY is a small, local browser extension (Chrome, Edge and Firefox) that sets right-to-left text direction and a Persian font on AI chat sites such as ChatGPT, Claude, Gemini and Perplexity. It gets better when people who use it report broken sites, fix translations and send patches. You do not need to be an expert. A clear report with a URL and a screenshot is a real contribution.

By taking part, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Contents

- [Ways to contribute](#ways-to-contribute)
- [Picking something to work on](#picking-something-to-work-on)
- [Project principles](#project-principles)
- [Workflow](#workflow)
- [Project map](#project-map)
- [Run it locally](#run-it-locally)
- [Checks](#checks)
- [Writing tests](#writing-tests)
- [Code style](#code-style)
- [When a site changes: selectors](#when-a-site-changes-selectors)
- [Adding a site](#adding-a-site)
- [Adding or changing UI text](#adding-or-changing-ui-text)
- [Translations](#translations)
- [Privacy and permission changes](#privacy-and-permission-changes)
- [Commit and pull request checklist](#commit-and-pull-request-checklist)
- [Reporting bugs well](#reporting-bugs-well)
- [Security](#security)
- [Recognition](#recognition)
- [Maintainers and decisions](#maintainers-and-decisions)
- [Releases](#releases)
- [License and sign-off](#license-and-sign-off)

## Ways to contribute

- **Report a bug.** Use the [bug report form](https://github.com/ehsanenaloo/RTLY/issues/new?template=bug_report.yml) for a problem in RTLY itself, such as the popup, the settings page, the keyboard shortcut or the right-click menu. Search [existing issues](https://github.com/ehsanenaloo/RTLY/issues) first.
- **Tell us a site is broken.** AI chat sites change their pages, and RTLY then needs new selectors. Use the [broken site form](https://github.com/ehsanenaloo/RTLY/issues/new?template=broken_site.yml) with the page URL and a screenshot. This is the most useful report there is.
- **Suggest a feature or a new site.** Use the [feature request form](https://github.com/ehsanenaloo/RTLY/issues/new?template=feature_request.yml). Describe the problem you have before the solution you want.
- **Improve a translation.** Fix a wrong or awkward string, or add a language. See [Translations](#translations). If you do not want to edit files, use the [translation fix form](https://github.com/ehsanenaloo/RTLY/issues/new?template=translation_fix.yml).
- **Improve the docs or screenshots.** The user guide is in [docs/](../docs/) and is published at <https://ehsanenaloo.github.io/RTLY/>. Fix errors, unclear steps, or outdated screenshots. Screenshots must not show private conversations.
- **Review pull requests.** Try a change in your own browser profile and say what you saw. This helps a lot, and anyone can do it.
- **Fix an issue.** Pick one from the list below, say that you are on it, and open a pull request.

Not sure where to start? Open an issue and ask. It is fine to start small.

## Picking something to work on

These labels help you find work. The full list is in [labels.yml](labels.yml).

| Label | What it means |
| --- | --- |
| `good first issue` | Small, well described, and a good first change. The issue says where to look. |
| `help wanted` | The maintainer would like help and has agreed the change fits the project. |
| `site-support` | RTLY does not align text or apply the font correctly on a supported site. Often a selector or CSS fix. |
| `site-changed` | A supported site changed its page and RTLY stopped working there. |
| `translation` | A translation fix or a new language. No coding is needed for most of these. |
| `needs triage` | Not looked at yet. Please wait for a label before you start a large change. |

Before you start on an issue, leave a short comment such as "I would like to work on this." This avoids two people doing the same work. If you do not send a pull request within a few weeks, the maintainer may offer the issue to someone else. That is not a problem. You can come back later.

If you want to change something that has no issue, open one first. For a typo or a small fix, you can send a pull request directly.

## Project principles

These guide every review. They keep the extension small, safe and trusted.

1. **Local only.** No analytics, no remote code, no servers. RTLY makes no network requests of its own. A new network request needs a strong reason and an update to [docs/PRIVACY.md](../docs/PRIVACY.md).
2. **Least privilege.** Do not add permissions or sites. The permissions are `storage` and `contextMenus`, plus the listed AI chat sites. `scripts/validate.mjs` fails on a permission the code does not use, and on any content script that is not limited to a listed host.
3. **Never store or send page text.** The content script reads the text of messages and the message box only to decide the direction. It does not save that text, copy it or send it anywhere. The only bookkeeping kept on the page is a short fingerprint of each message, not the message itself.
4. **Never change a site's layout.** RTLY changes only the direction and alignment of message and composer text, the font on that text, and the font scale the user chose. Sidebars, headers, navigation, buttons, icons and the composer frame stay exactly as the site draws them. A site that is switched off must get nothing from RTLY: no style, no class, no attribute. Browser tests compare the page with and without the extension to check both.
5. **Gate every stylesheet rule.** Every rule in `content/base.css` and in `content/sites/*.css` must start from a class or attribute that RTLY itself adds only on an active site (`rtly-*`, `data-rtly-*`). `tests/unit/css-gating.test.mjs` fails on a rule without such a gate.
6. **Render text as text.** Never build HTML from page text, stored settings or translated strings. Use `textContent` and `createElement`. A fixed, hard-coded string of markup (such as an icon) is fine; anything dynamic is not.
7. **No build step.** The `extension/` folder is the extension, exactly as it ships. Use plain classic scripts, HTML and CSS. Do not add a framework, a bundler or a runtime dependency.

A change that breaks one of these needs a discussion in an issue before any code.

## Workflow

1. **Fork** the repository on GitHub and clone your fork.

   ```bash
   git clone https://github.com/<your-username>/RTLY.git
   cd RTLY
   git remote add upstream https://github.com/ehsanenaloo/RTLY.git
   ```

2. **Create a branch** from the latest `main`. Use a short name with a prefix:

   - `fix/claude-code-blocks`
   - `feat/new-site-example`
   - `docs/troubleshooting-steps`
   - `i18n/fix-urdu-strings`
   - `chore/update-editorconfig`

3. **Make small commits.** One idea per commit. Each commit should leave the project in a working state.

4. **Write the commit message in Conventional Commits style:** `type(scope): short summary`. Use the imperative mood ("fix", not "fixed"). Keep the first line under about 72 characters. Examples:

   ```text
   fix(content): keep code blocks left-to-right in assistant messages
   fix(sites): update the Gemini message selector
   feat(popup): show the version in the header
   docs(guide): explain the three modes
   i18n(ur): correct the word for "font" in the popup
   test(build): cover the Firefox manifest conversion
   ci(release): check the Firefox manifest
   ```

   Common types are `feat`, `fix`, `docs`, `i18n`, `refactor`, `perf`, `test`, `chore` and `ci`. Common scopes are `content`, `sites`, `popup`, `options`, `background`, `i18n`, `guide`, `validate`, `build` and `ci`.

5. **Keep your branch up to date by rebasing**, not by merging `main` into it.

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

   If you have already pushed the branch, update it with `git push --force-with-lease`. The maintainer may squash your commits when merging, so a clean history on your side is helpful but not required.

6. **Open a pull request** against `main`. Fill in the template: what changed, why, the related issue, and how you tested it. Mark it as a draft if it is not ready. Keep one topic per pull request. A small pull request is reviewed faster.

7. **Respond to review.** Push follow-up commits to the same branch. When a comment is fixed, say so in a short reply.

### What review looks like

The maintainer checks that the change fits the [principles](#project-principles), passes CI, works in the browser, and is easy to read. You may get questions, requests for changes, or a suggestion to split the pull request. This is normal and is about the code, not about you.

RTLY has one maintainer, who works on it in spare time. Replies are best effort. A first response often comes within a week or two, and sometimes it takes longer. There is no promise of a date. If you have heard nothing after two weeks, a polite comment on the pull request is welcome.

## Project map

The repository root is kept small on purpose. The extension itself lives in `extension/`, and everything else (guide, tests, scripts, community files) sits beside it. The main places are:

| Path | What it holds |
| --- | --- |
| `extension/manifest.json` | Extension manifest (Manifest V3): permissions, host permissions, content-script matches and file order, the keyboard shortcut, web-accessible fonts. |
| `extension/background/service-worker.js` | The background worker. It owns the right-click menu, the keyboard shortcut, the per-site on/off setting and the monthly support reminder on the toolbar icon. It makes no network requests. |
| `extension/content/content.js` | The content script. It decides the direction of messages and the message box, applies the direction and the font, and follows new messages, navigation and settings changes. |
| `extension/content/base.css` | Styles shared by every site, all behind RTLY-owned classes. |
| `extension/content/sites/<site>.js` and `<site>.css` | One config file per site (or family of sites) with its selectors and flags, and optional CSS for that site. `misc.js` holds several sites that need no CSS. |
| `extension/pages/popup/` | The toolbar popup: current site, mode, font size, the list of sites, About and Support. |
| `extension/pages/options/` | The settings page: preview, font size, language, palette and the sites table. |
| `extension/shared/` | Code and styles shared by the popup and settings page: `i18n.js` (the translation catalog and language list), `ui.css`, `footer.js` and `footer-config.js`. |
| `extension/_locales/<lang>/messages.json` | Browser-level strings: extension name, description, the shortcut label and the right-click menu text. |
| `extension/icons/`, `extension/fonts/`, `extension/logos/` | Toolbar and store icons, the bundled IranYekan font, and the site logos shown in the popup and settings page. |
| `extension/THIRD_PARTY_NOTICES.md` | Licence notices for the third-party material that ships. |
| `docs/` | The user guide (a static site published with GitHub Pages) and `PRIVACY.md`. |
| `tests/unit/` | Unit tests (`*.test.mjs`) run with the built-in Node test runner. |
| `tests/browser/run.mjs` | Browser tests: the real extension in Chromium against local fixture pages that imitate each site. |
| `tests/helpers/` | `load.mjs`, which loads extension scripts into a sandbox for the unit tests. |
| `tests/live/` | A manual smoke test against the real, public pages. It is not run by CI. |
| `scripts/` | `validate.mjs`, `build.mjs` (Chrome and Edge zip), `build-firefox.mjs` (Firefox zip), `lib/` (shared packaging code) and `screenshots/` (the script that makes the guide's screenshots). |
| `.github/` | Issue forms, the pull request template, labels, workflows, and the community files (this guide, Code of Conduct, Security, Support). |

## Run it locally

You need Node.js 22 or newer and one of Chrome, Edge or Firefox.

```bash
npm install
```

This installs Playwright, which only the browser tests use. Nothing from npm ships in the extension, and the unit tests and `npm run validate` need no install at all.

### Chrome and Edge

1. Use a **separate browser profile** for development, so your own settings are not touched.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the **`extension/`** folder inside your clone (the folder that contains `manifest.json`), not the repository root.
4. After you edit a file, click the reload button on the extension card. Then reload the chat tab. Changes to the popup or settings page only need the page to be reopened.

### Firefox

The Firefox package is generated from the same files in `extension/`. The Chrome manifest is never changed.

1. Run `npm run build:firefox`. It writes `dist/rtly-<version>-firefox.zip` and a `.sha256` file next to it. The `dist/` folder is not committed. The script turns the background service worker into a Firefox background script, adds the add-on ID and the minimum Firefox version (128), and leaves the other files as they are.
2. In Firefox, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and choose the zip file. A temporary add-on is removed when Firefox closes.
3. Use a separate Firefox profile. After a change, run the build again and reload the add-on.

The Firefox build is experimental. The automated tests drive Chromium only.

### Where to find console logs

- **Chat page (content script):** open the page's developer tools (F12). The content script is quiet by default. To see its messages, set `DEBUG` to `true` at the top of `extension/content/content.js` while you work and reload the extension. They start with `[RTLY]`. Do not commit that change.
- **Popup:** right-click inside the popup and choose **Inspect**.
- **Settings page:** open it in a tab and press F12.
- **Background worker:** on `chrome://extensions`, click the **service worker** link on the extension's card. In Firefox use `about:debugging`.

## Checks

Run both of these before you push:

```bash
npm run validate
npm test
```

`npm run check` runs the two in a row.

- **`npm run validate`** (`node scripts/validate.mjs`) checks the manifest, the permission list (each permission must be used by the code), that every host in a content script also has a host permission, that no content script uses a wildcard host, the files the manifest and the HTML pages reference (they must exist), JavaScript syntax, JSON files, a few code rules (no `eval`, no `fetch`, no `XMLHttpRequest`, no remote scripts or styles, no inline scripts), stray files inside `extension/`, that the repository root stays small, and that `package.json` and the manifest have the same version.
- **`npm test`** runs every `tests/unit/*.test.mjs` file with the built-in Node test runner. To run one file, use `node --test tests/unit/i18n.test.mjs`.
- **Browser tests (run them for changes to the content script, a site config or CSS).** They load `extension/` into a real Chromium with a throwaway profile and drive local fixture pages that imitate each site, so no account and no network are needed:

  ```bash
  npm install
  npx playwright install chromium
  npm run test:browser
  ```

  To run only some sites, add part of the site name: `node tests/browser/run.mjs claude gemini`. Set `RTLY_HEADED=1` to watch the browser. If Chromium is not installed, the run prints `SKIP` and exits cleanly; set `RTLY_REQUIRE_BROWSER=1` to make that a failure.
- **Live smoke test (manual, optional).** `node tests/live/run.mjs [site]` opens the real public pages and reports whether RTLY injected. It needs the network and the pages change, so it is not part of CI and a failure there is a hint to look, not a verdict.
- **Packages.** `npm run build` writes `dist/rtly-<version>-chrome.zip` (Chrome and Edge) and `npm run build:firefox` writes the Firefox zip. CI builds both on every pull request to catch packaging mistakes.

CI runs `npm run validate`, `npm test` and both builds on every pull request and on pushes to `main`. It runs the Chromium browser tests on pushes to `main` and when started by hand, not on every pull request. The maintainer runs them before merging a change that touches the content script, so please run them yourself first. The maintainer looks for a green CI run before merging a pull request.

Tests do not replace trying the change by hand. The fixture pages model the structure of the real sites, but the real sites are the final judge. In the pull request, describe your manual steps: the browser and version, the site, what you typed or read, and what you saw. Include a case that should not change, such as English text, a code block, the sidebar, or a site you switched off.

## Writing tests

A fix or a feature should come with a test when the behavior can be tested without a real site.

- **Where tests live.** Unit tests are in `tests/unit/`. Name a file after the area it covers and end it with `.test.mjs`. The runner picks up every file with that ending. Use `node:test` and `node:assert/strict`, with no other test library.
- **Name tests by behavior.** A good name reads like a sentence: "English stays left-to-right, mixed text follows the majority". Put the failure cases next to the happy path.
- **Unit-test environment.** `tests/helpers/load.mjs` loads the extension's classic scripts (the content script with a site config, the service worker, `shared/i18n.js`) into a Node `vm` sandbox with a small fake of `window`, `document` and `chrome.*`. It is good for logic such as direction detection, site lists and the translation catalog. It is not a layout engine, so leave anything about rendering to the browser tests.
- **Browser tests.** `tests/browser/run.mjs` serves a fixture page for each site from `SITE_DEFS`, so the real content script runs on it. A fixture mimics the selectors in `extension/content/sites/<site>.js`. Add a scenario there when the behavior needs a real browser. Two groups matter most: the **layout invariance** scenarios, which compare every element that is not message text with and without the extension in all three modes, and the **disabled site** scenarios, which check that a switched-off site is indistinguishable from a page without RTLY. Wait for a condition (the `until` helper), never for a fixed delay.
- **Keep tests deterministic.** No real network, no real accounts, no reliance on test order, and no data shared between tests. Create the data a test needs inside the test. Use made-up messages.

## Code style

- Follow [.editorconfig](../.editorconfig): UTF-8, LF line endings, two spaces for indentation.
- The extension is plain classic scripts. A content script entry in `manifest.json` loads the site's config file first and `content/content.js` last, in that order, because `content.js` reads the config at start. Keep that order when you add or change an entry.
- A site config file is a small script that fills `window.RTLY_SITE_CONFIG` for its hosts: `inputs` (message box selectors), `responses` (message selectors) and a few optional flags. Follow the pattern in an existing file such as `claude.js`. Do not put site logic in `content.js` when a selector or flag will do.
- Use the `chrome.*` APIs with callbacks or promises that work in Chrome, Edge and Firefox. Guard a newer API before you call it.
- Keep the background worker free of DOM APIs. In Firefox it runs as a background script, so it must not rely on service-worker-only features.
- Show page-derived text with `textContent` or text nodes. Do not use `innerHTML` with page text, stored settings or translated strings.
- Keep names meaningful and consistent with nearby code. Keep functions short. Prefer a clear small change over a large rewrite.
- Comments should explain why, not what.

### Accessibility

Every interface change should work for people who use a keyboard, a screen reader, a high zoom level, or a right-to-left language. This applies to the popup and the settings page. RTLY must not make a site less accessible either.

- All actions work with the keyboard. Tab order follows the visual order.
- Focus is visible. When a menu or dialog opens, focus moves into it, and when it closes, focus returns to where it was.
- Buttons, switches and fields have a text label or an `aria-label`. Icons that carry meaning have a text alternative.
- Text and controls have enough contrast in the light theme, the dark theme and every color palette.
- Layouts work in right-to-left languages (all the non-English interface languages are right-to-left). Prefer logical CSS properties such as `margin-inline-start` over `margin-left`.
- Do not stop the site's own controls from working. RTLY must leave the site's focus order, labels and keyboard shortcuts alone.

## When a site changes: selectors

The sites' pages are not an API, so a redesign can break RTLY. The parts most likely to need an update are small and live in one place per site: `extension/content/sites/<site>.js`.

- **`inputs`** lists the selectors for the message box (the composer). Fix these first when the font or direction is not applied while you type.
- **`responses`** lists the selectors for message text, yours and the assistant's. Fix these first when messages stay left-aligned or keep the site's font.
- **Flags** such as `layoutLtr`, `heuristicFaScan`, `narrowIcons` and `cleanupStaleMark` change how the content script treats that site. The comment at the top of each config file explains them. Change a flag only when you can say what it fixes.

Rules for changing them:

- Describe what you saw in the real page in the pull request. Open the browser's developer tools on the site and say which element the selector now matches. Do not paste private conversation text.
- Prefer a more specific selector over a looser one. Prefer `data-` attributes and roles over generated class names, because those change less often. A looser selector can match site controls that are not messages, and then RTLY touches them.
- Per-site CSS in `extension/content/sites/<site>.css` is a last resort. Every rule must stay behind RTLY-owned classes (see principle 5), and it must not change the site's layout: no margins, padding, flex, position or width on site elements. `tests/unit/css-gating.test.mjs` checks the gating and the layout invariance browser tests check the rest.
- Update the fixture for the site in `tests/browser/run.mjs` (`SITE_DEFS`) so the fake page keeps the structure of the real one, add a scenario that fails without your fix, and run the browser tests.

## Adding a site

Adding a new site changes the access the extension asks for (the browser shows a new permission prompt on update), so **open an issue and agree it with the maintainer before writing code.** Sites that are not chat tools, or that would need access to more than the chat pages, may be declined to keep the permission list short. If it is agreed, the pieces are:

1. `extension/content/sites/<site>.js`: create the config. Copy a similar file, set the host in `window.RTLY_SITE_CONFIG`, and fill in `inputs` and `responses`. Add `<site>.css` only if the shared `base.css` does not cover the site, and keep it small and gated. A site that needs no CSS can go in `misc.js` instead.
2. `extension/manifest.json`: add a `content_scripts` entry that loads `content/base.css` (and your CSS), then your config script, then `content/content.js`, with `"run_at": "document_start"`. Add the site's address to `host_permissions`, and to the `matches` of `web_accessible_resources`, so the bundled font can load.
3. `extension/content/content.js`: add the host to `TARGET_DOMAINS`, add any alias host to `CANONICAL`, and add a body class for the site to `BODY_CLASS_MAP`.
4. `extension/background/service-worker.js`: add the hosts to `HOST_TO_SITE`, so the shortcut, the right-click menu and the toolbar know the site.
5. `extension/pages/popup/popup.js` and `extension/pages/options/options.js`: add the site to the `SITES` array in both (`id`, `label` and `logo`). Put a logo in `extension/logos/` only if you have one under a compatible licence, and add its notice to `extension/THIRD_PARTY_NOTICES.md`. A unit test checks that the manifest, the content script, the service worker and both pages agree on the list of sites.
6. `tests/browser/run.mjs`: add an entry to `SITE_DEFS` with the host, the message box markup and builders for a user and an assistant message, so every scenario, including layout invariance and the disabled-site checks, runs for the new site. Add the site to `tests/live/run.mjs` if it has a public page.
7. `README.md`, `docs/` (the supported sites guide and the project site) and `CHANGELOG.md`: list the new site.
8. Try it on the real site with the unpacked extension: type Persian in the message box, read an answer in Persian, and check code blocks, lists, tables and dark mode. Then run `npm run validate`, `npm test` and the browser tests.

The Firefox build derives its host list from the manifest, so it needs no extra change.

## Adding or changing UI text

All interface text lives in translation files, and no sentence is built by joining pieces.

1. **English source: the `en` block in `extension/shared/i18n.js`.** The catalog is one JavaScript object, `M`, with one block per language. Each block is a flat list of `key: "message"` pairs. English is the base for every language, and a missing key in another language shows the English text.
2. **One block per language** in the same file, with the same keys as English and translated values.
3. **Browser-level strings: `extension/_locales/<code>/messages.json`.** The browser's own format with `message` fields. It holds the extension name, its description, the shortcut label and the right-click menu text, which the browser reads directly. These exist for 10 languages, not all 15.

How to add a string in code:

- Add the key and English text to the `en` block, then use it with `RTLY_I18N.t('yourKey')` in scripts, or `data-i18n="yourKey"` in HTML (and `data-i18n-title`, `data-i18n-aria-label` and similar for attributes).
- Add the key to every other language block as well, or the parity test fails. If you cannot translate it, copy the English text and say so in the pull request.
- Every key in `en` must exist in each language, and no language may have a key that `en` lacks. `tests/unit/i18n.test.mjs` checks both directions, checks that no value is empty, and checks that every `data-i18n` key used in the popup and settings page exists.

### Placeholders

Variables are written as numbered braces such as `{0}` and `{1}`. In every translation:

- Keep each placeholder exactly as written. Do not change the braces or the number.
- Include every placeholder that the English text has. You may move them to fit the grammar of your language.
- Do not add placeholders that the English text does not have.

The test compares the placeholders of each translation with English.

## Translations

The interface is available in 15 languages, all written right to left except English: English (`en`), Persian (`fa`), Arabic (`ar`), Hebrew (`he`), Urdu (`ur`), Pashto (`ps`), Central Kurdish (`ckb`), Sindhi (`sd`), Uyghur (`ug`), Yiddish (`yi`), Western Punjabi (`pnb`), South Azerbaijani (`azb`), Saraiki (`skr`), Balochi (`bal`) and Kashmiri (`ks`). Most translations are machine-made and have not been reviewed by native speakers, so careful human fixes are very valuable.

### Fix a wrong string

1. Find the string in the block for your language in `extension/shared/i18n.js`. Search for the English text in the `en` block to find the key, then look for the same key in your language block.
2. Change only the value. Keep the key and the placeholders unchanged.
3. Run `node --test tests/unit/i18n.test.mjs` to make sure the catalog is still consistent with English.
4. Open a pull request. In the description, name the screen where you saw the string and say whether you are a native speaker.

If you would rather not edit files, open a [translation fix issue](https://github.com/ehsanenaloo/RTLY/issues/new?template=translation_fix.yml) with the current text and your suggestion.

### Add a language

Please open an issue first so we can agree on the language code and avoid duplicate work. Then:

1. In `extension/shared/i18n.js`, copy the whole `en` block, name it with your language code, and replace every value with your translation. Keep the keys unchanged, including every placeholder.
2. Add the code to `SUPPORTED_LOCALES`, add the language's own name, as its speakers write it, to `LOCALE_NAMES`, and add the code to `RTL_LOCALES` if the language is written right to left. The unit test currently expects every language except English to be right to left. If you add a left-to-right language, update that test in the same pull request and say so.
3. Optional, but welcome: create `extension/_locales/<code>/messages.json` by copying `extension/_locales/en/messages.json` and translating the `message` values. The folder name is the browser's format, so a region uses an underscore (`pt_BR`). Without it, the browser shows the English name and description. The Chrome Web Store allows at most 45 characters for the name and 132 for the description, and the validation script does not check this, so count them yourself.
4. Run `npm run validate` and `npm test`.
5. Load the extension, choose your language on the settings page, and look at the popup and the settings page. Check for text that is cut off, overlaps, or points the wrong way.
6. Open a pull request. The maintainer will update language counts in the docs.

### Quality bar

- Use the natural words that people use for fonts, text direction and settings in your language.
- Keep the tone short and friendly, like the English text.
- Keep the same meaning. Do not add or drop warnings.
- Be consistent. Use one word for one idea across the whole interface.
- Keep product and site names (RTLY, ChatGPT, Claude, Gemini and the others), the font name (IranYekan) and keyboard keys unchanged.
- Check long words in the narrow popup.

### Native-speaker review

Say in the pull request which of these applies:

- "I am a native speaker of this language."
- "I am fluent but not a native speaker."
- "I used a translation tool and checked the result myself."

All three are welcome. If a second person who speaks the language can read the change, ask for their review in the pull request. The maintainer cannot judge every language, so a review by another speaker is the strongest signal.

### Thanks

Translators are credited in the release notes by name or username, unless you prefer not to be named. Tell us in the pull request if you want to stay anonymous. See [Recognition](#recognition).

## Privacy and permission changes

Discuss these in an issue **before** you write code:

- A new permission, a new site in the content script matches or host permissions, or any change to what the extension can access.
- A new network request, or any change to who the extension talks to.
- A new storage key, or a change to what is stored.
- Anything that stores, copies or sends page text, or reads more of a page than the messages and the message box.
- Anything that adds analytics, remote code or a third-party service.

Each of these affects user trust and store review. If the change is accepted, the same pull request must update [docs/PRIVACY.md](../docs/PRIVACY.md) and the docs.

## Commit and pull request checklist

The pull request template has a shorter version of this list.

- [ ] The change is focused, and the description says why it is needed.
- [ ] The pull request links the related issue, for example "Fixes #123".
- [ ] `npm run validate` and `npm test` pass.
- [ ] For a change to the content script, a site config or CSS, I ran the browser tests (`npm run test:browser`).
- [ ] I added or updated a test for the change, or I explained why it cannot be tested.
- [ ] I tried the change in a real browser on the affected site, and described the steps I took.
- [ ] I checked something that should not change, such as English text, code blocks, the sidebar, or a site switched off.
- [ ] Commit messages follow the Conventional Commits style.
- [ ] RTLY still changes only direction, alignment and font on message and composer text, and every new CSS rule is behind an RTLY-owned class or attribute.
- [ ] No new permissions, site matches, network requests or storage keys, or they were agreed in an issue first.
- [ ] A new site is registered in every place listed in [Adding a site](#adding-a-site).
- [ ] Interface text comes from the `en` block (and every language block) in `shared/i18n.js`, and page text is shown as text, not HTML.
- [ ] The change works with the keyboard and in a right-to-left language.
- [ ] User-visible changes are noted in [CHANGELOG.md](../CHANGELOG.md) under the upcoming version.
- [ ] The docs and [docs/PRIVACY.md](../docs/PRIVACY.md) are updated if behavior or data handling changed.
- [ ] Screenshots, logs and test files contain no private conversation text or personal data.
- [ ] I wrote this change or I have the right to submit it (see [License and sign-off](#license-and-sign-off)).

## Reporting bugs well

A good report lets someone else see the problem in a few minutes. Include:

- the RTLY version (shown at the top of the popup, and in About in the popup's three-dot menu), your browser and its version, and your operating system,
- the site and the full address of the page (use a chat with no private content),
- the mode for that site (Full, Font or RTL) and whether RTLY is switched on for it in the popup,
- what you expected and what happened, for example "my messages are aligned left" or "code blocks are flipped",
- the smallest set of steps that shows the problem,
- a screenshot, with private text hidden,
- console errors, if any (see [Where to find console logs](#where-to-find-console-logs)).

Never post private conversation text or personal data in a public issue.

## Security

Do not open a public issue for a security problem. Follow [SECURITY.md](SECURITY.md) and use GitHub's private vulnerability report. For general help, see [SUPPORT.md](SUPPORT.md).

## Recognition

Every person whose commits are merged into `main` is credited by GitHub in the repository's contributors list. That list needs your commits to be linked to your GitHub account, so check that your Git email address is added to your GitHub profile.

Work that does not always show up as commits is credited in the release notes. This includes translations, documentation, bug reports with good reproduction steps, and reviews. You are named by your name or GitHub username, unless you prefer not to be. Tell the maintainer in the issue or pull request.

## Maintainers and decisions

RTLY is maintained by [Ehsan Enaloo](https://github.com/ehsanenaloo). The maintainer makes the final decision on what is merged and what is not, using the [project principles](#project-principles) and the results of CI.

If you disagree with a decision, say so in the issue. Give your reasons and your use case, and listen to the reply. Please keep the discussion respectful and about the work, as the [Code of Conduct](CODE_OF_CONDUCT.md) asks. A "no" to a feature is not a judgment about you. Often it means the idea needs a permission or a service that this project does not want. You are always free to fork the project under the MIT License.

## Releases

Releases are made by the maintainer. The maintainer updates the version in `extension/manifest.json` and `package.json` (validation fails if they differ), adds a section to `CHANGELOG.md`, and pushes a tag named `vX.Y.Z`. The [release workflow](workflows/release.yml) then:

1. runs `npm run validate` and the unit tests,
2. checks that the tag matches the version in `extension/manifest.json`,
3. builds both packages: `rtly-X.Y.Z-chrome.zip` (Chrome and Edge) and `rtly-X.Y.Z-firefox.zip`, each with the `LICENSE` and a SHA-256 checksum, and checks that `manifest.json` is at the root of each zip and that the Firefox manifest has a background script and an add-on ID,
4. creates a GitHub Release with both zips and both checksums attached, and uses the matching section of `CHANGELOG.md` as the notes.

Publishing to the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons is a separate manual step.

## License and sign-off

RTLY is released under the [MIT License](../LICENSE). When you contribute, your contribution is licensed under the same terms.

By opening a pull request, you confirm that you wrote the change yourself, or that you have the right to submit it under the MIT License. Do not copy code, text, fonts or images from sources that do not allow this. There is no sign-off tool and no `Signed-off-by` line is required.
