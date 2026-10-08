// Shared helpers for the build scripts: locate the repo, list shippable extension files, write zips.
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "./zip.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EXT_DIR = path.join(ROOT, "extension");
export const DIST_DIR = path.join(ROOT, "dist");

// Files that must never ship inside the extension package.
const EXCLUDED_NAMES = new Set(["Thumbs.db", "desktop.ini", "_metadata", "node_modules"]);
const EXCLUDED_FILE = /\.(md|map|zip|log|orig|rej|bak|tmp|psd|xcf|ai)$|~$/i;

export function isShippable(relPosix) {
  const parts = relPosix.split("/");
  // Dotfiles (.DS_Store, .gitkeep, ...) and dev-only names are skipped at every level.
  if (parts.some((p) => p.startsWith(".") || EXCLUDED_NAMES.has(p))) return false;
  return !EXCLUDED_FILE.test(parts[parts.length - 1]);
}

const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** Sorted list of shippable files in extension/, as posix paths relative to it. */
export function listExtensionFiles(dir = EXT_DIR) {
  const out = [];
  const walk = (abs, rel) => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(path.join(abs, ent.name), childRel);
      else if (ent.isFile() && isShippable(childRel)) out.push(childRel);
    }
  };
  walk(dir, "");
  return out.sort(byBytes);
}

export function readManifest() {
  return JSON.parse(readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
}

/**
 * Zip entries: extension files with manifest.json at the root (optionally replaced by
 * `manifestOverride`), plus LICENSE from the repo root when it exists.
 */
export function collectEntries({ manifestOverride } = {}) {
  const entries = [];
  for (const rel of listExtensionFiles()) {
    const data =
      rel === "manifest.json" && manifestOverride
        ? Buffer.from(JSON.stringify(manifestOverride, null, 2) + "\n", "utf8")
        : readFileSync(path.join(EXT_DIR, rel));
    entries.push({ name: rel, data });
  }
  const license = path.join(ROOT, "LICENSE");
  if (existsSync(license)) entries.push({ name: "LICENSE", data: readFileSync(license) });
  else console.warn("warning: LICENSE not found in the repo root; it will not be added to the zip.");
  entries.sort((a, b) => byBytes(a.name, b.name));
  return entries;
}

export function writeZip(entries, fileName) {
  mkdirSync(DIST_DIR, { recursive: true });
  const zip = createZip(entries);
  const outPath = path.join(DIST_DIR, fileName);
  writeFileSync(outPath, zip);
  const sha = createHash("sha256").update(zip).digest("hex");
  writeFileSync(`${outPath}.sha256`, `${sha}  ${fileName}\n`);
  return { outPath, size: zip.length, sha, count: entries.length };
}
