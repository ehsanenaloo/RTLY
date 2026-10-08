// RTLY per-site config — copilot
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
  R["copilot.microsoft.com"] = {
    "inputs": [
      "#userInput",
      "textarea",
      "[contenteditable='true']"
    ],
    "responses": [
      "[data-content='ai-message']",
      ".ai-message-content"
    ]
  };
  // Copilot moved to copilot.com (bing.com/chat redirects there); same selectors.
  R["copilot.com"] = R["copilot.microsoft.com"];
})();
