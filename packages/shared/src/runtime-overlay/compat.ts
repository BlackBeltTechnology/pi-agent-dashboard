/**
 * Runtime compatibility gate + preflight (Electron, before spawn). Pure.
 *
 *   - `evaluateRuntimeCandidate` — manifest `minShellVersion <= shell` AND the
 *     shell's bundled Node satisfies `nodeEngines` (node-pty 1.x is N-API, so
 *     a range check, not equality).
 *   - `preflightOverlay` / `preflightLocal` — the required files exist.
 *
 * Local link Node rule (spike 1.2 deferred, conservative choice): a linked
 * checkout ALWAYS runs under the shell's bundled Node — never system Node —
 * and is refused when that Node falls outside the checkout's root
 * `package.json#engines.node` (the caller passes that range as `nodeEngines`).
 *
 * See change: electron-runtime-overlay-updates (D6).
 */
import path from "node:path";
import semver from "semver";
import type { RuntimeManifest } from "./manifest.mjs";

export type RuntimeGateResult =
  | { ok: true }
  | { ok: false; code: "requires_app" | "node_engines" | "invalid_manifest" | "missing_file"; message: string; path?: string };

export function evaluateRuntimeCandidate(input: {
  manifest: RuntimeManifest | null;
  shellVersion: string;
  nodeVersion: string;
}): RuntimeGateResult {
  const { manifest } = input;
  if (!manifest) return { ok: false, code: "invalid_manifest", message: "invalid_manifest" };

  const shell = semver.coerce(input.shellVersion, { includePrerelease: true });
  const minShell = semver.valid(manifest.minShellVersion);
  if (!shell || !minShell) {
    return { ok: false, code: "invalid_manifest", message: `invalid_manifest minShellVersion ${manifest.minShellVersion}` };
  }
  if (semver.lt(shell, minShell)) {
    return { ok: false, code: "requires_app", message: `requires_app >=${minShell}` };
  }

  const node = semver.clean(input.nodeVersion) ?? semver.coerce(input.nodeVersion)?.version ?? null;
  const range = semver.validRange(manifest.nodeEngines);
  if (!node || !range || !semver.satisfies(node, range, { includePrerelease: true })) {
    return { ok: false, code: "node_engines", message: `node_engines ${manifest.nodeEngines}` };
  }
  return { ok: true };
}

const SCOPE = "@blackbelt-technology";

/** Required paths of a staged overlay root (`versions/<X>/`). Web client resolved like `client-dist.ts` (package `dist/`). */
export function overlayRequiredPaths(root: string): string[] {
  return [
    path.join(root, "node_modules", SCOPE, "pi-dashboard-server", "src", "cli.ts"),
    path.join(root, "node_modules", SCOPE, "pi-dashboard-web", "dist", "index.html"),
    path.join(root, "node_modules", SCOPE, "pi-dashboard-extension", "src", "bridge.ts"),
    path.join(root, "resources", "plugins"),
  ];
}

/** Required paths of a linked monorepo checkout. */
export function localRequiredPaths(root: string): string[] {
  return [
    path.join(root, "packages", "server", "src", "cli.ts"),
    path.join(root, "packages", "client", "dist", "index.html"),
    path.join(root, "packages", "extension", "src", "bridge.ts"),
    path.join(root, "node_modules"),
  ];
}

function firstMissing(paths: string[], exists: (p: string) => boolean, hint: (p: string) => string): RuntimeGateResult {
  for (const p of paths) {
    if (!exists(p)) return { ok: false, code: "missing_file", path: p, message: `missing_file ${p}${hint(p)}` };
  }
  return { ok: true };
}

export function preflightOverlay(root: string, exists: (p: string) => boolean): RuntimeGateResult {
  return firstMissing(overlayRequiredPaths(root), exists, () => "");
}

export function preflightLocal(root: string, exists: (p: string) => boolean): RuntimeGateResult {
  const [, clientIndex, , nodeModules] = localRequiredPaths(root);
  return firstMissing(localRequiredPaths(root), exists, (p) =>
    p === clientIndex
      ? " — build the web client with `npm run build` in the checkout"
      : p === nodeModules
        ? " — install dependencies with `pnpm install` in the checkout"
        : "",
  );
}
