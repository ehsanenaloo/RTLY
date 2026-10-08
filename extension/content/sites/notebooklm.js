// RTLY per-site config — notebooklm
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
  R["notebooklm.google.com"] = {
    "inputs": [
      "textarea",
      "[contenteditable='true']"
    ],
    "responses": [
      ".conversation",
      ".message",
      "main [data-message]",
      "[data-testid*='chat-message']",
      "[data-message-role]",
      "main article",
      "[data-qa*='message']",
      "[data-testid*='message']",
      ".lm-message",
      ".lm-chat-message"
    ]
  };
})();
