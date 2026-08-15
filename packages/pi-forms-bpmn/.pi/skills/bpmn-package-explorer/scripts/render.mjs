// Render-root assembly (§7.1) and display workflow (§8.3).
//
// Builds a directory that presents the shell, the package artifacts and the
// single shared asset root under ONE origin — the asset root as a SYMLINK, so
// the multi-megabyte payload is never duplicated per package (serve_mockup
// follows symlinks). Asset URLs in the shell are RELATIVE, so they survive an
// ephemeral port not known at generation time.
//
//   node scripts/render.mjs <packageDir> [outDir]
//   → assembles a render root and prints its path (serve it with serve_mockup)

import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, symlinkSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, validatePackage } from './manifest.mjs';
import { writeDiagnostics, DIAGNOSTICS_FILE } from './diagnostics.mjs';
import { prepareStandalone } from './generate.mjs';
import { basename } from 'node:path';

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS = join(SKILL, 'assets');
const SHELL = join(SKILL, 'templates', 'shell.html');

function walkFiles(dir, base = '') {
  const out = [];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${f.name}` : f.name;
    if (f.isDirectory()) out.push(...walkFiles(join(dir, f.name), rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Assemble a render root for a package directory.
 * @returns { renderRoot, data, validation }
 */
export async function assembleRenderRoot(pkgDir, outDir) {
  const { manifest } = loadManifest(pkgDir);
  if (!manifest) throw new Error(`no valid package.yaml in ${pkgDir}`);
  const validation = await validatePackage(pkgDir);

  const renderRoot = outDir || mkdtempSync(join(tmpdir(), 'bpmn-render-'));
  mkdirSync(renderRoot, { recursive: true });

  // 1) shared asset root as a symlink (no payload duplication)
  const assetLink = join(renderRoot, 'assets');
  if (existsSync(assetLink)) rmSync(assetLink, { recursive: true, force: true });
  symlinkSync(ASSETS, assetLink, 'dir');

  // 2) package artifacts, symlinked into the render root preserving structure
  for (const rel of walkFiles(pkgDir)) {
    if (rel === DIAGNOSTICS_FILE) continue;
    const src = join(pkgDir, rel);
    const dst = join(renderRoot, rel);
    mkdirSync(dirname(dst), { recursive: true });
    if (existsSync(dst)) rmSync(dst, { force: true });
    symlinkSync(src, dst);
  }

  // 3) shell + viewer script
  copyFileSync(SHELL, join(renderRoot, 'index.html'));
  copyFileSync(join(SKILL, 'templates', 'viewer.js'), join(renderRoot, 'viewer.js'));

  // 4) package-data.json — everything the shell needs, no filesystem walk in JS
  writeDiagnostics(renderRoot, validation);
  const data = {
    name: manifest.name,
    entry: manifest.entry,
    bindings: (validation.updatedManifest || manifest).bindings || [],
    roles: (validation.updatedManifest || manifest).roles || [],
    diagnostics: readJson(join(renderRoot, DIAGNOSTICS_FILE)),
    // §7.19 — only load the form renderer when it is actually vendored, so an
    // absent renderer never produces a 404 / console error.
    formsRenderer: existsSync(join(ASSETS, 'openforms', 'openforms-mui.iife.js')),
  };
  writeFileSync(join(renderRoot, 'package-data.json'), JSON.stringify(data, null, 2));

  return { renderRoot, data, validation };
}

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }

/**
 * Assemble a render root for a STANDALONE .bpmn/.dmn with no manifest (§8.4–8.6).
 * The source file is NEVER overwritten: a DI-less .bpmn is laid out into a
 * separate render artifact written only inside the render root.
 * @returns { renderRoot } or { refused, diagnostics }
 */
export async function assembleStandalone(srcPath, outDir) {
  const prep = await prepareStandalone(srcPath);
  if (prep.refused) return { refused: true, diagnostics: prep.diagnostics };

  const renderRoot = outDir || mkdtempSync(join(tmpdir(), 'bpmn-standalone-'));
  mkdirSync(renderRoot, { recursive: true });
  const assetLink = join(renderRoot, 'assets');
  if (existsSync(assetLink)) rmSync(assetLink, { recursive: true, force: true });
  symlinkSync(ASSETS, assetLink, 'dir');

  const isDmn = srcPath.endsWith('.dmn');
  const entry = isDmn ? 'entry.dmn' : 'entry.bpmn';
  writeFileSync(join(renderRoot, entry), prep.renderXml); // separate render artifact
  copyFileSync(SHELL, join(renderRoot, 'index.html'));
  copyFileSync(join(SKILL, 'templates', 'viewer.js'), join(renderRoot, 'viewer.js'));

  const data = {
    name: basename(srcPath),
    entry,
    entryKind: isDmn ? 'dmn' : 'bpmn',
    bindings: [], roles: [],
    formsRenderer: existsSync(join(ASSETS, 'openforms', 'openforms-mui.iife.js')),
    diagnostics: { errors: [], warnings: (prep.warnings || []).map((w) => ({ code: w.code, message: w.detail ? w.detail : w.message })), notes: [] },
  };
  writeFileSync(join(renderRoot, 'package-data.json'), JSON.stringify(data, null, 2));
  return { renderRoot };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [pkgDir, outDir] = process.argv.slice(2);
  if (!pkgDir) { console.error('usage: node scripts/render.mjs <packageDir> [outDir]'); process.exit(1); }
  const { renderRoot, validation } = await assembleRenderRoot(pkgDir, outDir);
  if (!validation.ok) {
    console.error('VALIDATION FAILED — not serving:');
    for (const e of validation.errors) console.error(`  [${e.code}] ${e.message}`);
    process.exit(1);
  }
  console.log(renderRoot);
}
