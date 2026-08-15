#!/usr/bin/env node
// Maintenance / re-vendoring workflow for bpmn-package-explorer.
//
// Reproduces every vendored asset from PINNED inputs. It is NOT run at use
// time; it is run by a maintainer upgrading a bundle. The buildless contract
// governs *use* time (generate + render need no install, no bundler, no
// network); this script is the vendoring-time build that produces the
// self-contained Node module.
//
// Contract:
//   * Browser bundles (bpmn-js, dmn-js) are copied verbatim and hash-compared
//     against the published artifact (whole-file identity).
//   * The Node closure is bundled into ONE self-contained ESM module with
//     esbuild. That output is a BUILD ARTIFACT, so its INPUTS are hash-recorded
//     (see PINS below and assets/VENDORED.md) rather than the output being
//     compared to a published file.
//   * After re-vendoring, scripts/fixtures.mjs MUST be run and its result
//     recorded before the change is accepted (upstream drift detector).
//
// Usage:  node scripts/vendor.mjs            # verify current vendored hashes
//         node scripts/vendor.mjs --rebuild  # re-install pinned inputs + rebuild
//
// A --rebuild needs npm + network + esbuild; plain verify is offline.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS = join(SKILL, 'assets');

// ─── PINS ─── exact versions, never a range. Mirrors assets/VENDORED.md.
export const PINS = {
  browser: {
    'bpmn-js': '18.24.0',
    'dmn-js': '17.10.1',
  },
  node: {
    'bpmn-auto-layout': '1.3.0',
    'bpmn-moddle': '10.1.0',
    moddle: '8.2.1',
    'moddle-xml': '12.1.0',
    'min-dash': '5.1.0',
    saxen: '11.1.1',
    yaml: '2.9.0',
  },
  esbuild: '0.24.0',
  nodeFloor: '20.12', // strictest engines.node in the closure (bpmn-moddle, saxen)
};

// Whole-file hashes recorded at vendoring time.
//   browser: hash of the copied published bundle (identity check).
//   nodeInputs: hash of each package's published dist/index.js — the ESBUILD
//               INPUTS, recorded because the bundle is a build output.
export const HASHES = {
  browser: {
    'assets/bpmn-js/bpmn-navigated-viewer.production.min.js':
      'e815dba42e3864eafc1621fab15e9c22e8ebcd07cf1e89650a9ca4ad2fe45f49',
    'assets/dmn-js/dmn-viewer.production.min.js':
      '0e3e4504b17bad6b570b93441807d4b322a1e10b33452b80497177499a8d72b9',
  },
  nodeInputs: {
    'bpmn-auto-layout/dist/index.js':
      '1443e3f710c45db7bf4cdcfcb960fe48a5e0cae8214a1451deca5784424e211e',
    'bpmn-moddle/dist/index.js':
      'ece57e2fae965e1372cfb21b983fba06818c318ad0d35b6b8b8b6da2e27a0c9b',
    'moddle/dist/index.js':
      'fc20cb48373cf2a6e09143492626dbc77efb8d8e3660a9e132b5bc9dcb7a558c',
    'moddle-xml/dist/index.js':
      '35480f3eb2f0baf57d1f07e812ae47b65df68217e273b427ed07f2d442e7da14',
    'min-dash/dist/index.js':
      '0eacee75abc8df5349304a6c1a7377f3d36142cb182cbb95c2227ca8a3349a7c',
    'saxen/dist/index.js':
      '6303cae8a9787409db5671c958897ec8e5a3bf9e26f4b490c760b4d6d4257279',
    'yaml/dist/index.js':
      '2d58984e0ae80de4acbd8f009fab332f5ce77d9e1a5f138a3058a0ada6567fb9',
  },
};

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function verify() {
  let failed = 0;
  for (const [rel, expected] of Object.entries(HASHES.browser)) {
    const p = join(SKILL, rel);
    if (!existsSync(p)) { console.error(`MISSING ${rel}`); failed++; continue; }
    const got = sha256(p);
    const ok = got === expected;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${rel}`);
    if (!ok) { console.error(`  expected ${expected}\n  got      ${got}`); failed++; }
  }
  const pipeline = join(ASSETS, 'lib', 'bpmn-pipeline.mjs');
  console.log(existsSync(pipeline) ? `OK   assets/lib/bpmn-pipeline.mjs present` : 'FAIL bundle missing');
  if (!existsSync(pipeline)) failed++;
  if (failed) { console.error(`\n${failed} vendored asset(s) failed verification`); process.exit(1); }
  console.log('\nAll vendored browser bundles match their recorded hashes.');
}

function rebuild() {
  const tmp = execSync('mktemp -d /tmp/bpmn-vendor.XXXXXX').toString().trim();
  console.log(`vendor workspace: ${tmp}`);
  const spec = [
    ...Object.entries(PINS.browser),
    ...Object.entries(PINS.node),
  ].map(([n, v]) => `${n}@${v}`).join(' ');
  execSync(`cd ${tmp} && npm init -y >/dev/null && npm install --no-audit --no-fund ${spec}`, { stdio: 'inherit' });
  const nm = join(tmp, 'node_modules');

  // Browser copies
  const cp = (from, to) => execSync(`cp -R ${join(nm, from)} ${join(SKILL, to)}`);
  cp('bpmn-js/dist/bpmn-navigated-viewer.production.min.js', 'assets/bpmn-js/');
  cp('bpmn-js/dist/assets/diagram-js.css', 'assets/bpmn-js/');
  execSync(`cp ${join(nm, 'bpmn-js/dist/assets/bpmn-js.css')} ${join(SKILL, 'assets/bpmn-js/bpmn.css')}`);
  cp('bpmn-js/dist/assets/bpmn-font', 'assets/bpmn-js/');
  cp('dmn-js/dist/dmn-viewer.production.min.js', 'assets/dmn-js/');
  for (const css of ['diagram-js.css', 'dmn-js-shared.css', 'dmn-js-drd.css',
    'dmn-js-decision-table.css', 'dmn-js-literal-expression.css']) {
    cp(`dmn-js/dist/assets/${css}`, 'assets/dmn-js/');
  }
  cp('dmn-js/dist/assets/dmn-font', 'assets/dmn-js/');

  // Node closure bundle (build output)
  const entry = join(tmp, 'entry.mjs');
  execSync(`printf '%s\\n' "export { layoutProcess } from 'bpmn-auto-layout';" "export { BpmnModdle } from 'bpmn-moddle';" > ${entry}`);
  execSync(`cd ${tmp} && npx --yes esbuild@${PINS.esbuild} entry.mjs --bundle --format=esm --platform=node --target=node${PINS.nodeFloor} --legal-comments=none --outfile=${join(ASSETS, 'lib', 'bpmn-pipeline.mjs')}`, { stdio: 'inherit' });

  // YAML parser bundle (createRequire banner so CJS require('process') resolves)
  const yentry = join(tmp, 'yaml-entry.mjs');
  execSync(`printf "export { parse, parseDocument, Document } from 'yaml';\\n" > ${yentry}`);
  execSync(`cd ${tmp} && npx --yes esbuild@${PINS.esbuild} yaml-entry.mjs --bundle --format=esm --platform=node --target=node${PINS.nodeFloor} --legal-comments=none --banner:js='import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);' --outfile=${join(ASSETS, 'lib', 'yaml.mjs')}`, { stdio: 'inherit' });

  console.log('\nRebuild complete. Now run: node scripts/fixtures.mjs  (record the outcome before accepting).');
  verify();
}

if (process.argv.includes('--rebuild')) rebuild();
else verify();
