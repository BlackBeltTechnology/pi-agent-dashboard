#!/usr/bin/env node
// Standalone view of a single .bpmn/.dmn WITHOUT a manifest (§8.4). A DI-less
// .bpmn is laid out into a separate render artifact; the source is never touched.
//
//   node scripts/view-cli.mjs <file.bpmn|file.dmn> [renderOutDir]
//   → prints the render-root path (serve it with scripts/serve.mjs — CORS) or the refusal

import { assembleStandalone } from './render.mjs';

const [src, outDir] = process.argv.slice(2);
if (!src) { console.error('usage: node scripts/view-cli.mjs <file.bpmn|file.dmn> [renderOutDir]'); process.exit(1); }

const r = await assembleStandalone(src, outDir);
if (r.refused) {
  console.error('REFUSED — this file contains a construct the envelope rejects and has no DI:');
  for (const d of r.diagnostics) console.error(`  [${d.code}] ${d.message}`);
  process.exit(2);
}
console.log(r.renderRoot);
