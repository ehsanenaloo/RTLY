#!/usr/bin/env node
// Regenerate every screenshot / store graphic:   node scripts/screenshots/generate.mjs
//   --capture-only   only phase 1 (needs Chromium: npx playwright install chromium)
//   --compose-only   only phase 2 (re-uses the raw captures from the last capture run)
import { capture } from './capture.mjs';
const args = process.argv.slice(2);
if (!args.includes('--compose-only')) { console.log('capture...'); await capture(); }
if (!args.includes('--capture-only')) { const { compose } = await import('./compose.mjs'); console.log('compose...'); await compose(); }
console.log('done');
