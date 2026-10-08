import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXT = path.join(ROOT, 'extension');
export const ASSETS = path.join(ROOT, 'docs', 'assets');
export const SHOTS = path.join(ASSETS, 'screenshots');
export const STORE = path.join(ASSETS, 'store');
// intermediate captures (not deliverables)
export const RAW = path.join(os.tmpdir(), 'rtly-shots-raw');
export const furl = (p) => pathToFileURL(p).href;
