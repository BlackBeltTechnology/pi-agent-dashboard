#!/usr/bin/env node
/**
 * generate-runtime-lock.mjs — write `runtime-lock.json` (npm lockfile v3) for
 * runtime release X into packages/server, so `npm publish` of
 * @blackbelt-technology/pi-dashboard-server@X ships it (`files`).
 *
 *   node scripts/generate-runtime-lock.mjs --version X [--registry URL] [--out FILE] [--server-dir DIR]
 *
 * `--server-dir` packs an already-prepared server package dir instead of
 * packages/server (the E2E registry fixture rewrites versions in extracted
 * tarballs); `--out` then defaults to `<server-dir>/runtime-lock.json`.
 *
 * Lock root = server + web + extension + dashboard-plugin-runtime + every
 * `piDashboard.bundledPlugins` package, all pinned at exactly X (the server
 * does not depend on the plugins, so they are listed explicitly). Meta is not
 * included (design R1).
 *
 * MUST run after every package except server + meta is published at X (the
 * lock resolves them from the registry) and BEFORE the server is published:
 * the server is packed locally and added as a `file:` tarball, then its entry
 * is rewritten to the registry tarball URL WITHOUT integrity — a lock inside
 * server@X cannot carry server@X's own hash (design R1). Every other entry
 * keeps registry integrity.
 *
 * Consumed by the overlay stager (`buildSyntheticRoot` + `npm ci --omit=dev`).
 * Not `npm-shrinkwrap.json`: a standalone `npm i -g` stays unaffected.
 *
 * See change: electron-runtime-release-pipeline (task 2.1).
 */
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundledPluginPackages, parseFlags, RUNTIME_BASE_PACKAGES, runNpm, SCOPE, SERVER_PACKAGE } from "./lib/runtime-release.mjs";

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const SERVER_TARBALL = "server.tgz";

/** Registry tarball URL of `name@version` (npm's canonical layout). */
export function serverTarballUrl(registry, name, version) {
  const base = name.split("/").pop();
  return `${String(registry).replace(/\/+$/, "")}/${name}/-/${base}-${version}.tgz`;
}

/** Temp-root package.json: every package at exactly X; server from the local tarball. */
export function buildRuntimeRootManifest({ version, packages, serverSpec }) {
  const dependencies = {};
  for (const p of packages) dependencies[p] = p === SERVER_PACKAGE ? serverSpec : version;
  return { name: "pi-dashboard-runtime", version, private: true, dependencies };
}

/**
 * Rewrite the server self-reference and validate the lock. Throws when: the
 * root is not at X; a required package is absent; any first-party package in
 * the tree is not at X (lockstep); any other entry resolves locally (`file:`).
 */
export function finalizeRuntimeLock(raw, { version, packages, registry = DEFAULT_REGISTRY }) {
  const lock = structuredClone(raw);
  const root = lock.packages?.[""];
  if (!root || root.version !== version) throw new Error(`lock root is ${root?.version ?? "missing"}, expected ${version}`);
  lock.name = root.name = "pi-dashboard-runtime";
  lock.version = version;

  const serverKey = `node_modules/${SERVER_PACKAGE}`;
  if (root.dependencies?.[SERVER_PACKAGE] !== undefined) root.dependencies[SERVER_PACKAGE] = version;
  const server = lock.packages[serverKey];
  if (server) {
    server.resolved = serverTarballUrl(registry, SERVER_PACKAGE, version);
    delete server.integrity;
  }

  const missing = packages.filter((p) => !lock.packages[`node_modules/${p}`]);
  if (missing.length) throw new Error(`runtime lock lacks ${missing.join(", ")}`);
  const problems = lockProblems(lock, version);
  if (problems.length) throw new Error(`invalid runtime lock:\n  ${problems.join("\n  ")}`);
  return lock;
}

/** Local (`file:`) resolutions + first-party packages not at X, anywhere in the tree. */
function lockProblems(lock, version) {
  const problems = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === "") continue;
    if (typeof entry.resolved === "string" && entry.resolved.startsWith("file:")) problems.push(`${key} resolves locally (${entry.resolved})`);
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    if (name.startsWith(`${SCOPE}/`) && !entry.link && entry.version !== version) problems.push(`lockstep: ${name}@${entry.version} at ${key}`);
  }
  return problems;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const version = typeof flags.version === "string" ? flags.version : process.env.VERSION;
  if (!version) throw new Error("--version X is required");
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const serverDir = typeof flags["server-dir"] === "string" ? flags["server-dir"] : join(repoRoot, "packages", "server");
  const out = typeof flags.out === "string" ? flags.out : join(serverDir, "runtime-lock.json");
  const registry = typeof flags.registry === "string" ? flags.registry : process.env.npm_config_registry || DEFAULT_REGISTRY;
  const registryArgs = [`--registry=${registry}`];

  const serverPkg = JSON.parse(readFileSync(join(serverDir, "package.json"), "utf8"));
  if (serverPkg.version !== version) throw new Error(`${serverDir} is at ${serverPkg.version}, expected ${version}`);

  const packages = [...RUNTIME_BASE_PACKAGES, ...bundledPluginPackages(repoRoot).map((p) => p.name)];
  rmSync(out, { force: true }); // never pack a stale lock into the local server tarball
  const work = mkdtempSync(join(tmpdir(), "runtime-lock-"));
  try {
    await runNpm(["pack", "--pack-destination", work, "--ignore-scripts"], { cwd: serverDir });
    const tgz = readdirSync(work).filter((f) => f.endsWith(".tgz"));
    if (tgz.length !== 1) throw new Error(`npm pack produced ${tgz.length} tarballs`);
    renameSync(join(work, tgz[0]), join(work, SERVER_TARBALL));

    const manifest = buildRuntimeRootManifest({ version, packages, serverSpec: `file:${SERVER_TARBALL}` });
    writeFileSync(join(work, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    // --allow-remote=all: npm 12 refuses bundleDependencies tarballs
    // (EALLOWREMOTE on @tailwindcss/oxide-wasm32-wasi) while building the tree.
    await runNpm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--allow-remote=all", ...registryArgs], { cwd: work });

    const raw = JSON.parse(readFileSync(join(work, "package-lock.json"), "utf8"));
    const lock = finalizeRuntimeLock(raw, { version, packages, registry });
    writeFileSync(out, `${JSON.stringify(lock, null, 2)}\n`);
    const count = Object.keys(lock.packages).length - 1;
    console.log(`runtime-lock.json: ${count} packages, ${packages.length} pinned at ${version} → ${out}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### runtime-lock.json\n\n${count} packages; pinned at \`${version}\`: ${packages.map((p) => `\`${p}\``).join(", ")}\n\n`, { flag: "a" });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`::error::generate-runtime-lock: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
