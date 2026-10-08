// Prints dimensions / PNG colour type / size of every generated asset.   node scripts/screenshots/check.mjs
import fs from 'node:fs'; import path from 'node:path';
import { ASSETS, ROOT } from './paths.mjs'; import { pngInfo } from './png.mjs';
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk(ASSETS)) {
  const kb = (fs.statSync(f).size / 1024).toFixed(0) + 'KB';
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  if (f.endsWith('.png')) { const i = pngInfo(f); console.log(rel, `${i.width}x${i.height}`, i.colorType === 2 ? 'RGB24' : 'colorType' + i.colorType, kb); } else console.log(rel, kb);
}
