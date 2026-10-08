// RTLY per-site config — grok-zai
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
  R["grok.com"] = {
    "inputs": [
      "textarea",
      "[contenteditable='true']"
    ],
    "responses": [
      "[role='main'] article",
      "[data-message-author-role='assistant']",
      "main"
    ],
    "layoutLtr": true
  };
  R["chat.z.ai"] = {
    "inputs": [
      "textarea",
      "[contenteditable='true']",
      "[contenteditable='']",
      "[contenteditable]:not([contenteditable='false'])",
      "[role='textbox']"
    ],
    "responses": [
      "[data-expanded]",
      "article",
      "[role='article']",
      ".message",
      "[class*='message']",
      "[class*='Message']",
      "[data-message]",
      "[data-role]",
      "[class*='bubble']",
      "[class*='Bubble']",
      "[class*='chat-message']",
      "[class*='ChatMessage']"
    ],
    "layoutLtr": true,
    "heuristicFaScan": true,
    "narrowIcons": true,
    "cleanupStaleMark": true
  };
  R["z.ai"] = {
    "inputs": [
      "textarea",
      "[contenteditable='true']",
      "[contenteditable='']",
      "[contenteditable]:not([contenteditable='false'])",
      "[role='textbox']"
    ],
    "responses": [
      "[data-expanded]",
      "article",
      "[role='article']",
      ".message",
      "[class*='message']",
      "[class*='Message']",
      "[data-message]",
      "[data-role]",
      "[class*='bubble']",
      "[class*='Bubble']",
      "[class*='chat-message']",
      "[class*='ChatMessage']"
    ],
    "layoutLtr": true,
    "heuristicFaScan": true,
    "narrowIcons": true,
    "cleanupStaleMark": true
  };
})();
