## What does this change?

<!-- A short summary. Link the issue it closes, for example "Closes #12". -->

## Why?

<!-- The problem this solves. For a site fix, include the page URL and a before/after screenshot. -->

## Type of change

- [ ] Site fix or new site adapter
- [ ] Bug fix
- [ ] Feature
- [ ] Translation
- [ ] Docs, tests or tooling

## How did you test it?

<!-- Browser and version, the site you tried, and the commands you ran. -->

## Checklist

- [ ] `npm run validate` and `npm test` pass.
- [ ] I tested in a real browser with the unpacked `extension/` folder (if the change touches the extension).
- [ ] A new site is registered everywhere it must be: `content/sites/<site>.js`, `<site>.css`, `manifest.json` (content script, host permission, web-accessible resource) and the site lists. See [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-site).
- [ ] New or changed interface text goes through `_locales` and `shared/i18n.js`, not hard-coded strings.
- [ ] I did not add permissions, network requests, analytics or remote code.
- [ ] I updated `CHANGELOG.md` for user-visible changes.
