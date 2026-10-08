/*
 * RTLY — runtime-overridable footer navigation config
 *
 * Loaded as a classic (non-module) script BEFORE the deferred popup.js /
 * options.js modules. Sets window.FOOTER_NAV_CONFIG, which the footer
 * renderer reads at startup. If this file is absent or malformed, the
 * footer renderer falls back to its built-in DEFAULT_FOOTER_NAV_CONFIG.
 *
 * Per-item shape:
 *   id           : stable identifier (about | github | rate | support | ...)
 *   labelKey     : i18n key OR literal label (resolved at runtime)
 *   messageKey   : i18n key OR literal copy
 *   ctaLabelKey  : i18n key OR literal CTA label
 *   showCtaButton: false to render copy only (no button)
 *   url          : opened in a new tab when ctaLabelKey is clicked
 *   action       : "link" (open url) | "info" (no-op / inline copy)
 *
 * Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License.
 */
window.FOOTER_NAV_CONFIG = {
  autoRotate: true,
  rotateEveryMs: 5000,
  items: [
    {
      id: 'about',
      labelKey: 'footerNavAbout',
      messageKey: 'footerAboutCopy',
      ctaLabelKey: 'footerAboutCta',
      showCtaButton: true,
      url: 'https://www.enaloo.com',
      action: 'link'
    },
    {
      id: 'github',
      labelKey: 'footerNavGithub',
      messageKey: 'footerGithubCopy',
      ctaLabelKey: 'footerGithubCta',
      showCtaButton: true,
      url: 'https://github.com/ehsanenaloo/RTLY',
      action: 'link'
    },
    {
      id: 'rate',
      labelKey: 'footerNavRate',
      messageKey: 'footerRateCopy',
      ctaLabelKey: 'footerRateCta',
      showCtaButton: true,
      url: '',
      action: 'link'
    },
    {
      id: 'support',
      labelKey: 'footerNavSupport',
      messageKey: 'footerSupportCopy',
      ctaLabelKey: 'footerSupportCta',
      showCtaButton: true,
      url: 'https://buymeacoffee.com/enaloo',
      action: 'link'
    }
  ]
};
