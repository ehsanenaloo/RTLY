// RTLY per-site config — claude
//
// Declarative per-site config: selectors (inputs/responses) and behavior
// flags. Loaded by the manifest BEFORE content.js, which reads
// window.RTLY_SITE_CONFIG. Only this site's hosts live here.
// Flags (all optional, default false):
//   layoutLtr        keep top-level layout LTR even on Persian content
//   heuristicFaScan  run the extra scan-anything-with-Persian pass
//   narrowIcons      restrict the icon-suppression guard to interactive controls
//   cleanupStaleMark sweep stale data-rtly-processed marks on bootstrap
(function () {
  "use strict";
  var R = (window.RTLY_SITE_CONFIG = window.RTLY_SITE_CONFIG || {});
  R["claude.ai"] = {
    "inputs": [
      ".ProseMirror.break-words",
      "[contenteditable='true']",
      "textarea"
    ],
    "responses": [
      ".font-claude-response",
      "[data-testid='user-message']",
      ".standard-markdown",
      ".font-claude-message",
      "[data-testid='message-content']",
      "[data-testid*='message']",
      ".ProseMirror",
      "article",
      "[role='article']",
      "main article",
      ".message"
    ],
    "layoutLtr": true,
    "heuristicFaScan": true,
    "narrowIcons": true,
    "cleanupStaleMark": true
  };
})();
