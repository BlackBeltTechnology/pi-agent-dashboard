// Package diagnostics channel (§6.17, viewer §7.16).
//
// Every warning produced during generation and validation is written to
// `diagnostics.json` inside the package so the viewer shell can surface it to an
// operator who only opens the served URL — no access to the generating terminal
// required.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const DIAGNOSTICS_FILE = 'diagnostics.json';

/**
 * Write the package diagnostics file.
 * @param pkgDir package root
 * @param payload { errors?, warnings?, diagnostics?, guard? } — arrays of
 *        { code, message } (or the guard's { code, elements, detail, corrective })
 */
export function writeDiagnostics(pkgDir, payload) {
  const norm = (arr) => (arr || []).map((x) =>
    x.detail
      ? { code: x.code, message: `${x.detail} → ${x.corrective}`, elements: x.elements }
      : { code: x.code, message: x.message, elements: x.elements });
  const out = {
    generatedAt: new Date().toISOString(),
    errors: norm(payload.errors),
    warnings: norm(payload.warnings),
    notes: norm(payload.diagnostics),
  };
  writeFileSync(join(pkgDir, DIAGNOSTICS_FILE), JSON.stringify(out, null, 2));
  return out;
}

export function readDiagnostics(pkgDir) {
  const p = join(pkgDir, DIAGNOSTICS_FILE);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
