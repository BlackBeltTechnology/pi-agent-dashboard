/**
 * npm tool module — Recipe-based API for the npm CLI.
 *
 * Covers the subset of npm operations the dashboard actually invokes:
 *   - `npm root -g`          (resolve the global node_modules path)
 *   - `npm outdated`         (check for updates, local or global)
 *   - `npm install`          (install a package, local or global)
 *   - `npm view <pkg> version` (read upstream version)
 *
 * See change: platform-command-executor.
 */
import { run, unwrap, type Recipe, type Result } from "./runner.js";

const NPM_TIMEOUT_FAST = 10_000;
const NPM_TIMEOUT_INSTALL = 120_000;

interface WithCwd {
  cwd?: string;
}

// ── Recipes ─────────────────────────────────────────────────────────────────

/**
 * `npm root -g` — returns the absolute path to the global node_modules.
 * Cached by callers (it's stable per Node install).
 */
export const NPM_ROOT_GLOBAL: Recipe<Record<string, never>, string> = {
  argv: () => ["npm", "root", "-g"],
  parse: (out) => out.trim(),
  timeout: NPM_TIMEOUT_FAST,
};

/**
 * `npm outdated <pkg> --json` (or without `<pkg>` for project-wide).
 * npm exits 1 when updates are available and 0 when up-to-date — we tolerate
 * exit 1 so callers see the JSON body either way.
 */
export const NPM_OUTDATED: Recipe<WithCwd & { pkg?: string }, unknown | null> = {
  argv: ({ pkg }) => pkg === undefined
    ? ["npm", "outdated", "--json"]
    : ["npm", "outdated", pkg, "--json"],
  parse: (out) => {
    const trimmed = out.trim();
    if (!trimmed) return null;
    try { return JSON.parse(trimmed); } catch { return null; }
  },
  timeout: NPM_TIMEOUT_FAST,
  tolerate: [1],
};

/**
 * `npm outdated -g <pkg> --json`. Same exit-1 tolerance.
 */
export const NPM_OUTDATED_GLOBAL: Recipe<{ pkg?: string }, unknown | null> = {
  argv: ({ pkg }) => pkg === undefined
    ? ["npm", "outdated", "-g", "--json"]
    : ["npm", "outdated", "-g", pkg, "--json"],
  parse: (out) => {
    const trimmed = out.trim();
    if (!trimmed) return null;
    try { return JSON.parse(trimmed); } catch { return null; }
  },
  timeout: NPM_TIMEOUT_FAST,
  tolerate: [1],
};

/**
 * `npm install <pkg>@<version>` — local install. Long timeout.
 */
export const NPM_INSTALL: Recipe<WithCwd & { pkg: string; version?: string }, string> = {
  argv: ({ pkg, version }) => ["npm", "install", version ? `${pkg}@${version}` : pkg],
  parse: (out) => out,
  timeout: NPM_TIMEOUT_INSTALL,
};

/**
 * `npm install -g <pkg>@<version>` — global install.
 */
export const NPM_INSTALL_GLOBAL: Recipe<{ pkg: string; version?: string }, string> = {
  argv: ({ pkg, version }) => ["npm", "install", "-g", version ? `${pkg}@${version}` : pkg],
  parse: (out) => out,
  timeout: NPM_TIMEOUT_INSTALL,
};

/**
 * `npm view <pkg> version` — the single-value shorthand for "latest version".
 */
export const NPM_VIEW_VERSION: Recipe<{ pkg: string }, string> = {
  argv: ({ pkg }) => ["npm", "view", pkg, "version"],
  parse: (out) => out.trim(),
  timeout: NPM_TIMEOUT_FAST,
};

export const NPM_RECIPES = {
  NPM_ROOT_GLOBAL,
  NPM_OUTDATED,
  NPM_OUTDATED_GLOBAL,
  NPM_INSTALL,
  NPM_INSTALL_GLOBAL,
  NPM_VIEW_VERSION,
} as const;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * `npm root -g`. Returns a `Result` for explicit error handling; use
 * `rootGlobalOr` for best-effort semantics.
 *
 * Previous versions cached the result in a module-level variable. That
 * cache is now owned by `ToolRegistry` (the runner consults the
 * registry for every resolved binary including `npm` itself). Cache
 * invalidation flows through `registry.rescan()`.
 *
 * See change: consolidate-tool-resolution.
 */
export function rootGlobal(): Result<string> {
  return run(NPM_ROOT_GLOBAL, {}, {});
}

/**
 * Test-only no-op kept for backward compatibility with existing test
 * suites. The `cachedGlobalRoot` variable no longer exists.
 */
export function _resetNpmRootCache(): void { /* no-op */ }

export function outdated(input: WithCwd & { pkg?: string }): Result<unknown | null> {
  return run(NPM_OUTDATED, input, { cwd: input.cwd });
}

export function outdatedGlobal(input: { pkg?: string } = {}): Result<unknown | null> {
  return run(NPM_OUTDATED_GLOBAL, input, {});
}

export function install(input: WithCwd & { pkg: string; version?: string }): Result<string> {
  return run(NPM_INSTALL, input, { cwd: input.cwd });
}

export function installGlobal(input: { pkg: string; version?: string }): Result<string> {
  return run(NPM_INSTALL_GLOBAL, input, {});
}

export function viewVersion(input: { pkg: string }): Result<string> {
  return run(NPM_VIEW_VERSION, input, {});
}

// ── Best-effort variants ────────────────────────────────────────────────────

export function rootGlobalOr(fallback = ""): string {
  return unwrap(rootGlobal(), fallback);
}

export function outdatedOr(input: WithCwd & { pkg?: string }, fallback: unknown | null = null): unknown | null {
  return unwrap(outdated(input), fallback);
}

export function outdatedGlobalOr(input: { pkg?: string } = {}, fallback: unknown | null = null): unknown | null {
  return unwrap(outdatedGlobal(input), fallback);
}

export function viewVersionOr(input: { pkg: string }, fallback = ""): string {
  return unwrap(viewVersion(input), fallback);
}
