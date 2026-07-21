/**
 * Filesystem helpers for locating an installed package's
 * `CHANGELOG.md` and `package.json`, plus deriving a public GitHub
 * URL from the `repository` field.
 *
 * Search order matches the ToolRegistry resolution chain for `pi`:
 *   1. Managed install (`~/.pi-dashboard/node_modules/<pkg>/`)
 *   2. Bare-import via `createRequire` (process resolves the package
 *      through its own node_modules — covers npm-global on Unix when
 *      the symlink lands inside this Node prefix, and dev-checkout
 *      paths during local builds).
 *
 * Both helpers return `null` rather than throwing on absence so route
 * handlers can degrade to the empty-changelog response per spec
 * `pi-changelog-display#Scenario: Package not installed returns empty`.
 *
 * See change: pi-update-whats-new-panel.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** Default managed install root. Test seam: caller may override. */
function defaultManagedDir(): string {
  return path.join(os.homedir(), ".pi-dashboard");
}

/**
 * Candidate global `node_modules` roots, derived from the running Node
 * binary path. Covers globally-installed packages (npm `-g`, nvm) that
 * are NOT dependencies of the dashboard and so are invisible to the
 * bare-import / walk-up strategies.
 *   - Unix/nvm: `<prefix>/bin/node` -> `<prefix>/lib/node_modules`
 *   - Windows:  `<prefix>\node.exe` -> `<prefix>\node_modules`
 */
function defaultGlobalNodeModules(): string[] {
  const binDir = path.dirname(process.execPath);
  return [
    path.join(binDir, "..", "lib", "node_modules"), // Unix / nvm
    path.join(binDir, "node_modules"), // Windows
  ];
}

/**
 * Locate a package's CHANGELOG.md on disk.
 *
 * Returns `{ changelogPath, packageDir }` so callers can read the
 * adjacent `package.json` without re-resolving.
 *
 * Strategy:
 *   1. `<managedDir>/node_modules/<pkg>/CHANGELOG.md` (Electron + CLI bootstrap).
 *   2. `createRequire(import.meta.url).resolve("<pkg>/package.json")` then
 *      look for `CHANGELOG.md` next to it (covers bare-import / npm-global
 *      via the standard Node resolution mechanism).
 *
 * Returns `null` when no readable CHANGELOG can be located.
 */
export interface ChangelogLocation {
  changelogPath: string;
  packageDir: string;
}

export interface FindOptions {
  /** Override managed dir for tests. */
  managedDir?: string;
  /**
   * Override the require-resolver used for bare-import lookup. Tests
   * pass a stub that throws to force the managed path; production
   * uses `createRequire(import.meta.url).resolve`.
   */
  resolveBareImport?: (pkgJsonSpec: string) => string;
  /**
   * Override the module URL used as the walk start point for the
   * filesystem fallback (Strategy 3). Defaults to `import.meta.url`.
   * Tests point this at a tmp tree.
   */
  moduleUrl?: string;
  /**
   * Override the global node_modules roots searched by Strategy 4.
   * Defaults to roots derived from `process.execPath`. Tests point
   * this at a tmp tree.
   */
  globalNodeModules?: string[];
}

export function findChangelogPath(
  pkg: string,
  opts: FindOptions = {},
): ChangelogLocation | null {
  // Strategy 1: managed install.
  const managedDir = opts.managedDir ?? defaultManagedDir();
  const managedPkg = path.join(managedDir, "node_modules", pkg);
  const managedCl = path.join(managedPkg, "CHANGELOG.md");
  if (fs.existsSync(managedCl)) {
    return { changelogPath: managedCl, packageDir: managedPkg };
  }

  // Strategy 2: bare-import via require.resolve.
  const resolver =
    opts.resolveBareImport ??
    ((spec: string) => createRequire(import.meta.url).resolve(spec));
  try {
    const pkgJsonPath = resolver(`${pkg}/package.json`);
    const dir = path.dirname(pkgJsonPath);
    const cl = path.join(dir, "CHANGELOG.md");
    if (fs.existsSync(cl)) {
      return { changelogPath: cl, packageDir: dir };
    }
  } catch {
    /* not resolvable — fall through */
  }

  // Strategy 3: filesystem walk up node_modules from this module's
  // location. Required because pi-coding-agent ships an `exports`
  // field that exposes only `"."` (import-only) and omits
  // `"./package.json"`, so Strategy 2's CJS `require.resolve` throws
  // even though `node_modules/<pkg>/CHANGELOG.md` exists on disk.
  const moduleUrl = opts.moduleUrl ?? import.meta.url;
  let walkDir: string;
  try {
    walkDir = path.dirname(fileURLToPath(moduleUrl));
  } catch {
    return null;
  }
  while (true) {
    const cl = path.join(walkDir, "node_modules", pkg, "CHANGELOG.md");
    if (fs.existsSync(cl)) {
      return { changelogPath: cl, packageDir: path.dirname(cl) };
    }
    const parent = path.dirname(walkDir);
    if (parent === walkDir) break; // reached filesystem root
    walkDir = parent;
  }

  // Strategy 4: global node_modules (npm -g / nvm). Covers any
  // globally-installed package that is not a dashboard dependency, so
  // the What's-New changelog works for every installed package, not
  // just pi core. See change: extend-whats-new-to-all-packages.
  const globalRoots = opts.globalNodeModules ?? defaultGlobalNodeModules();
  for (const root of globalRoots) {
    const dir = path.join(root, pkg);
    const cl = path.join(dir, "CHANGELOG.md");
    if (fs.existsSync(cl)) {
      return { changelogPath: cl, packageDir: dir };
    }
  }

  return null;
}

/**
 * Read and parse `package.json` next to a previously-located
 * CHANGELOG. Returns the parsed object or `null` on read/parse error.
 */
export function readPackageJson(packageDir: string): Record<string, unknown> | null {
  const p = path.join(packageDir, "package.json");
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Derive a public GitHub URL pointing at the CHANGELOG given a
 * `package.json#repository` field. Returns `null` when the field is
 * missing, not GitHub-hosted, or unparseable.
 *
 * Accepted shapes (per spec `pi-changelog-display#Requirement: Changelog URL derivation`):
 *   - `"github:org/repo"` shorthand
 *   - `"https://github.com/org/repo.git"` URL string
 *   - `{ "type": "git", "url": "git+https://github.com/org/repo.git" }`
 *   - same object form with optional `"directory": "packages/foo"` (monorepo)
 */
export function deriveChangelogUrl(repository: unknown): string | null {
  if (!repository) return null;

  let urlStr: string | null = null;
  let directory: string | null = null;

  if (typeof repository === "string") {
    urlStr = repository;
  } else if (typeof repository === "object" && repository !== null) {
    const rec = repository as Record<string, unknown>;
    if (typeof rec.url === "string") urlStr = rec.url;
    if (typeof rec.directory === "string" && rec.directory.length > 0) {
      directory = rec.directory.replace(/^\/+|\/+$/g, "");
    }
  }
  if (!urlStr) return null;

  const m = parseGitHubUrl(urlStr);
  if (!m) return null;

  const subPath = directory ? `${directory}/` : "";
  return `https://github.com/${m.org}/${m.repo}/blob/main/${subPath}CHANGELOG.md`;
}

/**
 * Parse the various GitHub URL forms used in `package.json#repository`
 * into `{ org, repo }`. Returns null for non-GitHub or unparseable
 * inputs.
 */
function parseGitHubUrl(s: string): { org: string; repo: string } | null {
  const trimmed = s.trim();

  // github:org/repo shorthand
  let m = trimmed.match(/^github:([^/]+)\/([^/#]+)/i);
  if (m) return { org: m[1], repo: stripGitSuffix(m[2]) };

  // git+https://github.com/org/repo.git
  // https://github.com/org/repo
  // git://github.com/org/repo.git
  // ssh://git@github.com/org/repo.git
  // git@github.com:org/repo.git
  m = trimmed.match(/(?:^|[/@:])github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (m) return { org: m[1], repo: stripGitSuffix(m[2]) };

  return null;
}

function stripGitSuffix(repo: string): string {
  return repo.replace(/\.git$/i, "");
}

/**
 * Validate that `pkg` is a syntactically valid npm package name.
 *
 * Pre-filesystem gate for the changelog endpoint: blocks path traversal
 * (`..`, stray separators) while accepting ANY real package name — scoped
 * (`@scope/name`) or unscoped (`name`) — not just a fixed core whitelist.
 * Mirrors the npm name grammar closely enough to be a safe guard without
 * depending on the `validate-npm-package-name` module.
 *
 * See change: extend-whats-new-to-all-packages.
 */
export function isValidNpmPackageName(pkg: unknown): pkg is string {
  if (typeof pkg !== "string") return false;
  const name = pkg.trim();
  if (!name || name.length > 214) return false;
  if (name.includes("..")) return false;
  // Single name segment: lowercase/digit start, url-safe chars, no separators.
  const segment = /^[a-z0-9][a-z0-9._-]*$/;
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash < 0) return false;
    const scope = name.slice(1, slash);
    const rest = name.slice(slash + 1);
    if (rest.includes("/")) return false; // exactly one separator allowed
    return segment.test(scope) && segment.test(rest);
  }
  return segment.test(name);
}
