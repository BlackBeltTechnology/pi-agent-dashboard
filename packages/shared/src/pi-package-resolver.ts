/**
 * pi-package-resolver — shared helper that resolves a pi peer package
 * name to its install directory and importable entry path by walking
 * pi's own settings.json files.
 *
 * Pi-coding-agent installs packages into three different filesystem
 * layouts depending on how the user added them to `settings.json#packages[]`:
 *
 *   npm:<name>[@version]   → ~/.pi/agent/npm/node_modules/<name>/ (user, MANAGED)
 *                            └ fallback: pnpm global dir / `npm root -g` (LEGACY)
 *                            <cwd>/.pi/npm/node_modules/<name>/ (project)
 *   git+https://… / git@…/ → ~/.pi/agent/git/<host>/<owner>/<repo>/ (user)
 *                            <cwd>/.pi/git/<host>/<owner>/<repo>/  (project)
 *   /abs/path              → the path itself
 *   ./rel/path             → resolved against settings dir
 *
 * None of these locations are on Node's `node_modules` walk from
 * `process.cwd()`, so `createRequire(cwd).resolve(spec)` fails for every
 * pi-installed peer. This module walks pi's own settings + applies the
 * same path arithmetic pi-coding-agent uses internally, then matches by
 * `package.json#name` to expose an `await import(absPath)`-ready result.
 *
 * Read-on-call contract — performs no installs, mutates nothing, holds
 * no module-level cache. Two settings reads + N package.json reads per
 * resolution; each settings file is ~1 KB. Designed to be called from
 * plugin bridges (`packages/shared/`-only imports allowed) on every
 * probe without amortization.
 *
 * Scope only: walks `packages[]` from `~/.pi/agent/settings.json` and
 * `<cwd>/.pi/settings.json`. Does NOT walk `extensions[]`/`skills[]`/
 * `prompts[]` top-level arrays — those hold file paths to individual
 * extension entry files, not package roots, so `package.json#name`
 * lookup doesn't apply.
 *
 * See change: add-shared-pi-package-resolver.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { rootGlobalOr } from "./platform/npm.js";

// ── Public surface ──────────────────────────────────────────────────

export interface ResolvePiPackageOptions {
  /** Override `~/.pi/agent`. Default: `path.join(os.homedir(), ".pi", "agent")`. */
  agentDir?: string;
  /** Project-scope cwd (enables reading `<cwd>/.pi/settings.json`). */
  cwd?: string;
  /** "user" | "project" | "any" (default). "any" reads project first, then user. */
  scope?: "user" | "project" | "any";
  /**
   * Override `npm root -g`. Defaults to `npm.rootGlobalOr("")`. Tests pass
   * a tmp path to avoid shelling out and to make `npm:` resolution
   * hermetic.
   */
  npmRoot?: string;
}

export interface ResolvedPiPackage {
  /** Absolute path to the package root. */
  packageDir: string;
  /**
   * Absolute path to the importable entry file (from `exports["."]` →
   * `main` → `pi.extensions[0]` → `index.js` → `index.ts`), or `null`
   * when no candidate exists on disk.
   */
  entryPath: string | null;
  /** Which scope matched. */
  scope: "user" | "project";
  /** Original `settings.json#packages[]` entry that produced the match. */
  source: string;
  /** Parsed `package.json#name`, or `null` when no readable package.json. */
  packageJsonName: string | null;
}

export function resolvePiPackage(
  spec: string,
  opts: ResolvePiPackageOptions = {},
): ResolvedPiPackage | null {
  const agentDir = opts.agentDir ?? path.join(os.homedir(), ".pi", "agent");
  const scope = opts.scope ?? "any";
  const cwd = opts.cwd;
  const npmRoot = opts.npmRoot ?? rootGlobalOr("");

  // Project scope first (matches deepMergeSettings precedence).
  if ((scope === "project" || scope === "any") && cwd) {
    const hit = findInScope(spec, "project", { agentDir, cwd, npmRoot });
    if (hit) return hit;
  }
  if (scope === "user" || scope === "any") {
    const hit = findInScope(spec, "user", { agentDir, cwd, npmRoot });
    if (hit) return hit;
  }
  return null;
}

export function resolvePiPackageEntry(
  spec: string,
  opts: ResolvePiPackageOptions = {},
): string | null {
  return resolvePiPackage(spec, opts)?.entryPath ?? null;
}

/**
 * List every resolved pi package across the requested scopes. Iterates
 * `settings.packages[]` in project then user scope (matching
 * `resolvePiPackage`'s precedence) and yields a `ResolvedPiPackage` for
 * every entry whose computed install path exists on disk.
 *
 * Unlike `resolvePiPackage`, this performs no name match — callers that
 * need to find any package satisfying a per-directory predicate (e.g.
 * "contains `bridge.ts`") consume the list directly.
 *
 * Order: project-scope hits first, then user-scope. Duplicates (same
 * absolute packageDir) are de-duplicated keeping the first occurrence.
 *
 * Added by change: fix-electron-cold-launch-probe-cascade (Bug A).
 * Used by `launch-source.ts::probePiExtension` to iterate the actual
 * `packages[]` schema instead of the non-existent `extensions[]`.
 */
export function listPiPackages(opts: ResolvePiPackageOptions = {}): ResolvedPiPackage[] {
  const agentDir = opts.agentDir ?? path.join(os.homedir(), ".pi", "agent");
  const scope = opts.scope ?? "any";
  const cwd = opts.cwd;
  const npmRoot = opts.npmRoot ?? rootGlobalOr("");

  const out: ResolvedPiPackage[] = [];
  const seen = new Set<string>();
  const collect = (s: "user" | "project") => {
    for (const r of iterateInScope(s, { agentDir, cwd, npmRoot })) {
      if (seen.has(r.packageDir)) continue;
      seen.add(r.packageDir);
      out.push(r);
    }
  };
  if ((scope === "project" || scope === "any") && cwd) collect("project");
  if (scope === "user" || scope === "any") collect("user");
  return out;
}

// ── Internals ───────────────────────────────────────────────────────

interface ScopeContext {
  agentDir: string;
  cwd?: string;
  npmRoot: string;
}

interface ParsedSource {
  kind: "npm" | "git" | "local-abs" | "local-rel";
  /** For npm: package name (without version). For git: cleaned URL path. For local: raw path. */
  value: string;
  /** Original entry as it appeared in settings.json. */
  original: string;
}

function findInScope(
  spec: string,
  scope: "user" | "project",
  ctx: ScopeContext,
): ResolvedPiPackage | null {
  for (const r of iterateInScope(scope, ctx)) {
    if (r.packageJsonName === spec) return r;
  }
  return null;
}

/**
 * Shared iteration core used by both `findInScope` (name-matched lookup)
 * and `listPiPackages` (no name filter). Yields every entry whose computed
 * install path exists on disk; reads `package.json` lazily.
 */
function* iterateInScope(
  scope: "user" | "project",
  ctx: ScopeContext,
): Generator<ResolvedPiPackage> {
  const settingsPath =
    scope === "user"
      ? path.join(ctx.agentDir, "settings.json")
      : ctx.cwd
      ? path.join(ctx.cwd, ".pi", "settings.json")
      : null;
  if (!settingsPath) return;

  const packages = readSettingsPackages(settingsPath);
  if (packages.length === 0) return;

  const settingsDir = path.dirname(settingsPath);
  for (const entry of packages) {
    const parsed = parseSource(entry);
    if (!parsed) continue;
    const packageDir = computeInstallPath(parsed, scope, ctx, settingsDir);
    if (!packageDir || !fs.existsSync(packageDir)) continue;

    const pkgJson = readPackageJson(packageDir);
    const name = pkgJson?.name ?? null;
    const entryPath = resolveEntryPath(packageDir, pkgJson ?? {});
    yield {
      packageDir,
      entryPath,
      scope,
      source: parsed.original,
      packageJsonName: name,
    };
  }
}

/**
 * Parse a `settings.json#packages[]` entry. Mirrors
 * `packages/server/src/pi-resource-scanner.ts::resolvePackagePath`
 * parsing arms and pi-coding-agent `package-manager.js::parseSource`.
 */
function parseSource(entry: unknown): ParsedSource | null {
  // Pi accepts both string entries and `{source: "..."}` objects.
  const original =
    typeof entry === "string"
      ? entry
      : typeof entry === "object" && entry !== null && typeof (entry as { source?: unknown }).source === "string"
      ? (entry as { source: string }).source
      : "";
  if (!original) return null;

  if (original.startsWith("npm:")) {
    const pkgName = original.slice(4).replace(/@[^/]*$/, "");
    return { kind: "npm", value: pkgName, original };
  }
  if (
    original.startsWith("git:") ||
    original.startsWith("git@") ||
    original.startsWith("https://") ||
    original.startsWith("http://") ||
    original.startsWith("ssh://") ||
    original.startsWith("github:")
  ) {
    let url = original.replace(/^git:/, "");
    url = url.replace(/^github:/, "github.com/");
    url = url.replace(/^git@([^:]+):/, "$1/");
    url = url.replace(/^(https?|ssh|git):\/\//, "");
    url = url.replace(/^[^@]+@/, "");
    url = url.replace(/\.git$/, "").replace(/@[^/]*$/, "");
    return { kind: "git", value: url, original };
  }
  if (path.isAbsolute(original)) {
    return { kind: "local-abs", value: original, original };
  }
  return { kind: "local-rel", value: original, original };
}

/**
 * Compute the absolute install directory for a parsed entry. Mirrors
 * pi-coding-agent's own arithmetic in `dist/core/package-manager.js`
 * `getNpmInstallPath` / `getGitInstallPath` / `resolvePathFromBase`.
 */
function computeInstallPath(
  parsed: ParsedSource,
  scope: "user" | "project",
  ctx: ScopeContext,
  settingsDir: string,
): string | null {
  switch (parsed.kind) {
    case "npm": {
      if (scope === "project") {
        if (!ctx.cwd) return null;
        return path.join(ctx.cwd, ".pi", "npm", "node_modules", parsed.value);
      }
      // User scope mirrors pi-coding-agent `getNpmInstallPath`
      // (dist/core/package-manager.js): the MANAGED dir is authoritative and
      // checked FIRST; the global npm root is only a LEGACY fallback for
      // packages installed before pi managed its own npm prefix. Checking only
      // the legacy root made every modern `npm:` install unresolvable.
      const managed = path.join(ctx.agentDir, "npm", "node_modules", parsed.value);
      if (fs.existsSync(managed)) return managed;
      if (!ctx.npmRoot) return managed;
      const legacy = path.join(ctx.npmRoot, parsed.value);
      return fs.existsSync(legacy) ? legacy : managed;
    }
    case "git": {
      if (scope === "project") {
        if (!ctx.cwd) return null;
        return path.join(ctx.cwd, ".pi", "git", parsed.value);
      }
      return path.join(ctx.agentDir, "git", parsed.value);
    }
    case "local-abs":
      return parsed.value;
    case "local-rel":
      return path.resolve(settingsDir, parsed.value);
  }
}

/**
 * Read `<settingsPath>`'s `packages[]` array. Returns `[]` on missing
 * file, parse error, or missing `packages` field. Never throws.
 */
function readSettingsPackages(settingsPath: string): unknown[] {
  try {
    if (!fs.existsSync(settingsPath)) return [];
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const parsed = JSON.parse(raw);
    const pkgs = (parsed && typeof parsed === "object" ? (parsed as { packages?: unknown }).packages : undefined);
    return Array.isArray(pkgs) ? pkgs : [];
  } catch (err) {
    console.warn(
      `[pi-package-resolver] failed to read ${settingsPath}: ${(err as Error).message}`,
    );
    return [];
  }
}

interface PackageJsonShape {
  name?: string;
  main?: string;
  exports?: unknown;
  pi?: { extensions?: unknown };
}

function readPackageJson(packageDir: string): PackageJsonShape | null {
  const pkgJsonPath = path.join(packageDir, "package.json");
  try {
    if (!fs.existsSync(pkgJsonPath)) return null;
    const raw = fs.readFileSync(pkgJsonPath, "utf-8");
    return JSON.parse(raw) as PackageJsonShape;
  } catch (err) {
    console.warn(
      `[pi-package-resolver] failed to parse ${pkgJsonPath}: ${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * Entry-point resolution priority:
 *   1. package.json#exports["."]  (string, or `{import|default|node}`)
 *   2. package.json#main
 *   3. package.json#pi.extensions[0]
 *   4. <packageDir>/index.js
 *   5. <packageDir>/index.ts
 *
 * Each candidate is existence-checked before being returned. Returns
 * `null` when no candidate resolves to an existing file.
 */
function resolveEntryPath(packageDir: string, pkg: PackageJsonShape): string | null {
  // 1. exports["."]
  const exportsDot = extractExportsDot(pkg.exports);
  if (typeof exportsDot === "string") {
    const candidate = path.resolve(packageDir, exportsDot);
    if (fs.existsSync(candidate)) return candidate;
  }
  // 2. main
  if (typeof pkg.main === "string" && pkg.main.length > 0) {
    const candidate = path.resolve(packageDir, pkg.main);
    if (fs.existsSync(candidate)) return candidate;
  }
  // 3. pi.extensions[0]
  if (pkg.pi && Array.isArray(pkg.pi.extensions) && pkg.pi.extensions.length > 0) {
    const first = pkg.pi.extensions[0];
    if (typeof first === "string") {
      const candidate = path.resolve(packageDir, first);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  // 4. index.js
  const idxJs = path.join(packageDir, "index.js");
  if (fs.existsSync(idxJs)) return idxJs;
  // 5. index.ts
  const idxTs = path.join(packageDir, "index.ts");
  if (fs.existsSync(idxTs)) return idxTs;

  return null;
}

/**
 * Extract the "." subpath from `package.json#exports`. Supports:
 *   - "./entry.js"                                (string form)
 *   - { ".": "./entry.js" }                       (path-only object)
 *   - { ".": { "import": "...", "default": "..." } }  (conditional)
 * Returns the first matching string from `import` → `default` → `node`.
 * Returns `null` for unsupported shapes.
 */
function extractExportsDot(exportsField: unknown): string | null {
  if (typeof exportsField === "string") {
    return exportsField; // bare exports applies to "." implicitly
  }
  if (!exportsField || typeof exportsField !== "object") return null;
  const root = exportsField as Record<string, unknown>;
  const dot = root["."];
  if (typeof dot === "string") return dot;
  if (dot && typeof dot === "object") {
    const cond = dot as Record<string, unknown>;
    for (const key of ["import", "default", "node"]) {
      const v = cond[key];
      if (typeof v === "string") return v;
    }
  }
  return null;
}
