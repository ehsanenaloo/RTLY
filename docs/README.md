# RTLY user guide

This folder is a static HTML site for people who use RTLY. It needs no build step and no external services. It works without JavaScript; with JavaScript it adds a theme switch, guide search and card filtering. It is published to GitHub Pages at <https://ehsanenaloo.github.io/RTLY/>.

## Contents

| Path | What it is |
| --- | --- |
| `index.html` | Home page |
| `guides/*.html` | The English guide: quick start, installation, popup, settings, modes and direction, shortcut and menu, supported sites, languages, privacy and data, troubleshooting, limits |
| `privacy.html`, `PRIVACY.md` | The privacy policy (web and Markdown versions; keep them identical) |
| `fa/*.html` | Persian pages: home, quick start, installation, privacy. Right-to-left layout. The rest of the guide is English only |
| `translations/README.fa.md`, `README.ar.md` | Translations of the repository README |
| `styles.css`, `app.js` | Shared styles (light and dark, right-to-left aware) and the optional scripts |
| `search-index.js` | Search index for the English pages. Update it when a guide changes |
| `llms.txt` | A plain-text list of the pages for tools |
| `assets/` | The logo, screenshots (`assets/screenshots/`) and store images (`assets/store/`) |

## Local preview

From the repository root:

```sh
python -m http.server 8766 --bind 127.0.0.1 --directory docs
```

Open <http://127.0.0.1:8766/>. Opening `docs/index.html` directly from disk also works.

## Maintenance

- Keep the text plain, in English, and true of the current code. When behavior changes, update the guide page that describes it, the "checked against" date and version on the page, and the Persian page that mirrors it.
- Describe controls by their labels, not by position or color, so visual changes do not make the text wrong.
- The privacy policy exists in four places that must agree: `PRIVACY.md`, `privacy.html`, `fa/privacy.html` and the store listings.
- When a page is added, renamed or removed, update `search-index.js`, `llms.txt` and the sidebar of every guide page.
- If a screenshot file is missing, the page shows a short note instead of an image and nothing else breaks.
