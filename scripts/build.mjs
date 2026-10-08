#!/usr/bin/env node
// Build dist/rtly-<version>-chrome.zip (also valid for Microsoft Edge).
// manifest.json sits at the zip root; the output is deterministic. No dependencies.
//   node scripts/build.mjs          build the zip (+ .sha256 file)
//   node scripts/build.mjs --list   print the files that would be packaged
import { collectEntries, readManifest, writeZip } from "./lib/package-files.mjs";

const manifest = readManifest();
const entries = collectEntries();

if (process.argv.includes("--list")) {
  for (const e of entries) console.log(e.name);
  process.exit(0);
}
if (!entries.some((e) => e.name === "manifest.json")) throw new Error("manifest.json is missing");

const { outPath, size, sha, count } = writeZip(entries, `rtly-${manifest.version}-chrome.zip`);
console.log(`Chrome/Edge package: ${outPath}`);
console.log(`${count} files, ${size} bytes, sha256 ${sha}`);
