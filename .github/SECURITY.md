# Security Policy

## Supported versions

Security fixes go into the latest release. Older versions are not patched, so please update first.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately with the GitHub private vulnerability reporting feature:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the problem and how to reproduce it.

Direct link: <https://github.com/ehsanenaloo/RTLY/security/advisories/new>

Helpful details:

- the RTLY version (shown on `chrome://extensions`, `edge://extensions` or `about:addons`) and the browser version,
- the affected part (content script, a site adapter, popup, options page, background worker),
- clear steps to reproduce, ideally on a page you control,
- the impact you believe it has.

Please do not include passwords, personal data or private chat contents in a report.

## What to expect

RTLY is maintained by one volunteer, so replies are best effort. The maintainer will acknowledge your report, assess it, work on a fix for confirmed issues and credit you in the release notes if you wish. Please allow a reasonable time to ship a fix before you disclose the issue publicly.

## Scope

In scope:

- code in this repository that ships in the extension,
- ways to make RTLY read, change or send data beyond what it needs to align text and apply a font,
- script injection (XSS) through page content, site adapters, stored settings or translated strings,
- unsafe use of messaging between extension parts, or of web-accessible resources.

Out of scope:

- problems that need an already compromised browser, operating system or profile,
- vulnerabilities in the browser, in the AI chat sites, or in other extensions,
- findings that depend on a modified copy of the extension,
- social engineering, and issues that only affect unsupported browser versions.

## Design notes for researchers

- RTLY has no servers and no analytics, and it makes no network requests of its own.
- It asks only for the `storage` and `contextMenus` permissions, plus access to the listed AI chat sites.
- Settings are kept in the browser extension storage on your device.
- Web-accessible resources are limited to the bundled Persian fonts, and only for the supported sites.
