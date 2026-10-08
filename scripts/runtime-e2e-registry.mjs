#!/usr/bin/env node
/**
 * runtime-e2e-registry.mjs — local npm registry fixture (Verdaccio) for the
 * Electron runtime-overlay E2E (test-plan X10–X12, task 3.1).
 *
 *   node scripts/runtime-e2e-registry.mjs config  --dir DIR            # write DIR/config.yml (storage in DIR)
 *   node scripts/runtime-e2e-registry.mjs publish --release base|good|broken
 *   node scripts/runtime-e2e-registry.mjs versions                     # print base/good/broken
 *
 * Releases (base = root package.json version, the version the packaged app bundles):
 *   base   — the tree as-is at `base`; lets bundle-server's `npm install`
 *            resolve @blackbelt-technology/* from the registry (tag `base`).
 *   good   — nextPatch(base), dist-tag `latest`: what Check → Update stages.
 *   broken — nextPatch(good), dist-tag `broken`: server `src/cli.ts` exits 1 at boot.
 *
 * Publishes only the runtime closure (server/web/extension/plugin-runtime +
 * every `bundledPlugins` package + their first-party prod deps), from
 * `npm pack` tarballs of the workspaces with versions + first-party specs
 * rewritten — the working tree is never modified. The server is published
 * last, carrying a `runtime-lock.json` generated against this registry
 * (scripts/generate-runtime-lock.mjs --server-dir), exactly like the release
 * pipeline (design R1/R2).
 *
 * MUST NOT reach public npm: REGISTRY (default http://localhost:4873) must be
 * loopback. Idempotent: a name@version already on the registry is skipped.
 *
 * See change: electron-runtime-release-pipeline (task 3.1).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundledPluginPackages, npmArgv, parseFlags, RUNTIME_BASE_PACKAGES, SCOPE, SERVER_PACKAGE } from "./lib/runtime-release.mjs";
import { nextPatch } from "./nightly-verdaccio-publish.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEP_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];

/** `{ base, good, broken }` release versions derived from `base`. */
export function runtimeE2eVersions(base) {
  const good = nextPatch(base);
  return { base, good, broken: nextPatch(good) };
}

/** Workspace packages keyed by name: `{ name, dir, manifest }` (non-private only). */
export function readWorkspaces(repoRoot) {
  const out = new Map();
  for (const d of readdirSync(join(repoRoot, "packages"))) {
    const file = join(repoRoot, "packages", d, "package.json");
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    if (typeof manifest.name === "string" && manifest.private !== true) out.set(manifest.name, { name: manifest.name, dir: join(repoRoot, "packages", d), manifest });
  }
  return out;
}

/**
 * Runtime closure: `roots` plus every first-party workspace reachable through
 * prod/optional/peer deps. Throws when a root is not a publishable workspace.
 */
export function runtimeClosure(workspaces, roots) {
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    const ws = workspaces.get(name);
    if (!ws) throw new Error(`${name} is not a publishable workspace`);
    seen.add(name);
    for (const field of DEP_FIELDS) {
      for (const dep of Object.keys(ws.manifest[field] ?? {})) if (dep.startsWith(`${SCOPE}/`) && workspaces.has(dep)) visit(dep);
    }
  };
  for (const r of roots) visit(r);
  return [...seen];
}

/** Dependencies first (topological), server last (its lock needs everything else published). */
export function publishOrder(workspaces, names) {
  const set = new Set(names);
  const order = [];
  const done = new Set();
  const visit = (name) => {
    if (done.has(name)) return;
    done.add(name);
    const ws = workspaces.get(name);
    for (const field of DEP_FIELDS) for (const dep of Object.keys(ws.manifest[field] ?? {}).sort()) if (set.has(dep) && dep !== SERVER_PACKAGE) visit(dep);
    order.push(name);
  };
  for (const n of [...names].sort()) if (n !== SERVER_PACKAGE) visit(n);
  if (set.has(SERVER_PACKAGE)) order.push(SERVER_PACKAGE);
  return order;
}

/** Copy of `manifest` at `version`, every first-party workspace spec pinned to exactly `version`. */
export function rewriteManifest(manifest, { version, workspaceNames }) {
  const out = structuredClone(manifest);
  out.version = version;
  for (const field of DEP_FIELDS) {
    for (const dep of Object.keys(out[field] ?? {})) if (workspaceNames.has(dep)) out[field][dep] = version;
  }
  delete out.scripts?.prepack;
  delete out.scripts?.prepare;
  delete out.scripts?.postpack;
  return out;
}

/** Server entry for the `broken` release: exits non-zero before binding a port. */
export const BROKEN_CLI = `// runtime-e2e-registry: intentionally broken runtime (test-plan X12).\nconsole.error("[runtime-e2e] broken runtime: exiting at boot");\nprocess.exit(1);\n`;

export function assertLoopback(registry) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(registry)) {
    throw new Error(`Refusing: REGISTRY='${registry}' is not a loopback registry (the fixture MUST NOT reach public npm).`);
  }
}

export function verdaccioConfig(storageDir) {
  // Same ACL/uplinks as .github/verdaccio/config.yml; storage in a throwaway dir.
  return [
    `storage: ${JSON.stringify(storageDir)}`,
    "uplinks:",
    "  npmjs:",
    "    url: https://registry.npmjs.org/",
    "    maxage: 60m",
    "packages:",
    "  '@blackbelt-technology/*':",
    "    access: $all",
    "    publish: $all",
    "    unpublish: $all",
    "  '**':",
    "    access: $all",
    "    publish: $all",
    "    proxy: npmjs",
    "max_body_size: 500mb",
    "web:",
    "  enable: false",
    "log: { type: stdout, format: pretty, level: warn }",
    "",
  ].join("\n");
}

function npm(args, opts = {}) {
  const [cmd, ...prefix] = npmArgv();
  return execFileSync(cmd, [...prefix, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
}

function publishRelease(release, registry) {
  const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const versions = runtimeE2eVersions(root.version);
  const version = versions[release];
  if (!version) throw new Error(`--release must be base, good or broken (got ${release})`);
  const tag = release === "good" ? "latest" : release;

  const workspaces = readWorkspaces(REPO_ROOT);
  const roots = [...RUNTIME_BASE_PACKAGES, ...bundledPluginPackages(REPO_ROOT).map((p) => p.name)];
  const order = publishOrder(workspaces, runtimeClosure(workspaces, roots));
  const workspaceNames = new Set(workspaces.keys());
  const env = { ...process.env, npm_config_registry: registry, [`npm_config_//${new URL(registry).host}/:_authToken`]: "runtime-e2e" };

  const work = mkdtempSync(join(tmpdir(), `runtime-e2e-${release}-`));
  console.log(`Publishing ${order.length} package(s) at ${version} (tag ${tag}) → ${registry}`);
  try {
    for (const name of order) {
      try {
        if (npm(["view", `${name}@${version}`, "version"], { env, stdio: ["ignore", "pipe", "ignore"] }).trim() === version) {
          console.log(`skip ${name}@${version} (already published)`);
          continue;
        }
      } catch {
        /* not published yet */
      }
      const ws = workspaces.get(name);
      const dest = join(work, name.replace("/", "__"));
      mkdirSync(dest, { recursive: true });
      npm(["pack", "--ignore-scripts", "--pack-destination", dest], { cwd: ws.dir, env, stdio: ["ignore", "pipe", "inherit"] });
      const tgz = readdirSync(dest).find((f) => f.endsWith(".tgz"));
      execFileSync("tar", ["-xzf", tgz], { cwd: dest });
      const pkgDir = join(dest, "package");
      const manifest = rewriteManifest(JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")), { version, workspaceNames });
      writeFileSync(join(pkgDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      if (name === SERVER_PACKAGE) {
        if (release === "broken") writeFileSync(join(pkgDir, "src", "cli.ts"), BROKEN_CLI);
        execFileSync(process.execPath, [join(REPO_ROOT, "scripts", "generate-runtime-lock.mjs"), "--version", version, "--server-dir", pkgDir, "--registry", registry], { env, stdio: "inherit" });
      }
      npm(["publish", pkgDir, "--tag", tag, "--ignore-scripts", "--no-provenance", "--registry", registry], { env, stdio: ["ignore", "inherit", "inherit"] });
      rmSync(join(dest, tgz), { force: true });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`✓ ${release} ${version} published`);
  if (process.env.GITHUB_ENV) writeFileSync(process.env.GITHUB_ENV, `PW_RUNTIME_${release.toUpperCase()}=${version}\n`, { flag: "a" });
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const registry = process.env.REGISTRY || "http://localhost:4873";
  if (cmd === "config") {
    const dir = resolve(typeof flags.dir === "string" ? flags.dir : mkdtempSync(join(tmpdir(), "runtime-e2e-verdaccio-")));
    mkdirSync(join(dir, "storage"), { recursive: true });
    writeFileSync(join(dir, "config.yml"), verdaccioConfig(join(dir, "storage")));
    console.log(join(dir, "config.yml"));
    return;
  }
  if (cmd === "versions") {
    console.log(JSON.stringify(runtimeE2eVersions(JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version)));
    return;
  }
  if (cmd === "publish") {
    assertLoopback(registry);
    publishRelease(String(flags.release), registry);
    return;
  }
  throw new Error("usage: runtime-e2e-registry.mjs config|versions|publish --release base|good|broken");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`::error::runtime-e2e-registry: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
