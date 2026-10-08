# RTLY privacy policy

Last updated: 2026-10-08. This policy applies to RTLY 2.0.0 and later versions until it is updated.

## Summary

RTLY runs inside your browser. It has no server, no account and no analytics. It does not collect, store or send the content of your chats. It saves a few settings on your device.

## What RTLY can access

- **Pages of the supported AI chat sites.** RTLY runs only on the sites listed in the [user guide](https://ehsanenaloo.github.io/RTLY/guides/supported-sites.html) (27 address patterns for 16 sites). On those pages it reads the text to decide whether each block is right-to-left, and it changes the page's text direction, alignment and font. The text is read in memory. RTLY does not save it, copy it, log it or send it anywhere.
- **The address of the active tab, on those sites only.** The extension uses it to know which site the shortcut or the right-click menu refers to, and whether to show the support heart on the toolbar icon.
- RTLY cannot access other websites, your bookmarks, history, cookies, downloads or files, or the content of your other tabs.

## What RTLY stores on your device

RTLY keeps these settings in your browser's extension storage (`chrome.storage.local`). RTLY does not use browser sync for them.

| Setting | Meaning |
| --- | --- |
| Site switches | Which sites you turned off |
| Site modes | Full, Font or RTL for each site you changed |
| Pinned sites | The sites you pinned in the popup |
| Font size | A number from 85 to 120 |
| Theme and color palette | Your choice for RTLY's own pages |
| Interface language | The language you picked |
| Support reminder | The time of installation and the time the reminder was last shown, so it can wait about a month |

Your chats, prompts and answers are never stored by RTLY. The settings stay until you remove the extension. Removing the extension removes them.

## What leaves your browser

Nothing. RTLY makes no network requests. There is no server to receive data, and the extension contains no analytics, advertising, tracking or remote code.

The popup and settings page have links to the project's GitHub page, to the Buy me a coffee page and to the store's reviews page. They open in a new tab only when you click them. Once opened, those sites receive your request from your browser and follow their own privacy policies.

## Permissions

| Permission | Why |
| --- | --- |
| Access to the supported sites (`https` only) | To run on those pages, read their text to choose a direction, and set direction, alignment and font |
| `storage` | To save the settings above |
| `contextMenus` | To add the right-click item that turns RTLY on or off for a site |

RTLY does not request the tabs, history, cookies, downloads, notifications or alarms permissions.

## The websites you use

An AI chat site can see its own page after RTLY has changed it, for example the `dir` and `data-rtly-*` attributes and the styles RTLY adds. RTLY makes its two font files available to the supported sites so that its stylesheet can load them. A site could use this to detect that RTLY is installed. RTLY does not change what a site sends or receives.

## Third parties

- **Browser stores** (Chrome Web Store, Microsoft Edge Add-ons, Firefox Add-ons) keep their own install statistics. RTLY does not see them.
- **GitHub** hosts the source code, the releases and the user guide. GitHub may record visits to those pages, as any web host does. The extension itself never contacts GitHub.
- **Buy me a coffee** is contacted only if you click a support link.

## Children

RTLY collects no personal information from anyone, including children.

## Changes to this policy

If RTLY changes what it accesses or stores, this page will be updated with a new date, and the change will be listed in the changelog.

## Contact

Ask a question or report a problem in an [issue](https://github.com/ehsanenaloo/RTLY/issues). Report a security problem privately through [GitHub private vulnerability reporting](https://github.com/ehsanenaloo/RTLY/security/advisories/new). RTLY is written and maintained by Ehsan Enaloo.
