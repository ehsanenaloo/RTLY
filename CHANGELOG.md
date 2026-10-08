# Changelog

All notable changes to RTLY are listed here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- RTLY no longer changes the layout of the sites it supports. It now sets only text direction and font on message and composer text. Sidebars, headers, navigation, buttons, icons and the composer frame are left exactly as the site draws them. Earlier versions applied the font page-wide and forced direction, alignment, padding and flex rules onto site chrome. A new browser test compares every non-message element with and without the extension, in all three modes.
- A site you switched off now gets nothing from RTLY: no injected style, no variables, no classes, no attributes. Switching a site off in another tab or from the popup now stops RTLY in open tabs without a reload.
- Latin digits in English text (versions, dates, code) are no longer drawn as Persian digits. Persian text keeps Persian digits.
- Long chats use less memory: RTLY stores a short fingerprint of each message instead of a copy of its text.
- Two quick toggles of different sites (popup and shortcut) can no longer overwrite each other.

### Changed

- Some site CSS rules that moved or realigned site elements were removed. If RTL messages look wrong on a site, report it with a screenshot.

## [2.0.0] - 2026-10-08

RTLY 2.0.0 is the first open-source release. It has a new popup and settings page, a cleaner permission list, fixes for pages that were restored from the browser's back/forward cache and for single-page navigation, two more supported sites, and an experimental Firefox build. The project was also reorganized: the extension now lives in `extension/`, with tests, build scripts and a user guide next to it.

Known limitations:

- The Firefox build passes `web-ext lint`, but it has not been run in a real Firefox by the tests in this repository.
- Site markup changes without notice. Selectors can stop matching, and then RTLY does nothing on that site until they are updated.
- The automated tests use local fixture pages that imitate five sites (ChatGPT, Claude, Gemini, Perplexity and Mistral). They do not load the live sites.
- Eight strings (mostly on the settings page) are still English in ten of the 15 interface languages, and the extension name, description and shortcut label are translated for only 10 of the 15.
- The Bing, Mistral and Cohere entries match their whole host, so RTLY also runs on pages of those hosts that are not chat pages.

### Added

- New popup. It shows the current site with an on/off switch, the mode (Full, Font or RTL) and the font size, then lists all 16 supported sites with a switch for each. A three-dot menu holds Settings, About, Support, the theme (light, dark, system) and the color palette (teal, blue, indigo, neutral).
- New settings page with a live before/after preview, display options (font size, interface language, color palette), and a searchable table of sites where you choose the mode, pin favorites to the top of the popup, or switch a site off. It works on narrow screens.
- Support for `chat.mistral.ai` and `coral.cohere.com`.
- Experimental Firefox build for Firefox 128 or newer, published as `rtly-<version>-firefox.zip` on each release. It is generated from the same source by `npm run build:firefox`; the Chrome files are not changed.
- Chrome and Edge package built by `npm run build` as `rtly-<version>-chrome.zip`. Edge uses the Chrome package.
- Unit tests (`npm test`), a repository validation script (`npm run validate`) and Chromium browser tests with a fixture page per site (`npm run test:browser`).
- GitHub Actions for checks on every pull request, a release workflow that builds both zips with SHA-256 checksums when a version tag is pushed, and a workflow that publishes the user guide to GitHub Pages.
- A user guide in English with Persian pages, a privacy policy, and README translations in Persian and Arabic.

### Changed

- The keyboard shortcut to turn RTLY on or off for the current site is now `Alt+Shift+R`. You can change it in the browser's extension shortcut settings.
- Hugging Face is limited to the `/chat` section instead of the whole site.
- Single-page navigation is detected with the browser's Navigation API where it exists (Chrome, and Firefox 147 or newer), with a one-second address check as a fallback. RTLY no longer patches `history.pushState`.
- The project layout: extension files moved to `extension/`, scripts to `scripts/`, tests to `tests/` and the site to `docs/`. The long change history from the content script's header was moved out of the shipped file.

### Removed

- The `alarms` permission. The monthly support reminder (a small heart on the toolbar icon, and a card in the popup) no longer uses a timer. It is checked when you switch tabs or load a page, and only while a supported site is in front.

### Fixed

- Pages restored from the back/forward cache lost their observers, so new messages were no longer processed after you went back to a chat. The content script now keeps its observers running when a page is entering the cache and tears them down only when the page is really unloaded.
- Navigation inside a chat (opening another conversation without a page load) was not always noticed. The old code patched `history.pushState` from the content script, which runs in an isolated world and never saw the page's own calls. Work that waits for a navigation event, such as rebinding the message box, could be skipped.

## 1.x

Versions 1.0 to 1.9.36 were distributed through the Chrome Web Store before the source was published. Dates were not recorded, and the notes below are a condensed summary. Detailed per-version engineering notes for 1.9.8 to 1.9.28 are not published.

### 1.9

- 1.9.36 was the last version before 2.0.0.
- Claude: Persian titles in the chat list are right-aligned (1.8.9), the page layout stays left-to-right while message text flips (1.9.23), and choice cards are aligned (1.9.33, 1.9.34).
- Performance on long ChatGPT threads, fixed over several versions (1.9.20 to 1.9.28). The cause was forced layout from `innerText` and `getComputedStyle`. RTLY now reads `textContent`, skips code blocks, avoids repeat work on unchanged messages and processes long threads in short time slices.
- Mixed-language text: blocks that are mostly English keep their left alignment, but Persian lines inside them are ordered correctly (1.9.24).
- Per-site settings and behavior flags moved into one small file per site, and unit tests were added (1.9.18, 1.9.19).
- Text in any right-to-left script is detected, including Syriac, Thaana, N'Ko and Adlam (1.9.17).
- Five more interface languages: Western Punjabi, South Azerbaijani, Saraiki, Balochi and Kashmiri. This brought the total to 15 (1.9.17).
- The monthly support reminder was added (1.9.15). This version added the `alarms` permission, which 2.0.0 removed.
- New icon (1.9.14).
- The settings preview covers every interface language (1.9.11), and all strings were translated for Urdu, Pashto, Central Kurdish, Sindhi, Uyghur and Yiddish (1.9.13).
- Bing, Mistral, Hugging Face and Cohere were missing a style hook, so shared protections such as the icon shield did not apply there; fixed in 1.9.10.
- The font and the direction can be switched separately per site, and a mode change applies to open tabs without a reload (1.9.20). A site that is switched off no longer gets the page-level font scale (1.9.20).

### 1.8

- Popup overflow menu with Settings, About, Support, theme and color palette. A rotating footer with GitHub, rating and support links. The global "lite mode" switch was removed because the per-site RTL-only mode replaces it.
- The Full, Font and RTL modes were rebuilt so that each one only applies its own part of the CSS (1.8.6).
- Fixes for the message box: no more flickering spellcheck underlines in editors that re-render lines (1.8.10, 1.8.11), and the font is applied only while the text contains Arabic-script characters (1.8.17).
- Direction detection counts characters instead of words. The threshold is 30% right-to-left characters, or 20% when the text has an Arabic-script punctuation or vowel mark (1.8.15, 1.8.16).

### 1.7 and earlier

- Character-based direction detection replaced word counting (1.7).
- Earlier history was not archived.

[Unreleased]: https://github.com/ehsanenaloo/RTLY/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/ehsanenaloo/RTLY/releases/tag/v2.0.0
