# Changelog

All notable changes to RTLY are listed here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-10-09

First open-source release.

### Added

- New popup with a switch for the current site, the mode (Full, Font or RTL), the font size, and a list of all supported sites. The three-dot menu has Settings, Help guide, About, Support, the theme and the color palette.
- New settings page with a live before and after preview, font size, language, color palette, and a searchable table where you set the mode, pin sites or switch them off. It works on narrow screens.
- Support for Copilot at `copilot.com`, `chat.mistral.ai`, `coral.cohere.com` and `dashboard.cohere.com`.
- Experimental Firefox package for Firefox 128 or newer (`rtly-<version>-firefox.zip`). The Chrome and Edge package is `rtly-<version>-chrome.zip`.
- Check and build commands for developers: `npm run check`, `npm run test:browser`, `npm run build` and `npm run build:firefox`.
- A privacy policy and README translations in Persian and Arabic.

### Changed

- RTLY now changes only text direction and font on messages and on the message box. Sidebars, headers, buttons and icons stay as the site draws them. Some site styles that moved page elements were removed; if messages look wrong on a site, please report it.
- A site that you switch off gets nothing from RTLY. Switching a site off now also stops RTLY in tabs that are already open.
- The shortcut to turn RTLY on or off for the current site is now `Alt+Shift+R`. You can change it in the browser's shortcut settings.
- Hugging Face is limited to `/chat`. Mistral and Cohere are limited to their chat sites.
- Chrome 111 or newer is required.
- The extension files are now in the `extension/` folder. To load RTLY unpacked, choose that folder.

### Removed

- The `alarms` permission. The monthly support reminder is now checked when you switch tabs or load a page.

### Fixed

- After going back to a chat from the browser's back/forward cache, new messages were not processed.
- Moving between chats without a page load was not always noticed.
- Numbers in English text, such as versions and dates, were drawn as Persian digits. Persian text keeps Persian digits.
- RTLY no longer keeps a copy of each message's text in the page, which saves memory in long chats.
- The shortcut and the right-click menu now reload every open tab of the site, not only the current one.
- Switching several sites quickly could lose one of the changes.

## 1.x

Versions 1.0 to 1.9.36 were published through the Chrome Web Store before the source was released. Release dates were not recorded.

### 1.9

- New icon (1.9.14).
- Monthly support reminder (1.9.15).
- Five more interface languages: Western Punjabi, South Azerbaijani, Saraiki, Balochi and Kashmiri. RTLY now has 15 (1.9.17).
- Text in every right-to-left script is detected, including Syriac, Thaana, N'Ko and Adlam (1.9.17).
- Font and direction can be switched separately for each site, and a mode change applies to open tabs without a reload (1.9.20).
- Long ChatGPT conversations no longer freeze the page (1.9.20 to 1.9.28).
- Claude: Persian titles in the chat list are right-aligned, the page layout stays left-to-right while message text flips, and choice cards are aligned (1.9.23 to 1.9.34).
- Mixed text: mostly English blocks keep their left alignment, and Persian lines inside them are ordered correctly (1.9.24).
- All settings texts are translated for Urdu, Pashto, Central Kurdish, Sindhi, Uyghur and Yiddish, and the preview covers every interface language (1.9.11, 1.9.13).
- Bing, Mistral, Hugging Face and Cohere now get the same protections for icons as the other sites (1.9.10).

### 1.8

- Popup menu with Settings, About, Support, theme and color palette, and a rotating footer with GitHub, rating and support links. The global lite mode was removed; use the RTL mode of a site instead.
- Full, Font and RTL modes each apply only their own part of the styles (1.8.6).
- The message box no longer flickers spellcheck underlines in editors that redraw lines (1.8.10, 1.8.11). The font is applied only while the text has Arabic-script characters (1.8.17).
- Direction detection counts characters instead of words. A block is right-to-left when at least 30% of its letters are right-to-left, or 20% if it has an Arabic-script punctuation or vowel mark (1.8.15, 1.8.16).

### 1.7 and earlier

- Direction detection by characters replaced counting words (1.7). Earlier history was not kept.

[Unreleased]: https://github.com/ehsanenaloo/RTLY/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/ehsanenaloo/RTLY/releases/tag/v2.0.0
