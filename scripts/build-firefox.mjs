#!/usr/bin/env node
// Build dist/rtly-<version>-firefox.zip from extension/ without touching extension/manifest.json.
// Manifest changes for Firefox (still Manifest V3):
//   - background.service_worker becomes background.scripts (Firefox runs an MV3 event page)
//   - browser_specific_settings.gecko gets the add-on id, strict_min_version and
//     data_collection_permissions
//   - minimum_chrome_version is removed (Chrome-only key)
// The code uses chrome.* callbacks, which Firefox MV3 supports, and guards newer APIs
// (chrome.action.setBadgeTextColor is called with optional chaining inside try/catch).
//   node scripts/build-firefox.mjs          build the zip (+ .sha256 file)
//   node scripts/build-firefox.mjs --list   print the files that would be packaged
import { pathToFileURL } from "node:url";
import { collectEntries, readManifest, writeZip } from "./lib/package-files.mjs";

export const GECKO_ID = "rtly@enaloo.com";
export const GECKO_MIN_VERSION = "128.0";

export function toFirefoxManifest(source) {
  const m = structuredClone(source);
  if (m.manifest_version !== 3) throw new Error("Expected a Manifest V3 source manifest");
  const worker = m.background?.service_worker;
  if (!worker) throw new Error("manifest.json has no background.service_worker to convert");
  m.background = { scripts: [worker] };
  delete m.minimum_chrome_version;
  m.browser_specific_settings = {
    ...m.browser_specific_settings,
    gecko: {
      ...m.browser_specific_settings?.gecko,
      id: GECKO_ID,
      strict_min_version: GECKO_MIN_VERSION,
      data_collection_permissions: { required: ["none"] },
    },
  };
  return m;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = readManifest();
  const entries = collectEntries({ manifestOverride: toFirefoxManifest(manifest) });
  if (process.argv.includes("--list")) {
    for (const e of entries) console.log(e.name);
    process.exit(0);
  }
  const { outPath, size, sha, count } = writeZip(entries, `rtly-${manifest.version}-firefox.zip`);
  console.log(`Firefox package: ${outPath}`);
  console.log(`${count} files, ${size} bytes, sha256 ${sha}`);
}
