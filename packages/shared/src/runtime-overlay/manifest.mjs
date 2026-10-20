/**
 * runtime-manifest.json — identity + compatibility declaration of one runtime
 * tree (the bundle, a staged overlay `versions/<X>/`).
 *
 * Plain ESM JavaScript (types in `manifest.d.mts`) so the build script
 * `packages/electron/scripts/bundle-server.mjs`, which runs under plain Node,
 * shares this exact reader/writer with the TypeScript runtime code.
 *
 * See change: electron-runtime-overlay-updates (D2, D6).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const RUNTIME_MANIFEST_FILE = "runtime-manifest.json";

const ORIGINS = new Set(["bundled", "npm", "github"]);
const INSTALL_MODES = new Set(["release-lock", "floating"]);

/** @param {unknown} raw */
export function parseRuntimeManifest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  for (const key of ["version", "minShellVersion", "nodeEngines"]) {
    if (typeof r[key] !== "string" || r[key] === "") return null;
  }
  if (typeof r.origin !== "string" || !ORIGINS.has(r.origin)) return null;
  for (const key of ["integrity", "piVersion"]) {
    if (r[key] !== undefined && typeof r[key] !== "string") return null;
  }
  // Bundle provenance (release-lock vs floating install). Optional; absent on
  // overlays and source-only bundles. See change: pin-electron-bundle-dependency-tree.
  if (r.installMode !== undefined && (typeof r.installMode !== "string" || !INSTALL_MODES.has(r.installMode))) return null;
  if (r.lockVersion !== undefined && typeof r.lockVersion !== "string") return null;
  return /** @type {import("./manifest.d.mts").RuntimeManifest} */ ({
    version: r.version,
    minShellVersion: r.minShellVersion,
    nodeEngines: r.nodeEngines,
    origin: r.origin,
    ...(r.integrity !== undefined ? { integrity: r.integrity } : {}),
    ...(r.piVersion !== undefined ? { piVersion: r.piVersion } : {}),
    ...(r.installMode !== undefined ? { installMode: r.installMode } : {}),
    ...(r.lockVersion !== undefined ? { lockVersion: r.lockVersion } : {}),
  });
}

/** @param {string} runtimeRoot */
export function readRuntimeManifest(runtimeRoot) {
  try {
    return parseRuntimeManifest(
      JSON.parse(readFileSync(path.join(runtimeRoot, RUNTIME_MANIFEST_FILE), "utf8")),
    );
  } catch {
    return null;
  }
}

/**
 * @param {string} runtimeRoot
 * @param {import("./manifest.d.mts").RuntimeManifest} manifest
 */
export function writeRuntimeManifest(runtimeRoot, manifest) {
  if (!parseRuntimeManifest(manifest)) {
    throw new Error(`invalid runtime manifest: ${JSON.stringify(manifest)}`);
  }
  mkdirSync(runtimeRoot, { recursive: true });
  const file = path.join(runtimeRoot, RUNTIME_MANIFEST_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(tmp, file);
}
