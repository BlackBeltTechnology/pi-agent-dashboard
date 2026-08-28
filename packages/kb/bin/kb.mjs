#!/usr/bin/env node
// Committed, NEVER-BUILT plain-JS bin shim (design D1,
// change fix-kb-eval-measurement-integrity). The old bin pointed straight at
// dist/cli.js — a tsc artifact that is gitignored and only rebuilt by hand, so
// the `kb` CLI silently ran a week-old engine while the kb_search tool ran the
// working tree. This shim makes the divergence impossible to miss:
//
//   fingerprint present + srcHash/tsconfigHash/distHash all match
//     → import dist/cli.js (silent, the hot path);
//   mismatch / missing fingerprint in a dev checkout (tsconfig.json resolvable)
//     → rebuild via the nearest typescript install, refresh the fingerprint,
//       import;
//   mismatch in an installed package (no tsconfig — the tarball ships src + the
//     fingerprint but not the tsconfig chain)
//     → loud stderr warning, import dist/cli.js unchanged;
//   dist/cli.js missing in an installed package
//     → hard error naming the divergence.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { computeDistHash, computeSrcHash, computeTsconfigHash, readCommittedFingerprint, writeFingerprint } from "./lib/engine-fingerprint.mjs";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distCli = join(pkgRoot, "dist", "cli.js");

/** Nearest typescript install walking up from the package (the workspace root
 *  in this monorepo — packages/kb declares no typescript dep of its own). */
function findTsc() {
  for (let d = pkgRoot; ; d = dirname(d)) {
    const c = join(d, "node_modules", "typescript", "lib", "tsc.js");
    if (existsSync(c)) return c;
    if (d === dirname(d)) return null; // filesystem root
  }
}

function staleness() {
  const fp = readCommittedFingerprint(pkgRoot);
  if (!fp) return "engine-fingerprint.json missing";
  if (computeSrcHash(pkgRoot) !== fp.srcHash) return "src changed since the last build";
  const tscHash = computeTsconfigHash(pkgRoot);
  if (tscHash !== null && fp.tsconfigHash !== undefined && tscHash !== fp.tsconfigHash) return "tsconfig changed since the last build";
  const distHash = computeDistHash(pkgRoot);
  if (distHash !== null && fp.distHash !== undefined && fp.distHash !== null && distHash !== fp.distHash) return "dist is not the committed emit";
  return null;
}

const hasTsconfig = existsSync(join(pkgRoot, "tsconfig.json"));
const stale = staleness();

if (!stale && existsSync(distCli)) {
  await import(pathToFileURL(distCli).href);
} else if (hasTsconfig) {
  // Dev checkout: rebuild (tsc incremental is sub-second) + refresh fingerprint.
  const tsc = findTsc();
  if (!tsc) {
    console.error(`[kb] stale engine (${stale}) but no typescript install found walking up from ${pkgRoot} — run \`npm run build\` in packages/kb`);
    process.exit(1);
  }
  const r = spawnSync(process.execPath, [tsc, "-p", join(pkgRoot, "tsconfig.json")], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("[kb] rebuild failed — see tsc output above");
    process.exit(r.status ?? 1);
  }
  writeFingerprint(pkgRoot); // truthful: the tree WAS stale; self-heals on the next commit-with-build
  await import(pathToFileURL(distCli).href);
} else if (existsSync(distCli)) {
  // Installed package: prepublishOnly built the tarball, so a mismatch means
  // post-install tampering — loud, not fatal; only fires on actual mismatch.
  console.error(`[kb] WARNING: engine fingerprint mismatch (${stale}) — running the shipped dist unchanged. The kb bin and the extension would run different engines; reinstall the package.`);
  await import(pathToFileURL(distCli).href);
} else {
  console.error(`[kb] ERROR: ${stale ?? "dist missing"} and dist/cli.js is absent with no tsconfig to rebuild — the kb bin and the extension would run different engines. Reinstall @blackbelt-technology/pi-dashboard-kb.`);
  process.exit(1);
}
