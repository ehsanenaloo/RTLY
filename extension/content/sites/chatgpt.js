// RTLY per-site config — chatgpt
//
// Declarative per-site config: selectors (inputs/responses) and behavior
// flags. Loaded by the manifest BEFORE content.js, which reads
// window.RTLY_SITE_CONFIG. Only this site's hosts live here.
// Flags (all optional, default false):
//   layoutLtr             keep top-level layout LTR even on Persian content
//   heuristicFaScan       run the extra scan-anything-with-Persian pass
//   narrowIcons           restrict the icon-suppression guard to interactive controls
//   cleanupStaleMark      sweep stale data-rtly-processed marks on bootstrap
//   comprehensiveSelectors  response selectors cover the whole conversation
//                           (user + assistant), so content.js skips the generic
//                           whole-main fallback FA scan — the O(all-nodes)
//                           per-tick cost behind the ChatGPT freeze.
(function () {
  "use strict";
  var R = (window.RTLY_SITE_CONFIG = window.RTLY_SITE_CONFIG || {});
  R["chat.openai.com"] = {
    "inputs": [
      "#prompt-textarea",
      "textarea",
      "[contenteditable='true']"
    ],
    "responses": [
      "[data-message-author-role='assistant']",
      "article[data-message-author-role='assistant']",
      ".markdown",
      "[data-message-author-role='user']"
    ],
    "comprehensiveSelectors": true
  };
  R["chatgpt.com"] = {
    "inputs": [
      "#prompt-textarea"
    ],
    "responses": [
      "[data-message-author-role='assistant']",
      "article[data-message-author-role='assistant']",
      ".markdown",
      "[data-message-author-role='user']"
    ],
    "comprehensiveSelectors": true
  };
})();
