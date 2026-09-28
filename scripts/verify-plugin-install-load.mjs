#!/usr/bin/env node
/**
 * Dynamic install-load check: pack a plugin workspace, install it OUTSIDE the
 * repository, and import its server entry under plain node+jiti with
 * `JITI_TSCONFIG_PATHS` unset and no repository `tsconfig` reachable.
 *
 * WHY DYNAMIC. `scripts/verify-published-imports.mjs` proves every shipped
 * import is *declared*; it cannot prove the import *resolves*
 * (`paths` / `resolve.alias` / `JITI_TSCONFIG_PATHS` all satisfy a static check
 * while failing a consumer). This check exercises the loader's own contract,
 * `typeof mod.default === "function"`, in the environment where no alias layer
 * exists.
 *
 * WORKTREE, NOT REGISTRY. The plugin's first-party workspace dependencies
 * (the runtime and shared workspace packages) are packed from
 * the working tree and forced in via `overrides`, so the verified graph is the
 * change under test. Resolving them from the registry would test a stale
 * published copy — and would fail spuriously on a release-prep PR whose versions
 * are not yet published (the hazard `bundle-server.mjs` documents).
 *
 * SCOPE. Workspaces whose `pi-dashboard-plugin` manifest declares a `server`
 * entry. `packages/demo-plugin` is `fixture: true` and client-only, so an
 * unconditional "every plugin exposes a default-export server function" is
 * unsatisfiable; those are reported `skipped`, never failed.
 *
 * Exit code: non-zero for any in-scope workspace that fails to pack, install, or
 * import; missing `server` entries are skipped.
 *
 * See change: fix-browser-plugin-vendor-specifier-resolution (D6).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./patch-vendor-specifiers.mjs";

const PLUGIN_KEY = "pi-dashboard-plugin";
// Workspace packages are located by DIRECTORY, never by a hardcoded package-name
// literal. A quoted `@blackbelt-technology/<name>` string in a root script reads
// as an undeclared workspace import to the pnpm phantom-dep guard
// (packages/shared/src/__tests__/pnpm-migration-contract.test.ts) even when the
// string is only a name handed to npm — and declaring a dep this script never
// imports would be a lie. Deriving from `rel` satisfies the guard honestly.
const RUNTIME_REL = "packages/dashboard-plugin-runtime";
const BROWSER_PLUGIN_REL = "packages/browser-plugin";

/** Read a workspace's package.json, or null when absent/malformed. */
function readManifest(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
  } catch {
    return null;
  }
}

function readdirSortedDirs(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Every workspace under `<root>/packages` that has a package.json name. */
export function listAllWorkspaces(root = REPO_ROOT, packagesDirRel = "packages") {
  const packagesDir = join(root, packagesDirRel);
  if (!existsSync(packagesDir)) return [];
  const out = [];
  for (const entry of readdirSortedDirs(packagesDir)) {
    const dir = join(packagesDir, entry);
    const pkg = readManifest(dir);
    if (!pkg?.name) continue;
    out.push({ dir, rel: `${packagesDirRel}/${entry}`, name: pkg.name, pkg, manifest: pkg[PLUGIN_KEY], version: pkg.version });
  }
  return out;
}

/** Every plugin workspace: the all-workspaces list filtered to plugin manifests. */
export function listPluginWorkspaces(root = REPO_ROOT, packagesDirRel = "packages") {
  return listAllWorkspaces(root, packagesDirRel).filter((ws) => ws.manifest !== undefined);
}

/**
 * Partition workspaces into the ones this check must run and the ones it must
 * report as skipped. Pure — the unit test drives it with synthetic manifests.
 */
export function selectInScope(workspaces) {
  const inScope = [];
  const skipped = [];
  for (const ws of workspaces) {
    if (typeof ws.manifest?.server === "string" && ws.manifest.server.length > 0) inScope.push(ws);
    else skipped.push({ name: ws.name, rel: ws.rel, reason: ws.manifest?.fixture === true ? "fixture (client-only)" : "no server entry" });
  }
  return { inScope, skipped };
}

/**
 * The TRANSITIVE closure of first-party workspace packages reachable from this
 * package through runtime fields (runtime fields only — `devDependencies` are
 * never installed for a consumer, but peer and optional dependencies are).
 *
 * Transitive, not direct: a plugin that depends on `…-mcp-server-plugin`, which
 * depends on `…-mcp-client-plugin`, would otherwise leave the grandchild to the
 * registry — the stale-copy hazard this check exists to close. Every one of
 * them needs an `overrides` entry.
 */
export function firstPartyWorkspaceDeps(pkg, workspaces) {
  const byName = new Map(workspaces.map((ws) => [ws.name, ws]));
  const out = new Map();
  const seen = new Set([pkg.name]);
  const queue = [pkg];
  while (queue.length > 0) {
    const current = queue.shift();
    const names = ["dependencies", "peerDependencies", "optionalDependencies"].flatMap((field) => Object.keys(current[field] ?? {}));
    for (const name of names) {
      const ws = byName.get(name);
      if (!ws || seen.has(name)) continue;
      seen.add(name);
      out.set(name, ws);
      queue.push(ws.pkg);
    }
  }
  return [...out.values()];
}

/** First line of an error's stderr/message, for a one-line report. */
function firstLine(err) {
  return String(err?.stderr ?? err?.message ?? err).split("\n")[0];
}

/** `npm pack` a workspace into `destDir`; returns the tarball's absolute path. */
export function packWorkspace(dir, destDir, exec = execFileSync) {
  const out = exec("npm", ["pack", "--json", "--pack-destination", destDir], { cwd: dir, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
  const parsed = JSON.parse(out);
  // npm emits an array in some versions and an object keyed by package name in
  // others; both carry `filename`.
  const [entry] = Array.isArray(parsed) ? parsed : Object.values(parsed);
  return join(destDir, entry.filename);
}

/**
 * The child script that imports the entry and prints a JSON verdict.
 *
 * jiti is driven through its `createJiti` API, NOT the `--import jiti/register`
 * ESM hook. Both are "plain node + jiti", but only the API reproduces what the
 * server's loader sees: `loader.ts` is itself jiti-evaluated, so its
 * `await import(plugin.serverEntryPath)` goes through jiti's CJS interop and
 * yields the default export directly. Importing through the ESM hook instead
 * wraps it (`mod.default.default`) — an artifact of the harness, not a product
 * defect, and exactly the interop gap the change's proposal said to surface
 * rather than paper over.
 *
 * `tsconfigPaths: false` is jiti's default, stated explicitly because the whole
 * point is that no repository tsconfig is reachable. Run with cwd = the temp
 * install, so `node_modules` resolves from there.
 */
const CHECK_SCRIPT = `
const path = require('node:path');
const fs = require('node:fs');
const [jitiLib, entryAbs, pluginDir, runtimeName, extraRel] = process.argv.slice(2);
const out = { ok: false };
try {
  const factory = require(jitiLib);
  const createJiti = typeof factory === 'function' ? factory : factory.createJiti;
  const jiti = createJiti(__filename, { interopDefault: true, tsconfigPaths: false, moduleCache: false });
  const mod = jiti(entryAbs);
  out.defaultType = typeof mod.default;
  out.ok = out.defaultType === 'function';
  out.runtimeResolved = jiti.resolve(runtimeName, { paths: [pluginDir] });
  out.runtimeVersion = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'node_modules', runtimeName, 'package.json'), 'utf-8')).version;
  out.runtimeInsideInstall = typeof out.runtimeResolved === 'string' && out.runtimeResolved.startsWith(path.join(process.cwd(), 'node_modules'));
  if (extraRel) {
    jiti(path.join(pluginDir, extraRel));
    out.extraOk = true;
  }
} catch (err) {
  out.error = String(err && err.message ? err.message : err);
}
console.log(JSON.stringify(out));
`;

/**
 * Pack, install and import one in-scope workspace. Returns a result object; the
 * caller decides how to report it.
 */
export function verifyWorkspace(ws, { allWorkspaces, scratch, jitiLib, exec = execFileSync, node = process.execPath } = {}) {
  const tarballDir = join(scratch, "tarballs");
  mkdirSync(tarballDir, { recursive: true });

  // Resolved up front: the child check script is told which package's version and
  // resolved path to report, and that name has to come from the inventory.
  const runtimeWorkspace = allWorkspaces.find((w) => w.rel === RUNTIME_REL);
  if (!runtimeWorkspace) return { name: ws.name, ok: false, error: `no workspace at ${RUNTIME_REL}` };

  let pluginTarball;
  let depTarballs;
  try {
    pluginTarball = packWorkspace(ws.dir, tarballDir, exec);
    depTarballs = firstPartyWorkspaceDeps(ws.pkg, allWorkspaces).map((dep) => ({ name: dep.name, tarball: packWorkspace(dep.dir, tarballDir, exec) }));
  } catch (err) {
    return { name: ws.name, ok: false, error: `pack failed: ${firstLine(err)}` };
  }

  const installDir = mkdtempSync(join(tmpdir(), `install-load-${ws.name.replace(/[^a-z0-9]+/gi, "-")}-`));
  const overrides = Object.fromEntries(depTarballs.map((d) => [d.name, `file:${d.tarball}`]));
  writeFileSync(join(installDir, "package.json"), JSON.stringify({ name: "install-load-check", private: true, version: "0.0.0", overrides }, null, 2));

  try {
    exec("npm", ["install", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund", pluginTarball], { cwd: installDir, encoding: "utf-8", stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    return { name: ws.name, ok: false, installDir, error: `install failed: ${firstLine(err)}` };
  }

  const pluginDir = join(installDir, "node_modules", ws.name);
  const entryAbs = join(pluginDir, ws.manifest.server);
  if (!existsSync(entryAbs)) return { name: ws.name, ok: false, installDir, error: `server entry not in the install: ${ws.manifest.server}` };

  const checkFile = join(installDir, "check.cjs");
  writeFileSync(checkFile, CHECK_SCRIPT);
  const extraRel =
    ws.rel === BROWSER_PLUGIN_REL
      ? "src/server/relay/vendor/playwright-core/src/tools/mcp/cdpRelay.js"
      : "";

  const env = { ...process.env };
  delete env.JITI_TSCONFIG_PATHS; // the whole point: no opt-in alias resolution
  let stdout;
  try {
    stdout = exec(node, [checkFile, jitiLib, entryAbs, pluginDir, runtimeWorkspace.name, extraRel], {
      cwd: installDir,
      encoding: "utf-8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    return { name: ws.name, ok: false, installDir, error: `import failed: ${firstLine(err)}` };
  }

  const verdict = JSON.parse(stdout.trim().split("\n").pop());

  // X6: every first-party package in the graph, transitively, must have come
  // from its locally packed tarball — a registry copy is a stale copy, and a
  // version-string equality check alone cannot tell the two apart.
  const expected = [{ name: ws.name, tarball: pluginTarball }, ...depTarballs];
  let notLocal = [];
  try {
    const resolved = resolveInstalled(installDir);
    notLocal = expected
      .filter((d) => !isLocalTarball(resolved.get(d.name), d.tarball))
      .map((d) => `${d.name} -> ${resolved.get(d.name) ?? "unresolved"}`);
  } catch (err) {
    notLocal = [`install record unreadable: ${firstLine(err)}`];
  }

  // Secondary signal: the installed runtime's version is the workspace's.
  const localRuntime = verdict.runtimeVersion === runtimeWorkspace.version;
  const ok = Boolean(verdict.ok && verdict.runtimeInsideInstall && localRuntime && notLocal.length === 0) && (!extraRel || verdict.extraOk === true);
  return { name: ws.name, ok, verdict, installDir, localRuntime, notLocal };
}

/** Resolve the jiti CJS bundle from the repo's own dependency graph. */
export function resolveJitiLib(root = REPO_ROOT) {
  const local = join(root, "node_modules/jiti/lib/jiti.cjs");
  if (existsSync(local)) return local;
  // Worktrees may have no local node_modules; fall back to the parent checkout.
  return resolve(root, "../../node_modules/jiti/lib/jiti.cjs");
}

/**
 * npm's own install record. Returns a map of package name -> `resolved`.
 *
 * Read from `node_modules/.package-lock.json` rather than `npm ls`, because
 * `npm ls` relativizes the root's own `file:` dependency into a path that its
 * realpath normalisation then calls `invalid`, and omits `resolved` for it.
 * A registry install records an `https://registry.npmjs.org/...` resolved, a
 * locally packed one a `file:` specifier — which is the only proof of WHICH
 * copy was tested.
 */
export function resolveInstalled(installDir) {
  const parsed = JSON.parse(readFileSync(join(installDir, "node_modules", ".package-lock.json"), "utf-8"));
  const out = new Map();
  for (const [key, info] of Object.entries(parsed.packages ?? {})) {
    if (!key.startsWith("node_modules/")) continue;
    out.set(key.slice("node_modules/".length), info.resolved ?? null);
  }
  return out;
}

/** True when `resolved` points at OUR packed tarball (not a registry copy). */
export function isLocalTarball(resolved, tarball) {
  return typeof resolved === "string" && resolved.startsWith("file:") && basename(resolved) === basename(tarball);
}

/**
 * Workspace dirs touched by a diff against `baseRef` (committed + working tree),
 * as `packages/<dir>` keys.
 */
export function changedPluginRels(root, baseRef, exec = execFileSync) {
  const out = exec("git", ["diff", "--name-only", baseRef, "--"], { cwd: root, encoding: "utf-8" });
  return new Set(out.split("\n").filter(Boolean).map((p) => p.split("/").slice(0, 2).join("/")));
}

/** One line per workspace result, plus the verdict when it failed. */
function reportResult(result, rel, log) {
  log(`${result.ok ? "ok     " : "FAIL   "} ${rel}${result.ok ? "" : `  ${result.error ?? "verdict failed"}`}`);
  if (!result.ok && !result.error) log(`       ${JSON.stringify(result.verdict)}`);
  if (result.notLocal?.length > 0) log(`       not from local tarballs: ${result.notLocal.join(", ")}`);
}

function cleanup(scratch, results) {
  rmSync(scratch, { recursive: true, force: true });
  for (const r of results) if (r.installDir) rmSync(r.installDir, { recursive: true, force: true });
}

export function runInstallLoadCheck({ root = REPO_ROOT, only = null, changedBase = null, log = console.log } = {}) {
  const allWorkspaces = listAllWorkspaces(root);
  const { inScope, skipped } = selectInScope(listPluginWorkspaces(root));

  let selected = inScope;
  if (only) selected = inScope.filter((ws) => ws.rel === only || ws.name === only);
  else if (changedBase) {
    // Per-PR budget (test-plan P2): only the plugins this PR touched, plus the
    // browser plugin — the change's original subject and its own regression test.
    const changed = changedPluginRels(root, changedBase, undefined);
    changed.add("packages/browser-plugin");
    selected = inScope.filter((ws) => changed.has(ws.rel));
    log(`changed vs ${changedBase}: ${selected.map((ws) => ws.rel).join(", ") || "none"}`);
  }

  for (const ws of skipped) log(`skipped ${ws.rel} (${ws.reason})`);

  if (selected.length === 0) {
    log("no in-scope plugin workspace to check");
    return { ok: true, results: [], skipped };
  }

  const scratch = mkdtempSync(join(tmpdir(), "install-load-"));
  const jitiLib = resolveJitiLib(root);
  const results = [];
  try {
    for (const ws of selected) {
      const result = verifyWorkspace(ws, { allWorkspaces, scratch, jitiLib });
      results.push(result);
      reportResult(result, ws.rel, log);
    }
  } finally {
    cleanup(scratch, results);
  }

  return { ok: results.every((r) => r.ok), results, skipped };
}

function main(argv) {
  const onlyFlag = argv.indexOf("--only");
  const only = onlyFlag === -1 ? null : argv[onlyFlag + 1];
  const changedFlag = argv.indexOf("--changed");
  const changedBase = changedFlag === -1 ? null : argv[changedFlag + 1];
  const { ok } = runInstallLoadCheck({ only, changedBase });
  return ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
