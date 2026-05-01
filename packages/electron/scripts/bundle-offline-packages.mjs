#!/usr/bin/env node
/**
 * Build a per-platform npm cacache snapshot of pi-coding-agent + openspec + tsx
 * so first-run install works fully offline.
 *
 * Writes:
 *   resources/offline-packages/npm-cache.tar.gz   # gzipped cacache
 *   resources/offline-packages/manifest.json      # pins, platform, SHA-256
 *
 * Usage:
 *   node packages/electron/scripts/bundle-offline-packages.mjs
 *   node packages/electron/scripts/bundle-offline-packages.mjs --platform=win32-x64
 *
 * Replaces bundle-offline-packages.sh — the shell version baked POSIX-form
 * paths from `pwd` into `node -e "require('$path')"` strings, which broke
 * on Windows runners (Git-Bash translates `D:\a\...` → `/d/a/...`, but
 * native node.exe does not understand that translation). This Node-native
 * port has no shell↔Node bridge: every path goes through `path.resolve`
 * and `fs` directly, every external command (npm, tar) is invoked via
 * `child_process.spawnSync` with discrete argv (which IS MSYS-aware on
 * the rare codepath that goes through bash). See change: publish-fix-macos
 * (extended scope: replace bash↔node bridges in build scripts).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, "..");
const PINS_FILE = path.join(ELECTRON_DIR, "offline-packages.json");
const OUT_DIR = path.join(ELECTRON_DIR, "resources", "offline-packages");

// ── parse --platform=<os>-<cpu> ────────────────────────────────────────────
function parsePlatformArg(argv) {
  for (const arg of argv) {
    if (arg.startsWith("--platform=")) return arg.slice("--platform=".length);
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: bundle-offline-packages.mjs [--platform=<os>-<cpu>]\n" +
          "  os:   darwin | linux | win32\n" +
          "  cpu:  x64 | arm64",
      );
      process.exit(0);
    }
    throw new Error(`unknown arg: ${arg}`);
  }
  return null;
}

function detectHostPlatform() {
  const osMap = { darwin: "darwin", linux: "linux", win32: "win32" };
  const cpuMap = { x64: "x64", arm64: "arm64" };
  const hostOs = osMap[process.platform];
  const hostCpu = cpuMap[process.arch];
  if (!hostOs) throw new Error(`unsupported host OS: ${process.platform}`);
  if (!hostCpu) throw new Error(`unsupported host arch: ${process.arch}`);
  return `${hostOs}-${hostCpu}`;
}

const PLATFORM_ARG = parsePlatformArg(process.argv.slice(2));
const targetPlatform = PLATFORM_ARG ?? detectHostPlatform();
const dashIdx = targetPlatform.indexOf("-");
if (dashIdx < 0)
  throw new Error(
    `invalid --platform=${targetPlatform}; expected <os>-<cpu>`,
  );
const TARGET_OS = targetPlatform.slice(0, dashIdx);
const TARGET_CPU = targetPlatform.slice(dashIdx + 1);

// ── skip gracefully if pins file missing ───────────────────────────────────
if (!existsSync(PINS_FILE)) {
  console.log(`→ bundle-offline-packages: no ${PINS_FILE} — skipping`);
  process.exit(0);
}

console.log(`→ Bundling offline packages for ${targetPlatform}`);

// ── read pins ──────────────────────────────────────────────────────────────
const pinsManifest = JSON.parse(readFileSync(PINS_FILE, "utf8"));
const pins = pinsManifest.packages ?? [];
if (pins.length === 0) {
  console.error(`✗ ${PINS_FILE} has no packages`);
  process.exit(1);
}
const pinSpecs = pins.map((p) => `${p.name}@${p.version}`);
console.log(`  pins: ${pinSpecs.join(" ")}`);

// ── scratch dir ────────────────────────────────────────────────────────────
const scratch = mkdtempSync(path.join(os.tmpdir(), "offline-pkg-"));
try {
  writeFileSync(
    path.join(scratch, "package.json"),
    '{"name":"offline-bundle-scratch","private":true}\n',
  );

  // ── populate cacache with platform-specific metadata ─────────────────────
  console.log(
    `  populating cacache (--os=${TARGET_OS} --cpu=${TARGET_CPU} --ignore-scripts)...`,
  );
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmInstall = spawnSync(
    npmCmd,
    [
      "install",
      "--prefix",
      scratch,
      "--cache",
      path.join(scratch, "npm-cache"),
      `--os=${TARGET_OS}`,
      `--cpu=${TARGET_CPU}`,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...pinSpecs,
    ],
    {
      // shell:true on Windows so npm.cmd is found via PATHEXT.
      shell: process.platform === "win32",
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (npmInstall.status !== 0) {
    console.error("✗ npm install failed:");
    const log = (npmInstall.stderr || "") + (npmInstall.stdout || "");
    const lines = log.trim().split(/\r?\n/);
    console.error(lines.slice(-20).join("\n"));
    process.exit(1);
  }

  const cacacheDir = path.join(scratch, "npm-cache", "_cacache");
  if (!existsSync(cacacheDir)) {
    console.error("✗ expected _cacache directory not produced by npm");
    process.exit(1);
  }

  // ── tar the cacache ──────────────────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });
  const tarball = path.join(OUT_DIR, "npm-cache.tar.gz");
  if (existsSync(tarball)) rmSync(tarball);

  // Use the `tar` npm package (transitively present via npm/cacache deps).
  // We `cwd` into npm-cache and pack `_cacache` so paths in the archive are
  // `_cacache/...` (matches what the runtime extractor expects).
  const tar = await import("tar");
  await tar.create(
    {
      gzip: { level: 9 },
      file: tarball,
      cwd: path.join(scratch, "npm-cache"),
      // pax format supports long pathnames; ustar (default) caps at 100
      // chars, which cacache routinely exceeds for nested integrity dirs.
      portable: true,
      // node-tar's `portable: true` already strips uid/gid/uname/gname/mtime
      // so the archive hashes deterministically — no need for `--no-name`.
    },
    ["_cacache"],
  );

  // Sanity: tarball must list >100 entries. node-tar exposes `list` for this.
  let entryCount = 0;
  await tar.list({
    file: tarball,
    onentry: () => {
      entryCount += 1;
    },
  });
  if (entryCount < 100) {
    console.error(
      `✗ produced tarball has only ${entryCount} entries — expected several hundred`,
    );
    process.exit(1);
  }
  console.log(`  tarball entries: ${entryCount}`);

  // ── compute SHA-256 ──────────────────────────────────────────────────────
  const tarballBytes = statSync(tarball).size;
  const hash = createHash("sha256");
  hash.update(readFileSync(tarball));
  const sha256 = hash.digest("hex");

  // ── write manifest ───────────────────────────────────────────────────────
  const manifestPath = path.join(OUT_DIR, "manifest.json");
  const bundledAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const manifest = {
    bundledAt,
    targetPlatform,
    tarball: "npm-cache.tar.gz",
    tarballBytes,
    sha256,
    packages: pins,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  // ── size reporting ───────────────────────────────────────────────────────
  const mb = Math.floor(tarballBytes / 1024 / 1024);
  const sizeH = `${mb}M`;
  console.log("✓ offline bundle written:");
  console.log(`  ${tarball} (${sizeH}, ${tarballBytes} bytes)`);
  console.log(`  ${manifestPath}`);
  console.log(`  sha256: ${sha256}`);

  // Warn above 60 MB, fail above 100 MB (per design §1 budget)
  if (mb > 100) {
    console.error(`✗ bundle size ${mb} MB exceeds 100 MB budget — aborting`);
    process.exit(1);
  }
  if (mb > 60) {
    console.error(`⚠ bundle size ${mb} MB exceeds 60 MB target`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
