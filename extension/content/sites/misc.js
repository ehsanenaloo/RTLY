// RTLY per-site config — misc
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
  R["bing.com"] = {
    "inputs": [
      "textarea",
      "[contenteditable='true']",
      "[role='textbox']"
    ],
    "responses": [
      "article",
      "[role='article']",
      ".message",
      "[data-message]",
      "main [role='main']",
      "[class*='message']",
      "[class*='response']"
    ],
    "layoutLtr": true
  };
  R["mistral.ai"] = {
    "inputs": [
      "textarea",
      "[contenteditable='true']"
    ],
    "responses": [
      "article",
      "[role='article']",
      ".message",
      "[data-message]",
      "main",
      "[class*='message']",
      "[class*='Message']",
      "[class*='response']"
    ],
    "layoutLtr": true
  };
  R["huggingface.co"] = {
    "inputs": [
      "textarea",
      "[contenteditable='true']"
    ],
    "responses": [
      "article",
      "[role='article']",
      ".message",
      "[data-message]",
      "main",
      "[class*='message']",
      "[class*='chat']"
    ],
    "layoutLtr": true
  };
  R["cohere.com"] = {
    "inputs": [
      "textarea",
      "[contenteditable='true']"
    ],
    "responses": [
      "article",
      "[role='article']",
      ".message",
      "[data-message]",
      "main",
      "[class*='message']",
      "[class*='response']"
    ],
    "layoutLtr": true
  };
})();
