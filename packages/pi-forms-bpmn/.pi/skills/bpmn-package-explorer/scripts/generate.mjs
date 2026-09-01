// Generation + display workflows (§8).
//
// The AGENT authors the semantics-only .bpmn files, the .dmn / .form artifacts
// and package.yaml (guided by the references). This module runs the mechanical
// pipeline over them, in order, each step failing loudly rather than degrading:
//
//   1. author semantics       (agent; validated here by the envelope)
//   2. author artifacts        (agent)
//   3. write package.yaml      (agent)
//   4. validate the manifest   ← stops before serving on error (8.2)
//   5. layout + layout guard   ← strict; aborts on a corrupt diagram
//   6. serve + canvas          (render.mjs / the skill)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { xmlHasDI } from './pipeline.mjs';
import { checkAuthored, authoringWarnings } from './envelope.mjs';
import { guardXml } from './runguard.mjs';
import { loadManifest, validatePackage } from './manifest.mjs';
import { writeDiagnostics } from './diagnostics.mjs';

export class WorkflowError extends Error {
  constructor(stage, detail) { super(`${stage}: ${JSON.stringify(detail)}`); this.stage = stage; this.detail = detail; }
}

/** The .bpmn files a package owns: entry + participant/process refs. */
export function packageBpmnFiles(manifest) {
  const files = new Set([manifest.entry]);
  for (const b of manifest.bindings || []) {
    if ((b.kind === 'process' || b.kind === 'participant') && b.ref) files.add(b.ref);
  }
  return [...files];
}

/**
 * Lay out one generated semantics-only .bpmn, verify strict, write DI back into
 * the file (it is a generated file, not an operator file). A file already
 * carrying DI is left untouched (D5: the file is the source of truth).
 */
export async function layoutGeneratedFile(pkgDir, relFile) {
  const p = join(pkgDir, relFile);
  const xml = readFileSync(p, 'utf8');
  if (xmlHasDI(xml)) return { file: relFile, skipped: true };
  const env = checkAuthored(xml);
  if (!env.ok) throw new WorkflowError('envelope', { file: relFile, diagnostics: env.diagnostics });
  const g = await guardXml(xml, { provenance: 'generated' });
  if (!g.result.ok) throw new WorkflowError('guard', { file: relFile, violations: g.result.violations });
  writeFileSync(p, g.laidOut);
  return { file: relFile, laidOut: true };
}

/**
 * Full build over an assembled package directory. Returns
 * { validation, laidOut }. Throws WorkflowError on envelope/guard failure;
 * returns validation.ok=false (without serving) on a manifest error (8.2).
 */
export async function buildPackage(pkgDir) {
  const { manifest, errors } = loadManifest(pkgDir);
  if (errors.length) throw new WorkflowError('manifest-parse', errors);

  // step 1: envelope-check every generated (DI-less) .bpmn before anything else
  const files = packageBpmnFiles(manifest).filter((f) => existsSync(join(pkgDir, f)));
  for (const f of files) {
    const xml = readFileSync(join(pkgDir, f), 'utf8');
    if (!xmlHasDI(xml)) {
      const env = checkAuthored(xml);
      if (!env.ok) throw new WorkflowError('envelope', { file: f, diagnostics: env.diagnostics });
    }
  }

  // step 4: validate the manifest — stop before serving on error
  const validation = await validatePackage(pkgDir);
  if (!validation.ok) { writeDiagnostics(pkgDir, validation); return { validation, laidOut: [] }; }

  // step 5: layout + guard (strict)
  const laidOut = [];
  for (const f of files) laidOut.push(await layoutGeneratedFile(pkgDir, f));

  // 8.8 — collect sendTask/receiveTask unlinked-counterpart warnings
  const authorWarn = [];
  for (const f of files) authorWarn.push(...authoringWarnings(readFileSync(join(pkgDir, f), 'utf8')).map((w) => ({ ...w, message: `${f}: ${w.message}` })));

  // re-validate after layout (element resolution unaffected, but keeps diagnostics fresh)
  const post = await validatePackage(pkgDir);
  post.warnings = [...post.warnings, ...authorWarn];
  writeDiagnostics(pkgDir, post);
  return { validation: post, laidOut };
}

// ── standalone view of a single file (§8.4, 8.5) ────────────────────────
/**
 * Prepare a standalone .bpmn/.dmn for viewing WITHOUT a manifest.
 * A DI-bearing file renders as authored (advisory). A DI-less .bpmn is laid out
 * strictly and written to a SEPARATE render artifact, never over the source.
 * Returns { renderXml, mode, refused?, diagnostics? }.
 */
export async function prepareStandalone(srcPath) {
  const xml = readFileSync(srcPath, 'utf8');
  if (srcPath.endsWith('.dmn')) return { renderXml: xml, mode: 'dmn' };
  const g = await guardXml(xml, { provenance: 'ingested' });
  if (g.refused) return { refused: true, diagnostics: g.diagnostics };
  return { renderXml: g.laidOut, mode: g.mode, warnings: g.result.warnings };
}
