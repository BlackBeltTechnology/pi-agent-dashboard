#!/usr/bin/env node
/**
 * Bundle first-party recommended pi extensions into the Electron installer.
 *
 * Shipped layout:
 *   packages/electron/resources/bundled-extensions/<id>/        # source tree
 *   packages/electron/resources/bundled-extensions/<id>/.bundled-sha
 *
 * Drives the runtime `installBundledExtensions()` in
 * packages/electron/src/lib/dependency-installer.ts.
 *
 * Opt-in: set BUNDLE_RECOMMENDED_EXTENSIONS=1.
 * Default (unset or != 1): no-op exit 0, no files written.
 *
 * License allowlist: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC.
 * Size budget: total bundled tree must be <= 15 MB.
 *
 * Usage:
 *   BUNDLE_RECOMMENDED_EXTENSIONS=1 node --import tsx/esm \
 *       packages/electron/scripts/bundle-recommended-extensions.mjs
 *
 * Replaces bundle-recommended-extensions.sh — the shell version baked
 * POSIX-form paths from `pwd` / `dirname` into `node -e "require('$pkg_json')"`
 * strings, which broke on Windows runners (Git-Bash translates `D:\a\...`
 * → `/d/a/...`, but native node.exe does not understand that translation).
 * This Node-native port has no shell↔Node bridge: every path goes through
 * `path.resolve` and `fs` directly. See change: publish-fix-macos.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, "..");
const PROJECT_DIR = path.resolve(ELECTRON_DIR, "..", "..");
const OUT_DIR = path.join(ELECTRON_DIR, "resources", "bundled-extensions");

const LICENSE_ALLOWLIST = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"];
const SIZE_BUDGET_BYTES = 15 * 1024 * 1024;

// Gate: opt-in only.
if (process.env.BUNDLE_RECOMMENDED_EXTENSIONS !== "1") {
  console.log(
    "→ bundle-recommended-extensions: BUNDLE_RECOMMENDED_EXTENSIONS!=1 — skipping (no-op).",
  );
  process.exit(0);
}

console.log(`→ Bundling first-party recommended extensions into ${OUT_DIR}`);

// Clean previous bundle so we never ship stale commits.
rmSync(OUT_DIR, { recursive: true, force: true });

// Read the manifest from the TS source. We rely on tsx/esm having been
// passed via `node --import tsx/esm`; if not, fall back to spawning a
// child Node with --import tsx/esm.
async function loadManifest() {
  const tsUrl = pathToFileURL(
    path.join(PROJECT_DIR, "packages", "shared", "src", "recommended-extensions.ts"),
  ).href;
  try {
    return await import(tsUrl);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      // ERR_UNKNOWN_FILE_EXTENSION when tsx loader isn't active.
      String(err.code ?? "").startsWith("ERR_UNKNOWN_FILE_EXTENSION")
    ) {
      // Re-spawn ourselves with tsx/esm pre-loaded.
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx/esm", fileURLToPath(import.meta.url)],
        { stdio: "inherit", env: process.env },
      );
      process.exit(result.status ?? 1);
    }
    throw err;
  }
}

const manifest = await loadManifest();
const byId = new Map(
  manifest.RECOMMENDED_EXTENSIONS.map((e) => [e.id, e]),
);

const targets = [];
for (const id of manifest.BUNDLED_EXTENSION_IDS) {
  const entry = byId.get(id);
  if (!entry) {
    console.error(`✗ manifest: unknown bundled id ${id}`);
    process.exit(2);
  }
  targets.push({ id, source: entry.source });
}

if (targets.length === 0) {
  console.error("✗ BUNDLED_EXTENSION_IDS is empty — nothing to bundle.");
  process.exit(1);
}

// ── helpers ────────────────────────────────────────────────────────────────
function isAllowedLicense(detected) {
  return LICENSE_ALLOWLIST.includes(detected);
}

function detectLicenseSpdx(dir) {
  // 1) package.json "license" field.
  const pkgJson = path.join(dir, "package.json");
  if (existsSync(pkgJson)) {
    try {
      const p = JSON.parse(readFileSync(pkgJson, "utf8"));
      if (typeof p.license === "string") return p.license;
      if (p.license && typeof p.license === "object" && typeof p.license.type === "string") {
        return p.license.type;
      }
    } catch {
      // fall through to LICENSE-file heuristic
    }
  }
  // 2) Heuristic match on LICENSE / LICENSE.md / COPYING contents.
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"]) {
    const candidate = path.join(dir, name);
    if (!existsSync(candidate)) continue;
    let content;
    try {
      content = readFileSync(candidate, "utf8").toLowerCase();
    } catch {
      continue;
    }
    if (content.includes("apache license")) return "Apache-2.0";
    if (content.includes("mit license")) return "MIT";
    if (content.includes("isc license")) return "ISC";
    if (
      content.includes("bsd 3-clause") ||
      content.includes("redistribution and use in source and binary forms, with or without")
    ) {
      // Can't cheaply distinguish 2 vs 3 clause — default to 3-clause.
      return "BSD-3-Clause";
    }
  }
  return "";
}

function dirSizeBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        try {
          total += statSync(full).size;
        } catch {}
      }
    }
  }
  return total;
}

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
}

function spawnGit(args, cwd) {
  const result = spawnSync("git", args, {
    stdio: "inherit",
    cwd,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${result.status}`);
  }
}

function captureGit(args, cwd) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    cwd,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${result.status}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

// ── process each id ────────────────────────────────────────────────────────
for (const { id, source } of targets) {
  // Only git sources can be bundled.
  if (source.startsWith("npm:") || source.startsWith("local:")) {
    console.error(
      `✗ ${id}: source '${source}' is not a git URL. Bundling refuses non-git sources.`,
    );
    process.exit(1);
  }

  const target = path.join(OUT_DIR, id);
  console.log("");
  console.log(`→ ${id}  (${source})`);

  // Shallow clone.
  spawnGit(["clone", "--depth=1", source, target]);

  // Record SHA, then strip .git.
  const sha = captureGit(["rev-parse", "HEAD"], target);
  writeFileSync(path.join(target, ".bundled-sha"), sha + "\n");
  console.log(`  SHA: ${sha}`);
  rmSync(path.join(target, ".git"), { recursive: true, force: true });

  // License check.
  const licenseId = detectLicenseSpdx(target);
  if (!licenseId) {
    console.error(
      `✗ ${id}: could not detect SPDX license in ${target} (no package.json license / no LICENSE file heuristic match).`,
    );
    process.exit(1);
  }
  if (!isAllowedLicense(licenseId)) {
    console.error(
      `✗ ${id}: license '${licenseId}' is not in the allowlist (${LICENSE_ALLOWLIST.join(", ")}).`,
    );
    process.exit(1);
  }
  console.log(`  License: ${licenseId} ✓`);
}

// ── size budget ────────────────────────────────────────────────────────────
console.log("");
console.log("→ Size breakdown:");
let totalBytes = 0;
for (const { id } of targets) {
  const bytes = dirSizeBytes(path.join(OUT_DIR, id));
  totalBytes += bytes;
  console.log(`  ${id}: ${humanBytes(bytes)}`);
}
console.log(`  TOTAL: ${humanBytes(totalBytes)} (${totalBytes} bytes)`);

if (totalBytes > SIZE_BUDGET_BYTES) {
  console.error(
    `✗ Bundled extensions exceed size budget: ${totalBytes} > ${SIZE_BUDGET_BYTES} bytes (15 MB).`,
  );
  process.exit(1);
}

console.log("");
console.log(`✓ Bundled extensions ready in ${OUT_DIR}`);
