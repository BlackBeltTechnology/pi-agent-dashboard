#!/usr/bin/env node
/**
 * assert-runtime-release.mjs — post-release assertion of the published runtime
 * shape (test-plan #X16). Modelled on
 * packages/electron/scripts/assert-runnable-bundle.mjs: pure `check*` returns
 * the problem list; the CLI gathers facts and exits 1 on any problem.
 *
 *   node scripts/assert-runtime-release.mjs --version X --tag vX --prerelease true|false
 *
 * Facts: GitHub Release assets (`gh release view`, works on drafts), npm
 * dist-tags of the server, and `runtime-manifest.json` inside the linux-x64
 * asset. Observable: every RUNTIME_ASSET_TARGETS asset + `.sha512` attached;
 * `beta` (prerelease) / `latest` (stable) = X; manifest version = X.
 *
 * See change: electron-runtime-release-pipeline (task 2.4).
 */
import { execFile } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseFlags, RUNTIME_ASSET_TARGETS, runNpm, runtimeAssetName, SERVER_PACKAGE } from "./lib/runtime-release.mjs";

const execFileAsync = promisify(execFile);

/** Problems with the published runtime release; `[]` = shape OK. */
export function checkRuntimeRelease({ version, prerelease, targets, assets, distTags, manifestVersion }) {
  const problems = [];
  const have = new Set(assets);
  for (const { platform, arch } of targets) {
    const name = runtimeAssetName(version, platform, arch);
    for (const want of [name, `${name}.sha512`]) if (!have.has(want)) problems.push(`GitHub Release lacks asset ${want}`);
  }
  const tag = prerelease ? "beta" : "latest";
  if (distTags?.[tag] !== version) problems.push(`npm dist-tag ${tag} of ${SERVER_PACKAGE} is ${distTags?.[tag] ?? "<unset>"}, expected ${version}`);
  if (manifestVersion !== version) problems.push(`runtime manifest version is ${manifestVersion ?? "<missing>"}, expected ${version}`);
  return problems;
}

async function gh(args, opts = {}) {
  const { stdout } = await execFileAsync("gh", args, { maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60_000, ...opts });
  return String(stdout);
}

async function fetchDistTags(want, version) {
  let distTags = {};
  for (let attempt = 1; attempt <= 5; attempt++) {
    const parsed = JSON.parse(await runNpm(["view", "--prefer-online", SERVER_PACKAGE, "dist-tags", "--json"], { cwd: tmpdir(), timeout: 60_000 }));
    distTags = Array.isArray(parsed) ? (parsed[0] ?? {}) : parsed;
    if (distTags[want] === version) break;
    if (attempt < 5) await new Promise((r) => setTimeout(r, attempt * 15_000));
  }
  return distTags;
}

/** `runtime-manifest.json` version inside the linux-x64 asset (undefined when absent). */
async function fetchManifestVersion(tag, version, assets) {
  const probe = runtimeAssetName(version, "linux", "x64");
  if (!assets.includes(probe)) return undefined;
  const work = mkdtempSync(join(tmpdir(), "runtime-release-"));
  try {
    await gh(["release", "download", tag, "--pattern", probe, "--dir", work]);
    await execFileAsync("tar", ["-xzf", probe, "runtime-manifest.json"], { cwd: work });
    return JSON.parse(readFileSync(join(work, "runtime-manifest.json"), "utf8")).version;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function report(version, prerelease, problems) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (problems.length === 0) {
    console.log(`ok  runtime release ${version}: ${RUNTIME_ASSET_TARGETS.length} asset(s) + .sha512, ${prerelease ? "beta" : "latest"}=${version}, manifest=${version}`);
    if (summary) appendFileSync(summary, `### Runtime release shape\n\n✅ ${version}: assets, dist-tag and manifest verified.\n\n`);
    return true;
  }
  for (const p of problems) console.error(`::error::${p}`);
  if (summary) appendFileSync(summary, `### Runtime release shape\n\n❌\n${problems.map((p) => `- ${p}`).join("\n")}\n\n`);
  return false;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const version = String(flags.version ?? "");
  const tag = String(flags.tag ?? `v${version}`);
  const prerelease = String(flags.prerelease) === "true";
  if (!version) throw new Error("--version X is required");

  const rel = JSON.parse(await gh(["release", "view", tag, "--json", "assets,isPrerelease"]));
  const assets = (rel.assets ?? []).map((a) => a.name);
  if (Boolean(rel.isPrerelease) !== prerelease) console.error(`::warning::GitHub Release ${tag} isPrerelease=${rel.isPrerelease}, expected ${prerelease}`);
  const distTags = await fetchDistTags(prerelease ? "beta" : "latest", version);
  const manifestVersion = await fetchManifestVersion(tag, version, assets);
  const problems = checkRuntimeRelease({ version, prerelease, targets: RUNTIME_ASSET_TARGETS, assets, distTags, manifestVersion });
  if (!report(version, prerelease, problems)) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`::error::assert-runtime-release: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
