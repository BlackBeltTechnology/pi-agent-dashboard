#!/usr/bin/env node
// Build a package (envelope → manifest validation → layout + guard) and assemble
// a render root ready to serve. Fails loudly; stops before serving on any error.
//
//   node scripts/generate-cli.mjs <packageDir> [renderOutDir]
//   → prints the render-root path on success (serve it with serve_mockup)

import { buildPackage, WorkflowError } from './generate.mjs';
import { assembleRenderRoot } from './render.mjs';

const [pkgDir, outDir] = process.argv.slice(2);
if (!pkgDir) { console.error('usage: node scripts/generate-cli.mjs <packageDir> [renderOutDir]'); process.exit(1); }

try {
  const { validation } = await buildPackage(pkgDir);
  if (!validation.ok) {
    console.error('MANIFEST VALIDATION FAILED — not serving:');
    for (const e of validation.errors) console.error(`  [${e.code}] ${e.message}`);
    process.exit(2);
  }
  for (const w of validation.warnings) console.error(`  warning [${w.code}] ${w.message}`);
  const { renderRoot } = await assembleRenderRoot(pkgDir, outDir);
  console.log(renderRoot);
} catch (e) {
  if (e instanceof WorkflowError) {
    console.error(`PIPELINE ABORTED at stage '${e.stage}':`);
    console.error(JSON.stringify(e.detail, null, 2));
    process.exit(3);
  }
  throw e;
}
