#!/usr/bin/env node
/**
 * build-runtime-asset.mjs — build the GitHub runtime asset for release X on
 * the CURRENT platform/arch (design R3; spike 1.1 → per-platform assets).
 *
 *   node --import tsx scripts/build-runtime-asset.mjs --version X --out DIR [--lock FILE]
 *
 * `--lock FILE` uses a local runtime-lock.json instead of server@X's (dry run
 * before the server is published).
 *
 * Runs the consumer's own install path: `stageRuntime` (npm source) from
 * packages/server/src/runtime-overlay/runtime-stager.ts — runtime-lock.json of
 * server@X → synthetic root → `npm ci --omit=dev` → lockstep → plugin
 * materialization → runtime-manifest.json. Then:
 *   - prunes `node_modules/**\/.bin` symlinks (the consumer's extractor refuses
 *     every link member; nothing in the runtime execs a `.bin` shim) and
 *     fails on any other symlink;
 *   - tars the tree ROOT entries (no `./` prefix) into
 *     `pi-dashboard-runtime-<X>-<platform>-<arch>.tgz`;
 *   - writes `<asset>.sha512` (`<hex>  <asset>`; consumer reads token 1).
 *
 * MUST run after server@X (carrying runtime-lock.json) is on the registry.
 *
 * See change: electron-runtime-release-pipeline (task 2.3).
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseFlags, runNpm, runtimeAssetName, SERVER_PACKAGE } from "./lib/runtime-release.mjs";

const execFileAsync = promisify(execFile);
const TAR_OPTS = { maxBuffer: 512 * 1024 * 1024, timeout: 30 * 60_000 };

/**
 * Remove every symlink whose parent dir is `.bin`; throw on any other
 * symlink (it would be refused by the consumer as `unsafe_archive`).
 * Returns the number of pruned links.
 */
export function pruneBinLinks(root) {
  let pruned = 0;
  const others = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isSymbolicLink()) {
        if (basename(dir) === ".bin") {
          unlinkSync(p);
          pruned++;
        } else others.push(relative(root, p));
      } else if (ent.isDirectory()) stack.push(p);
    }
  }
  if (others.length) throw new Error(`runtime tree has symlinks outside .bin: ${others.slice(0, 10).join(", ")}`);
  return pruned;
}

/** `.sha512` file body: hex digest, two spaces, asset name. */
export function sha512Line(hex, assetName) {
  return `${hex}  ${assetName}\n`;
}

async function sha512Of(file) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export function stagerDeps(localLock) {
  return {
    platform: process.platform,
    arch: process.arch,
    runNpm: async (args, cwd) => {
      await runNpm(args, { cwd });
    },
    fetchRuntimeLock: async (version, workDir) => {
      if (localLock) return JSON.parse(readFileSync(localLock, "utf8"));
      await runNpm(["pack", `${SERVER_PACKAGE}@${version}`, "--pack-destination", workDir], { cwd: workDir });
      const tgz = readdirSync(workDir).filter((f) => f.endsWith(".tgz"));
      if (tgz.length !== 1) throw new Error(`npm pack produced ${tgz.length} tarballs`);
      await execFileAsync("tar", ["-xzf", tgz[0], "package/runtime-lock.json"], { ...TAR_OPTS, cwd: workDir });
      return JSON.parse(readFileSync(join(workDir, "package", "runtime-lock.json"), "utf8"));
    },
    fetchGithubAsset: async () => {
      throw new Error("build-runtime-asset stages from npm only");
    },
    extractTgz: async () => {
      throw new Error("build-runtime-asset stages from npm only");
    },
  };
}

/**
 * Stage release X via the consumer's `stageRuntime`, prune `.bin` links, tar
 * and checksum into `outDir`. `deps` defaults to real npm (server@X's lock or
 * `localLock`). Returns `{ asset, sha512 }`.
 */
export async function buildRuntimeAsset({ version, outDir, deps = stagerDeps(), log = console.log }) {
  const assetName = runtimeAssetName(version, deps.platform, deps.arch);
  // Consumer code (TypeScript) — run under `node --import tsx`.
  const { stageRuntime } = await import("../packages/server/src/runtime-overlay/runtime-stager.ts");
  const dir = mkdtempSync(join(tmpdir(), "runtime-asset-"));
  try {
    const { root } = await stageRuntime({
      dir,
      version,
      source: "npm",
      deps,
      onProgress: (p) => p.phase !== "install" && log(`[${p.phase}] ${p.message ?? ""}`),
    });
    log(`pruned ${pruneBinLinks(root)} .bin symlink(s)`);

    // Relative output path + root entry names: no drive letters (GNU tar on
    // Windows reads `C:` as a remote host) and no `./` member prefix.
    const entries = readdirSync(root).sort();
    await execFileAsync("tar", ["-czf", join("..", assetName), ...entries], { ...TAR_OPTS, cwd: root });
    const built = join(dirname(root), assetName);
    const { stdout } = await execFileAsync("tar", ["-tvzf", built], TAR_OPTS);
    const link = String(stdout).split(/\r?\n/).find((l) => /^[lh]/.test(l));
    if (link) throw new Error(`asset still has a link member: ${link.trim()}`);

    mkdirSync(outDir, { recursive: true });
    const asset = join(outDir, assetName);
    rmSync(asset, { force: true });
    renameSync(built, asset);
    const sha512 = await sha512Of(asset);
    writeFileSync(`${asset}.sha512`, sha512Line(sha512, assetName));
    return { asset, sha512 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const version = typeof flags.version === "string" ? flags.version : process.env.VERSION;
  if (!version) throw new Error("--version X is required");
  const outDir = typeof flags.out === "string" ? flags.out : "dist-runtime";
  const deps = stagerDeps(typeof flags.lock === "string" ? flags.lock : undefined);
  const { asset, sha512 } = await buildRuntimeAsset({ version, outDir, deps });
  const mb = (lstatSync(asset).size / 1024 / 1024).toFixed(1);
  console.log(`${asset} (${mb} MiB) sha512=${sha512.slice(0, 16)}…`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### Runtime asset\n\n\`${basename(asset)}\` — ${mb} MiB, sha512 \`${sha512.slice(0, 16)}…\`\n\n`, { flag: "a" });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`::error::build-runtime-asset: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
