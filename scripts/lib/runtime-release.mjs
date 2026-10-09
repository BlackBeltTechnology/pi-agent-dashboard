/**
 * Shared constants + helpers for the runtime release producer scripts
 * (generate-runtime-lock, assert-bundled-plugins-published,
 * build-runtime-asset, assert-runtime-release).
 *
 * Mirrors the consumer (`packages/server/src/runtime-overlay/`): the asset
 * name MUST equal `githubAssetName` in runtime-io.ts, and plugin ids map to
 * packages by directory (`packages/<id>`), as the stager does via
 * `repository.directory`.
 *
 * See change: electron-runtime-release-pipeline (design R1, R3).
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SCOPE = "@blackbelt-technology";
export const SERVER_PACKAGE = `${SCOPE}/pi-dashboard-server`;

/**
 * Fixed runtime package set (bundled plugins are added explicitly — the
 * server does not depend on them). The meta package is deliberately absent:
 * the overlay reads server/web/extension only, and meta could not be
 * integrity-pinned either (design R1).
 */
export const RUNTIME_BASE_PACKAGES = [
  SERVER_PACKAGE,
  `${SCOPE}/pi-dashboard-web`,
  `${SCOPE}/pi-dashboard-extension`,
  `${SCOPE}/dashboard-plugin-runtime`,
];

/**
 * Per-platform assets (spike 1.1: host-only native optionals → no shared
 * asset). Each is built on a NATIVE runner by publish.yml `runtime-asset`;
 * win32-arm64 is absent (no native runner — an x64 host would install x64
 * native optionals), so GitHub-source updates there fall back to npm.
 */
export const RUNTIME_ASSET_TARGETS = [
  { platform: "darwin", arch: "arm64" },
  { platform: "darwin", arch: "x64" },
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
  { platform: "win32", arch: "x64" },
];

/** Same shape as `githubAssetName` in packages/server/src/runtime-overlay/runtime-io.ts. */
export function runtimeAssetName(version, platform, arch) {
  return `pi-dashboard-runtime-${version}-${platform}-${arch}.tgz`;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * `piDashboard.bundledPlugins` of packages/server → `[{ id, name }]` in
 * declaration order. Throws when the declaration is malformed or an id has no
 * named workspace package.
 */
export function bundledPluginPackages(repoRoot) {
  const server = readJson(join(repoRoot, "packages", "server", "package.json"));
  const ids = server?.piDashboard?.bundledPlugins;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string" && id !== "")) {
    throw new Error("packages/server/package.json: piDashboard.bundledPlugins must be a non-empty string array");
  }
  return ids.map((id) => {
    const pkg = readJson(join(repoRoot, "packages", id, "package.json"));
    if (typeof pkg.name !== "string") throw new Error(`packages/${id}/package.json has no name`);
    return { id, name: pkg.name };
  });
}

/**
 * Union of bundled plugins' third-party `dependencies` (task 2.6; mirrors
 * bundle-plugin-third-party-deps D1/D3). Materialized plugins ship without
 * node_modules, so each dep must sit at the runtime root. First-party, peer,
 * dev and optional deps are excluded. Every declaration among plugins AND
 * runtime workspaces must use the identical specifier (else throw listing
 * each); non-registry specifiers (`:` or `/`) are rejected.
 */
export function collectPluginRuntimeDeps({ plugins, workspaces }) {
  const decls = new Map(); // dep → [[owner, spec]]
  const add = (owner, deps) => {
    for (const [dep, spec] of Object.entries(deps ?? {})) {
      if (dep.startsWith(`${SCOPE}/`)) continue;
      if (!decls.has(dep)) decls.set(dep, []);
      decls.get(dep).push([owner, spec]);
    }
  };
  for (const p of plugins) {
    for (const [dep, spec] of Object.entries(p.dependencies ?? {})) {
      if (!dep.startsWith(`${SCOPE}/`) && /[:/]/.test(String(spec))) throw new Error(`${p.name}: non-registry specifier ${dep}@${spec}`);
    }
    add(p.name, p.dependencies);
  }
  const pluginDeps = new Set(decls.keys());
  for (const w of workspaces) add(w.name, w.dependencies);
  const out = {};
  const conflicts = [];
  for (const dep of [...pluginDeps].sort()) {
    const list = decls.get(dep);
    if (new Set(list.map(([, s]) => s)).size > 1) conflicts.push(`${dep}: ${list.map(([o, s]) => `${o}@${s}`).join(", ")}`);
    else out[dep] = list[0][1];
  }
  if (conflicts.length) throw new Error(`conflicting plugin dependency specifiers:\n  ${conflicts.join("\n  ")}`);
  return out;
}

/** `collectPluginRuntimeDeps` over the repo's bundled plugins + runtime workspaces. */
export function pluginRuntimeDeps(repoRoot) {
  const plugins = bundledPluginPackages(repoRoot).map(({ id }) => readJson(join(repoRoot, "packages", id, "package.json")));
  // Server-side runtime workspaces only — same set as the Electron bundle's
  // BUNDLED_WORKSPACE_PKGS. pi-dashboard-web is a Vite bundle: its deps are
  // compiled into dist/ and never resolved at runtime.
  const want = new Set([SERVER_PACKAGE, `${SCOPE}/pi-dashboard-shared`, `${SCOPE}/pi-dashboard-extension`, `${SCOPE}/dashboard-plugin-runtime`]);
  const workspaces = [];
  for (const d of readdirSync(join(repoRoot, "packages"))) {
    const file = join(repoRoot, "packages", d, "package.json");
    if (!existsSync(file)) continue;
    const m = readJson(file);
    if (want.has(m.name)) workspaces.push(m);
  }
  return collectPluginRuntimeDeps({ plugins, workspaces });
}

/**
 * npm of the running Node (`npm-cli.js` beside it), so no shell / `npm.cmd`
 * is needed on Windows. Falls back to `npm` on PATH (posix only).
 */
export function npmArgv() {
  const nodeDir = dirname(process.execPath);
  for (const cli of [
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ]) {
    if (existsSync(cli)) return [process.execPath, cli];
  }
  return ["npm"];
}

/** Run npm; resolves stdout, rejects with npm's stderr on non-zero exit. */
export async function runNpm(args, { cwd, env = process.env, timeout = 20 * 60_000 } = {}) {
  const [cmd, ...prefix] = npmArgv();
  const { stdout } = await execFileAsync(cmd, [...prefix, ...args], { cwd, env, timeout, maxBuffer: 256 * 1024 * 1024 });
  return String(stdout);
}

/** Parse `--flag value` pairs. */
export function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
      else {
        out[a.slice(2)] = next;
        i++;
      }
    }
  }
  return out;
}
