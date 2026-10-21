#!/usr/bin/env node
/**
 * Stages the runtime-delivery canary for the docker e2e harness (`docker/test-up.sh`, task 7.5 / 8.2).
 *
 *   node scripts/stage-runtime-canary.mjs --out <dir> [--mode trusted|untrusted] [--no-build]
 *
 * Builds the canary ONCE (`scripts/build-runtime-canary.mjs`), hashes the built client asset root with the SERVER'S
 * content hasher (`client-content-hash.ts`, so the pin the harness seeds equals the hash the registry computes), and
 * lays out what `docker/test-entrypoint.sh` copies into `~/.pi/dashboard/plugins/`:
 *
 *   <out>/plugins/runtime-canary[-<variant>]/{package.json, dist/client, dist/standalone, src/server}
 *   <out>/auth-trust.json   [{ id, clientSha256 }]  — `auth.trustedPlugins` entries to seed ([] when untrusted)
 *   <out>/manifest.json     { mode, plugins: { <id>: <sha256> } }
 *
 * Modes: `trusted` (default) = the base canary only, pinned. `untrusted` = the base canary WITHOUT a trust entry plus
 * the four failure variants copied next to it (their manifest ids are already unique: `runtime-canary-<variant>`),
 * so a spec can trust each through `POST /api/plugins/<id>/trust`. Nothing is rebuilt after the hash is taken.
 *
 * See change: decouple-plugins-from-core (tasks 7.5, 8.2).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANARY_ROOT = path.join(repoRoot, "tests/fixtures/runtime-canary-plugin");
export const VARIANTS = ["missing-export", "bundled-react", "throws-in-render", "bundled-app-kit"];

/** Content hash of a client asset root, by the server's hasher. */
export async function contentHashOf(dir) {
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const { createContentHasher } = await jiti.import(
    path.join(repoRoot, "packages/dashboard-plugin-runtime/src/server/client-content-hash.ts"),
  );
  return createContentHasher().hashDir(dir);
}

function copyInto(src, dest, rel) {
  const from = path.join(src, rel);
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, path.join(dest, rel), { recursive: true });
}

/** Copy one plugin package (manifest + built client + standalone + server entry) and return its client content hash. */
async function stageOne(srcRoot, destRoot, hashDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(srcRoot, "package.json"), "utf8"));
  const id = manifest["pi-dashboard-plugin"].id;
  const dest = path.join(destRoot, "plugins", id);
  fs.mkdirSync(dest, { recursive: true });
  copyInto(srcRoot, dest, "package.json");
  copyInto(srcRoot, dest, "dist/client");
  copyInto(srcRoot, dest, "dist/standalone");
  copyInto(srcRoot, dest, "src/server");
  const sha = await hashDir(path.join(dest, "dist/client"));
  if (!/^[0-9a-f]{64}$/.test(sha ?? "")) throw new Error(`stage-runtime-canary: no content hash for ${id} (is ${srcRoot}/dist/client built?)`);
  return { id, sha };
}

/**
 * Lay out the staged canary under `outDir` (recreated). `hashDir` is injectable for tests; `canaryRoot` defaults to the
 * repo fixture. Pure of any build: call `buildRuntimeCanary` first.
 */
export async function stageRuntimeCanary({ outDir, mode = "trusted", canaryRoot = CANARY_ROOT, hashDir = contentHashOf, variants = VARIANTS }) {
  if (mode !== "trusted" && mode !== "untrusted") throw new Error(`stage-runtime-canary: unknown mode "${mode}" (trusted|untrusted)`);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const plugins = {};
  const base = await stageOne(canaryRoot, outDir, hashDir);
  plugins[base.id] = base.sha;
  // Arms the canary server entry's global intent broadcast (F16: untrusted client, server-driven UI) — untrusted mode only,
  // so the stock trusted harness shows no extra badge on session cards. Outside `dist/client`: the pin is unaffected.
  if (mode === "untrusted") fs.writeFileSync(path.join(outDir, "plugins", base.id, "intent.flag"), "1\n");
  if (mode === "untrusted") {
    for (const v of variants) {
      const staged = await stageOne(path.join(canaryRoot, "variants", v), outDir, hashDir);
      plugins[staged.id] = staged.sha;
    }
  }
  const trust = mode === "trusted" ? [{ id: base.id, clientSha256: base.sha }] : [];
  fs.writeFileSync(path.join(outDir, "auth-trust.json"), `${JSON.stringify(trust)}\n`);
  fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify({ mode, plugins }, null, 2)}\n`);
  return { mode, plugins, trust };
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = argValue("--out");
  if (!out) {
    console.error("usage: stage-runtime-canary.mjs --out <dir> [--mode trusted|untrusted] [--no-build]");
    process.exit(2);
  }
  if (!process.argv.includes("--no-build")) {
    const { buildRuntimeCanary } = await import("./build-runtime-canary.mjs");
    await buildRuntimeCanary();
  }
  const staged = await stageRuntimeCanary({ outDir: path.resolve(out), mode: argValue("--mode") ?? "trusted" });
  console.info(`[stage-runtime-canary] ${staged.mode}: ${Object.keys(staged.plugins).join(", ")} → ${out}`);
}
