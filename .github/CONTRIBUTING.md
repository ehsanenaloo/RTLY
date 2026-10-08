# Contributing to RTLY

Thank you for wanting to help. RTLY is a small browser extension that fixes right-to-left text (Persian, Arabic, Hebrew, Urdu and others) and applies a Persian font on AI chat sites. It gets better when people report broken sites, fix translations and send patches. You do not need to be an expert. A clear bug report with a URL and a screenshot is a real contribution.

By taking part, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Contents

- [Ways to contribute](#ways-to-contribute)
- [Reporting a broken site](#reporting-a-broken-site)
- [Project principles](#project-principles)
- [Workflow](#workflow)
- [Project map](#project-map)
- [Run it locally](#run-it-locally)
- [Checks](#checks)
- [Adding a new site](#adding-a-new-site)
- [Translations](#translations)
- [Commit and pull request checklist](#commit-and-pull-request-checklist)
- [Security](#security)
- [Releases](#releases)
- [License](#license)

## Ways to contribute

- **Report a broken site.** Use the [broken site form](https://github.com/ehsanenaloo/RTLY/issues/new?template=broken_site.yml).
- **Report a bug in RTLY itself.** Use the [bug report form](https://github.com/ehsanenaloo/RTLY/issues/new?template=bug_report.yml).
- **Suggest a feature or a new site.** Use the [feature request form](https://github.com/ehsanenaloo/RTLY/issues/new?template=feature_request.yml).
- **Fix or add a translation.** See [Translations](#translations), or use the [translation fix form](https://github.com/ehsanenaloo/RTLY/issues/new?template=translation_fix.yml) if you do not want to edit files.
- **Send a patch.** For a typo or a small fix, open a pull request directly. For anything larger, open an issue first so we can agree on the approach.

Search [existing issues](https://github.com/ehsanenaloo/RTLY/issues) before you open a new one.

## Reporting a broken site

AI chat sites change their page structure often, so this is the most common problem. A good report has:

1. **The URL** of the page (use a chat with no private content).
2. **A screenshot** that shows what is wrong, for example text aligned to the left, a flipped code block, or the wrong font.
3. **Your browser and RTLY version.**
4. Whether RTLY is turned on for that site in the popup.

Please hide private text in screenshots.

## Project principles

These guide every review. They keep the extension small, safe and trusted.

1. **Local only.** No analytics, no remote code, no servers. A new network request needs a strong reason.
2. **Least privilege.** Do not add permissions. RTLY asks only for `storage` and `contextMenus`, plus the AI chat sites it supports.
3. **Render text as text.** Never build HTML from page text, stored settings or translated strings. Use text nodes.
4. **Do not break the page.** RTLY only changes direction, alignment and font. It must not change what a site shows or sends.
5. **No build step for the extension.** The `extension/` folder is the extension, exactly as it ships. Use plain JavaScript, HTML and CSS. Do not add a framework, bundler or runtime dependency.

A change that breaks one of these needs a discussion in an issue first.

## Workflow

1. **Fork** the repository and clone your fork.

   ```bash
   git clone https://github.com/<your-username>/RTLY.git
   cd RTLY
   git remote add upstream https://github.com/ehsanenaloo/RTLY.git
   ```

2. **Create a branch** from the latest `main`, with a short prefixed name such as `fix/claude-code-blocks`, `feat/new-site-example`, `i18n/fix-urdu-strings` or `docs/readme-typo`.

3. **Make small commits**, one idea each, in [Conventional Commits](https://www.conventionalcommits.org/) style: `type(scope): short summary`, in the imperative mood. For example:

   ```text
   fix(chatgpt): keep code blocks left-to-right in assistant messages
   feat(sites): add support for example.ai
   i18n(ur): correct the word for "font" in the popup
   ```

   Common types are `feat`, `fix`, `docs`, `i18n`, `refactor`, `test`, `chore` and `ci`.

4. **Keep your branch current** by rebasing on `upstream/main` instead of merging.

5. **Open a pull request** against `main` and fill in the template. Keep one topic per pull request. Mark it as a draft if it is not ready.

6. **Respond to review** by pushing follow-up commits to the same branch.

RTLY has one maintainer who works on it in spare time. Replies are best effort. If you have heard nothing after two weeks, a polite comment on the pull request is welcome.

## Project map

| Path | What it holds |
| --- | --- |
| `extension/manifest.json` | The Manifest V3 manifest: permissions, content scripts, icons. |
| `extension/background/service-worker.js` | Context menu, keyboard shortcut and per-site toggling. |
| `extension/content/content.js` | The content script that detects text direction and applies alignment and font. |
| `extension/content/base.css` | Styles shared by every site. |
| `extension/content/sites/<site>.js` | Per-site selectors and behavior flags (one file per site or family of sites). |
| `extension/content/sites/<site>.css` | Per-site style fixes. |
| `extension/pages/popup/`, `extension/pages/options/` | The toolbar popup and the options page. |
| `extension/shared/` | Code shared by the popup and options page, including `i18n.js`. |
| `extension/_locales/<lang>/messages.json` | Browser-level strings (name, description, shortcut label). |
| `extension/fonts/`, `extension/icons/`, `extension/logos/` | The bundled Persian font, extension icons and site logos. |
| `tests/` | Unit tests (`tests/unit`) and browser tests (`tests/browser`). |
| `scripts/` | Validation and packaging scripts. |
| `docs/` | The project site, published with GitHub Pages. |

## Run it locally

You need Node.js 22 or newer for the scripts. The extension itself needs no install.

1. Clone the repository.
2. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, choose **Load unpacked** and select the `extension/` folder.
3. After a code change, press the reload button on the extension card and reload the chat page.

For Firefox, run `npm run build:firefox`, then open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on** and select `manifest.json` from the unpacked contents of `dist/rtly-<version>-firefox.zip`.

## Checks

```bash
npm install          # only needed for the browser tests (Playwright)
npm run validate     # manifest, files, site lists, locales and repository layout
npm test             # unit tests
npm run test:browser # loads the extension in Chromium (needs Playwright)
npm run build        # dist/rtly-<version>-chrome.zip (Chrome and Edge)
npm run build:firefox # dist/rtly-<version>-firefox.zip
```

`npm run check` runs validation and unit tests together. CI runs the same checks on every pull request.

## Adding a new site

Each supported site has its own small adapter. To add `example.ai`:

1. **Create `extension/content/sites/example.js`.** Copy a similar existing file, such as `chatgpt.js`, and set the host name, the `inputs` selectors (the message box) and the `responses` selectors (where answers appear). Keep selectors as stable as you can: prefer `data-` attributes and roles over generated class names.
2. **Create `extension/content/sites/example.css`** for any fixes the shared `base.css` does not cover. Leave it small. If the site needs none, you can skip the CSS file.
3. **Register the site in `extension/manifest.json`:**
   - a new `content_scripts` entry that loads `content/base.css`, your CSS, your site script and then `content/content.js`, with `"run_at": "document_start"`,
   - the site's address in `host_permissions`,
   - the same address in `web_accessible_resources[].matches`, so the bundled font can load.
4. **Add the site to the lists** in `extension/background/service-worker.js` (`HOST_TO_SITE`), `extension/content/content.js` (the host lists) and the site arrays in `extension/pages/popup/popup.js` and `extension/pages/options/options.js`. Add a logo to `extension/logos/` if you have a suitable one under a compatible license.
5. **Test it** on the real site with the unpacked extension: type Persian in the message box, read an answer in Persian, and check code blocks, lists, tables and dark mode.
6. **Run `npm run validate` and `npm test`.** Validation checks the manifest and files, so fix anything it reports.
7. **Open a pull request** with the site URL and before/after screenshots.

Sites that are not chat tools, or that need access to more than the chat page, may be declined to keep the permission list short.

## Translations

There are two kinds of text, and both live in `extension/`:

- `extension/_locales/<lang>/messages.json` holds the browser-level strings: the extension name, description and shortcut label. Keep every key that exists in `en`, and keep placeholders such as `$1` exactly as they are.
- `extension/shared/i18n.js` holds the strings for the popup and options page, one block per language.

To fix a string, edit it in the right place and open a pull request. To add a language, copy the `en` block, translate the values (never the keys), add the language code to the list of supported locales, and add its native name. Right-to-left languages are marked in the same file. If you are not a native speaker, say so in the pull request so a reviewer can look closer. Run `npm run validate`, which checks that locale files are valid and complete.

If you would rather not edit files, use the [translation fix form](https://github.com/ehsanenaloo/RTLY/issues/new?template=translation_fix.yml).

## Commit and pull request checklist

- [ ] The change fits the [project principles](#project-principles).
- [ ] `npm run validate` and `npm test` pass.
- [ ] I tried the change in a real browser.
- [ ] A new site is registered in every place listed in [Adding a new site](#adding-a-new-site).
- [ ] New interface text is translated through the locale files, not hard-coded.
- [ ] I did not add permissions, dependencies in the extension, or network requests.
- [ ] `CHANGELOG.md` is updated for user-visible changes.

## Security

Do not report security problems in a public issue. Follow [SECURITY.md](SECURITY.md) and use GitHub private vulnerability reporting.

## Releases

Releases are made by the maintainer. Pushing a tag such as `v2.0.0` (which must match the version in `extension/manifest.json`) runs the release workflow. It validates the repository, builds the Chrome/Edge and Firefox zips and attaches them to a GitHub Release with checksums. Release notes come from the matching section of `CHANGELOG.md`. Store uploads are done by hand.

## License

RTLY is released under the [MIT License](../LICENSE). By sending a contribution you agree that it is licensed under the same terms.
