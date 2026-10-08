// RTLY per-site config — aistudio
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
  R["aistudio.google.com"] = {
    "inputs": [
      "textarea",
      "[contenteditable='true']"
    ],
    "responses": [
      ".ms-text-chunk",
      ".chat-turn-container",
      "main [role='article']"
    ]
  };
})();
