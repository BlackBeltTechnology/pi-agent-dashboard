#!/usr/bin/env node
/**
 * Shared bundle prune — the ONE place that decides which files of
 * `resources/server` never ship. Callers: `bundle-server.mjs` (full mode),
 * `docker-make.sh` (via the CLI wrapper below); `build-windows-zip.sh` gets its
 * tree from `bundle-server.mjs`.
 *
 * Why: the Windows NSIS install cost scales with FILE COUNT (one NTFS create +
 * one Defender scan per file), not bytes.
 *
 * Two rule sets, chosen by where a path sits:
 *   - third-party (everything under `node_modules` except `@blackbelt-technology/*`):
 *     files `*.md *.map CHANGELOG* LICENSE* *.d.ts *.d.mts *.d.cts` (keep
 *     `LICENSE.third-party.md`), directories `__tests__ test tests` — never a
 *     directory that holds a `package.json` (package-root guard, any depth).
 *   - first-party (`node_modules/@blackbelt-technology/*` except `pi-dashboard-web`,
 *     and `resources/plugins/<id>`): only `AGENTS.md` / `*.AGENTS.md` outside any
 *     `.pi/` directory, plus `__tests__` directories. Skills, commands, agents,
 *     references and licences are read at runtime and are kept.
 * `pi-dashboard-web` and `packages/dist` (the served client) are never touched.
 * A `node_modules` nested inside a first-party package switches back to third-party.
 *
 * Fail fast: a filesystem error (remove OR read) aborts with the offending path (a
 * half-pruned bundle must not ship). Symlinks are never followed.
 *
 * `dropWorkspaceCopies` is the other half of the canonical layout: after the
 * workspace symlinks are materialized under `node_modules/@blackbelt-technology/`,
 * `packages/<dir>` is a second copy of the same trees nothing reads. It deletes
 * every `packages/*` child except `dist` (the served client) and drops the
 * synthetic `package.json#workspaces` to `[]`: the install that read it already ran, but the
 * field doubles as the bundled-root marker `findMonorepoRoot` (dashboard-plugin-runtime
 * loader) stops at. Removing it lets that walk escape the bundle and adopt a checkout the
 * packaged app happens to sit in (CI e2e, `out/` of a dev build) as the plugin workspace.
 *
 * Usage: node prune-bundle.mjs [--finalize] <serverDir>
 *   --finalize  dropWorkspaceCopies, then pruneBundle (docker-make.sh)
 * See change: slim-windows-install-file-count (design D1).
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIRST_PARTY_SCOPE = "@blackbelt-technology";
const SERVED_CLIENT_PKG = "pi-dashboard-web";
const KEEP_NOTICE = "LICENSE.third-party.md";

/** Third-party file rule (today's set + `*.d.mts` / `*.d.cts`). */
function thirdPartyFile(name) {
  if (name === KEEP_NOTICE) return false;
  return (
    name.endsWith(".md") ||
    name.endsWith(".map") ||
    name.startsWith("CHANGELOG") ||
    name.startsWith("LICENSE") ||
    name.endsWith(".d.ts") ||
    name.endsWith(".d.mts") ||
    name.endsWith(".d.cts")
  );
}

const thirdPartyDir = (name) => name === "__tests__" || name === "test" || name === "tests";

/** First-party file rule: AGENTS.md sidecars only (the `.pi/` exemption is the caller's). */
const firstPartyFile = (name) => name === "AGENTS.md" || name.endsWith(".AGENTS.md");

const firstPartyDir = (name) => name === "__tests__";

/**
 * Directory entries. A directory that does not exist is empty (`resources/plugins` and
 * `node_modules` are optional); any other read error aborts: a skipped subtree would ship
 * unpruned and the build would still pass.
 */
function readDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return [];
    throw new Error(`prune failed to read ${dir}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** True when `dir` directly contains a `package.json` (a package root). */
const isPackageRoot = (dir) => readDir(dir).some((e) => e.name === "package.json" && e.isFile());

/** Number of regular files under `dir` (symlinks not followed). */
function countFiles(dir) {
  let n = 0;
  for (const e of readDir(dir)) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) n += countFiles(full);
    else if (e.isFile()) n += 1;
  }
  return n;
}

/** Sort one directory entry: record a prune target, or push a directory to descend into. */
function visit(e, full, { mode, inPi }, acc, stack) {
  if (e.isFile()) {
    const hit = mode === "third" ? thirdPartyFile(e.name) : !inPi && firstPartyFile(e.name);
    if (hit) acc.push({ path: full, group: mode, isDir: false });
    return;
  }
  if (!e.isDirectory()) return; // symlinks and specials are never followed or removed
  if (e.name === "node_modules") {
    stack.push({ dir: full, mode: "third", inPi: false });
    return;
  }
  const dirHit = mode === "third" ? thirdPartyDir(e.name) && !isPackageRoot(full) : firstPartyDir(e.name);
  if (dirHit) acc.push({ path: full, group: mode, isDir: true });
  else stack.push({ dir: full, mode, inPi: inPi || e.name === ".pi" });
}

/**
 * Collect prune targets under `root`.
 * `mode` is "third" or "first"; `inPi` is true below a `.pi/` directory (first-party only).
 */
function collect(root, mode, acc) {
  const stack = [{ dir: root, mode, inPi: false }];
  while (stack.length) {
    const ctx = stack.pop();
    for (const e of readDir(ctx.dir)) visit(e, path.join(ctx.dir, e.name), ctx, acc, stack);
  }
}

/** Walk `node_modules`, switching to the first-party rule set inside `@blackbelt-technology/<pkg>`. */
function collectNodeModules(nm, acc) {
  for (const e of readDir(nm)) {
    const full = path.join(nm, e.name);
    if (!e.isDirectory()) {
      if (e.isFile() && thirdPartyFile(e.name)) acc.push({ path: full, group: "third", isDir: false });
      continue;
    }
    if (e.name !== FIRST_PARTY_SCOPE) {
      // Top-level package (or another scope): third-party rules, with the root guard on the dir itself.
      collect(full, "third", acc);
      continue;
    }
    for (const pkg of readDir(full)) {
      const pkgDir = path.join(full, pkg.name);
      if (!pkg.isDirectory() || pkg.name === SERVED_CLIENT_PKG) continue;
      collect(pkgDir, "first", acc);
    }
  }
}

/**
 * Prune `serverDir` (a `resources/server`-shaped tree). Returns
 * `{ removedFiles: { thirdParty, firstParty } }` — file counts, including the
 * files inside removed directories. Throws on the first filesystem error.
 *
 * @param {string} serverDir
 * @param {{ rm?: (p: string, o?: object) => void, log?: (m: string) => void }} [opts]
 */
export function pruneBundle(serverDir, opts = {}) {
  const rm = opts.rm ?? rmSync;
  const log = opts.log ?? ((m) => console.log(m));
  const acc = [];

  const nm = path.join(serverDir, "node_modules");
  collectNodeModules(nm, acc);
  for (const plugin of readDir(path.join(serverDir, "resources", "plugins"))) {
    if (plugin.isDirectory()) collect(path.join(serverDir, "resources", "plugins", plugin.name), "first", acc);
  }

  const removedFiles = { thirdParty: 0, firstParty: 0 };
  for (const t of acc) {
    const files = t.isDir ? countFiles(t.path) : 1;
    try {
      rm(t.path, { recursive: true, force: true });
    } catch (err) {
      throw new Error(`prune failed at ${t.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    removedFiles[t.group === "third" ? "thirdParty" : "firstParty"] += files;
  }
  log(
    `  Pruned ${removedFiles.thirdParty + removedFiles.firstParty} file(s) ` +
      `(third-party ${removedFiles.thirdParty}, first-party ${removedFiles.firstParty})`,
  );
  return { removedFiles };
}

/**
 * Remove the second copy of every workspace package: every `packages/*` child
 * except `dist`, and empties `package.json#workspaces` (kept as `[]`, see the file header).
 * Returns the removed child names.
 *
 * @param {string} serverDir
 * @param {{ rm?: (p: string, o?: object) => void, log?: (m: string) => void }} [opts]
 */
export function dropWorkspaceCopies(serverDir, opts = {}) {
  const rm = opts.rm ?? rmSync;
  const log = opts.log ?? ((m) => console.log(m));
  const removed = [];
  for (const e of readDir(path.join(serverDir, "packages"))) {
    if (e.name === "dist") continue;
    const full = path.join(serverDir, "packages", e.name);
    try {
      rm(full, { recursive: true, force: true });
    } catch (err) {
      throw new Error(`workspace copy removal failed at ${full}: ${err instanceof Error ? err.message : String(err)}`);
    }
    removed.push(e.name);
  }
  const pkgPath = path.join(serverDir, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if ("workspaces" in pkg) {
      pkg.workspaces = [];
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }
  }
  log(`  Dropped ${removed.length} workspace copy dir(s) under packages/ (kept dist), emptied package.json#workspaces`);
  return removed;
}

/** CLI entry. Returns the process exit code (injectable for tests). */
export function main(argv, deps = {}) {
  const error = deps.error ?? ((m) => console.error(m));
  const finalize = argv.includes("--finalize");
  const serverDir = argv.find((a) => !a.startsWith("--"));
  if (!serverDir) {
    error("usage: prune-bundle.mjs [--finalize] <serverDir>");
    return 2;
  }
  const resolved = path.resolve(serverDir);
  if (!existsSync(resolved)) {
    // A mistyped build path must not read as "pruned 0 files".
    error(`\u2717 server bundle dir not found: ${resolved}`);
    return 2;
  }
  try {
    if (finalize) dropWorkspaceCopies(resolved, { rm: deps.rm, log: deps.log });
    pruneBundle(resolved, { rm: deps.rm, log: deps.log });
    return 0;
  } catch (err) {
    error(`\u2717 ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
