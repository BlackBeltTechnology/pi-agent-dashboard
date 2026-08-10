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
import path from "node:path";
import { createRequire } from "node:module";
import { getDefaultRegistry, type ToolRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";

/**
 * Parse a semver-ish string into its three numeric segments. Returns
 * null when the string doesn't match `<n>.<n>.<n>` (with optional
 * pre-release / build suffix which we ignore for comparison). This is
 * deliberately minimal \u2014 pi versions have always been `0.x.y` and we
 * don't want to pull in the `semver` dep.
 */
export function parseVersion(v: string): [number, number, number] | null {
  const m = v.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/**
 * Compare two version strings. Returns -1 if `a < b`, 0 if equal, 1 if
 * `a > b`. Unparseable strings sort as equal (conservative \u2014 don't flag
 * weird versions as outdated).
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const A = parseVersion(a);
  const B = parseVersion(b);
  if (!A || !B) return 0;
  for (let i = 0; i < 3; i++) {
    if (A[i] < B[i]) return -1;
    if (A[i] > B[i]) return 1;
  }
  return 0;
}

/**
 * Return true if `version` is less than `threshold`. Delegates to
 * `compareVersions` so unparseable strings never flag as "too old".
 */
export function isBelow(version: string, threshold: string): boolean {
  return compareVersions(version, threshold) < 0;
}

/**
 * Return true if `version` is strictly above `threshold`. `threshold`
 * may include a `.x` wildcard in the patch slot (e.g. `"0.9.x"`); in
 * that case the wildcard matches any patch, so `"0.9.5"` is NOT above
 * `"0.9.x"` but `"0.10.0"` is.
 */
export function isAbove(version: string, threshold: string): boolean {
  const thresholdClean = threshold.replace(/\.x$/i, ".99999");
  return compareVersions(version, thresholdClean) > 0;
}

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
  try {
    const raw = fs.readFileSync(serverPkgJsonPath, "utf8");
    const parsed = JSON.parse(raw) as {
      piCompatibility?: { minimum?: string; recommended?: string; maximum?: string | null };
    };
    const c = parsed.piCompatibility;
    if (c && typeof c.minimum === "string" && typeof c.recommended === "string") {
      return {
        minimum: c.minimum,
        recommended: c.recommended,
        maximum: c.maximum ?? null,
      };
    }
  } catch {
    /* fall through */
  }
  return { minimum: "0.6.7", recommended: "0.6.7", maximum: null };
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
  if (isBelow(current, range.minimum)) {
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

