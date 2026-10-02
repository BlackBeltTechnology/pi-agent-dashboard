/**
 * Version-skew detection for pi-coding-agent.
 *
 * Reads `piCompatibility` from `packages/server/package.json` and the
 * currently-resolved pi version from its `package.json`, then populates
 * `bootstrapState.compatibility` with hints the UI banner uses to show
 * upgrade suggestions.
 *
 * See change: unified-bootstrap-install \u00a79.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  isAbove,
  isBelow,
  parseVersion,
  PI_COMPATIBILITY_FALLBACK,
  readPiCompatibilityRange,
} from "@blackbelt-technology/pi-dashboard-shared/pi-installs/index.js";
import { getDefaultRegistry, type ToolRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";

// The version comparators moved to `shared/pi-installs/versions.ts` so the
// shared enumerator + override validator can use them. Re-exported here so
// this module's public surface is unchanged.
// See change: select-pi-runtime-install (design D11).
export {
  compareVersions,
  isAbove,
  isBelow,
  parseVersion,
} from "@blackbelt-technology/pi-dashboard-shared/pi-installs/index.js";

/**
 * Pi version compatibility snapshot.
 *
 * Previously declared in `./bootstrap-state.js`; moved here under change:
 * eliminate-electron-runtime-install (task 3.6) once the bootstrap-state
 * store was removed. The shape stays stable so consumers (CLI version
 * skew log, future UI version-skew banner for standalone arm) keep
 * compiling.
 */
export interface BootstrapCompatibility {
  /** Minimum pi version supported by this dashboard server. */
  minimum: string;
  /** Recommended pi version; below = soft warning, above = OK. */
  recommended: string;
  /** Maximum supported pi version, or `null` for unbounded. */
  maximum: string | null;
  /** Currently-resolved pi version (or `undefined` if pi unresolvable). */
  current?: string;
  /** Set when `current < recommended`. */
  upgradeRecommended?: boolean;
  /** Set when `current > maximum`. */
  upgradeDashboard?: boolean;
  /** Set when `current < minimum`; names both the running and required versions. */
  error?: string;
}

/**
 * Read the server's declared compatibility range from its own package.json.
 * Falls back to the hard-coded defaults when the field is missing or
 * malformed (shouldn't happen in practice).
 */
export function readPiCompatibility(serverPkgJsonPath: string): Pick<
  BootstrapCompatibility,
  "minimum" | "recommended" | "maximum"
> {
  return readPiCompatibilityRange(serverPkgJsonPath) ?? PI_COMPATIBILITY_FALLBACK;
}

/**
 * Read the currently-resolved pi version from `<pi-module>/../package.json`.
 * Returns undefined when pi isn't resolvable or the package.json can't
 * be parsed.
 */
export function readCurrentPiVersion(registry: ToolRegistry = getDefaultRegistry()): string | undefined {
  try {
    const req = createRequire(import.meta.url);
    let pkgJson: string | undefined;
    for (const name of ["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent"]) {
      try {
        pkgJson = req.resolve(`${name}/package.json`);
        break;
      } catch { /* try next alias */ }
    }
    if (pkgJson) {
      const raw = fs.readFileSync(pkgJson, "utf8");
      const parsed = JSON.parse(raw) as { version?: string };
      if (typeof parsed.version === "string") return parsed.version;
    }
  } catch {
    /* not resolvable yet */
  }
  // Fall back to the registry's resolved path + ../package.json.
  // `where` / `which` strategies typically return a symlinked npm bin
  // launcher (e.g. ~/.nvm/.../bin/pi → ../lib/node_modules/@mariozechner/
  // pi-coding-agent/dist/cli.js). Realpath the result first so the
  // dirname math lands on the real pi module directory, not the
  // bin-containing Node install prefix. See change: warn-pi-version-skew-in-cli.
  try {
    const res = registry.resolve("pi");
    if (res.ok && res.path) {
      let resolvedPath: string;
      try {
        resolvedPath = fs.realpathSync(res.path);
      } catch {
        return undefined;
      }
      const candidate = path.join(path.dirname(path.dirname(resolvedPath)), "package.json");
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, "utf8");
        const parsed = JSON.parse(raw) as { version?: string };
        if (typeof parsed.version === "string") return parsed.version;
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * A whole-string SemVer: `x.y.z`, optional `v`, optional `-prerelease` and
 * `+build`. Anchored at both ends — the shared `parseVersion` accepts a
 * numeric PREFIX (`0.99.9garbage`), which must not count as a version.
 * See change: update-pi-core-1-0-adopt-apis (review round 2 B1).
 */
const STRICT_VERSION_RE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Floor check with SemVer pre-release precedence: below when the triplet is
 * below, or equal with a `-prerelease` (`1.0.0-beta.1` < `1.0.0`); build
 * metadata never lowers precedence. Local to this module so the shared
 * `isBelow` keeps its behaviour for its other callers.
 * See change: update-pi-core-1-0-adopt-apis (review B1, round 2 B2).
 */
function isBelowFloor(version: string, minimum: string): boolean {
  if (isBelow(version, minimum)) return true;
  const isPrerelease = /^[^+]*-/.test(version.trim().replace(/^v/, ""));
  return isPrerelease && compareVersions(version, minimum) === 0;
}

/**
 * Compute the `compatibility` snapshot from a compatibility range and
 * the current pi version (or undefined when not yet installed). Pure
 * function \u2014 all I/O is done by callers.
 */
export function computeCompatibility(
  range: Pick<BootstrapCompatibility, "minimum" | "recommended" | "maximum">,
  current: string | undefined,
): BootstrapCompatibility {
  const out: BootstrapCompatibility = { ...range, current };
  if (!current) return out;
  if (isBelowFloor(current, range.minimum)) {
    // Below minimum: hard advisory. Signal via both `upgradeRecommended`
    // (soft flag, kept for back-compat) and a populated `error` string
    // naming both versions, which drives the red advisory state.
    out.upgradeRecommended = true;
    out.error = `pi ${current} is below the minimum supported version ${range.minimum}; upgrade pi to at least ${range.minimum}.`;
    return out;
  }
  if (isBelow(current, range.recommended)) {
    out.upgradeRecommended = true;
  }
  if (range.maximum && isAbove(current, range.maximum)) {
    out.upgradeDashboard = true;
  }
  return out;
}

/**
 * Below-floor flag for a session, from its bridge-reported `piVersion` and the
 * lockstep floor (`piCompatibility.minimum`). Returns `{ minimum }` (the
 * required version, for the warning) when the version parses AND is below the
 * floor; `null` otherwise — an unreported or unparseable version raises no
 * flag. `null` (not `undefined`) so a `session_updated` patch CLEARS a stale
 * flag under the client's shallow merge. Pure.
 * See change: update-pi-core-1-0-adopt-apis (D2).
 */
export function computePiBelowFloor(
  version: string | undefined,
  minimum: string,
): { minimum: string } | null {
  if (!version || !STRICT_VERSION_RE.test(version.trim())) return null;
  return isBelowFloor(version, minimum) ? { minimum } : null;
}

let cachedMinimum: string | undefined;

/**
 * The server's own `piCompatibility.minimum` (`packages/server/package.json`),
 * read once — the same single source `/api/health` uses. Falls back to the
 * shared defaults when unreadable.
 */
export function serverPiMinimum(): string {
  cachedMinimum ??= readPiCompatibility(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../package.json"),
  ).minimum;
  return cachedMinimum;
}
