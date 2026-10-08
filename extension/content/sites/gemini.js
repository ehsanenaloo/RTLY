// RTLY per-site config — gemini
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
  R["gemini.google.com"] = {
    "inputs": [
      ".ql-editor.textarea",
      "[contenteditable='true']",
      "textarea",
      "[contenteditable]",
      ".ql-editor",
      "[role='textbox']",
      "div[contenteditable='true']"
    ],
    "responses": [
      ".message-content",
      "[data-message-content]",
      ".markdown",
      "main article",
      "[data-qa*='message']",
      "[role='article']",
      "[data-md]",
      "[data-text]",
      ".prose",
      "article",
      ".message",
      "[data-message]",
      "[data-role='assistant']",
      "[data-role='user']",
      "div[data-message]",
      "div[role='article']",
      "main div[role='article']",
      "main > div > div",
      "[class*='message']",
      "[class*='Message']",
      "[class*='response']",
      "[class*='Response']",
      "user-query",
      "user-query-content",
      "model-response",
      "model-response-text",
      "[class*='user-query' i]",
      "[class*='query-text' i]",
      "[class*='query-content' i]",
      "[class*='luminous-prompt-bubble' i]",
      "[class*='user-query-bubble' i]",
      "[data-test-id*='luminous' i]",
      "[data-test-id*='collapsed-bubble' i]",
      "[data-test-id*='user-query' i]"
    ],
    "narrowIcons": true
  };
})();
