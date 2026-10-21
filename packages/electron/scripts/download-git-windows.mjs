/**
 * Download + verify + extract the pinned dugite-native git+sh+bash bundle into
 * packages/electron/resources/git/ for Windows electron builds.
 *
 * Node-native (no curl/bash) — runs on the Windows runner inside
 * bundle-server.mjs. Mac/Linux invocations are a no-op (the bundle is
 * Windows-only; macOS/Linux ship git + /bin/sh system-wide).
 *
 * Contract (mirrors download-node.sh):
 *   - reads _git-version.json (tag + assetInfix + per-arch sha256)
 *   - resolves target arch from npm_config_target_arch / TARGET_ARCH /
 *     process.arch
 *   - fetches the GitHub release tarball over https (follows redirects)
 *   - verifies SHA-256 fail-closed BEFORE extraction
 *   - streams tar.x() into resources/git/
 *   - copies usr/bin/sh.exe → usr/bin/bash.exe (dugite-native ships no bash.exe;
 *     pi's getShellConfig resolves only a file named bash.exe)
 *   - writes resources/git/THIRD-PARTY-LICENSE.txt (GPLv2 attribution +
 *     corresponding-source pointer)
 *
 * See change: embed-git-bash-on-windows, fix-windows-bundled-bash-exe. R1 spike (PR #124) verified the
 * v2.53.0-3 tarballs on real windows-latest + windows-11-arm runners.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBundledBashExe } from "./lib/ensure-bundled-bash-exe.mjs";

const require = createRequire(import.meta.url);
const { extract } = require("tar");

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(SCRIPT_DIR, "..");
const GIT_OUT_DIR = path.join(ELECTRON_DIR, "resources", "git");
const VERSION_FILE = path.join(SCRIPT_DIR, "_git-version.json");

function resolveTargetArch() {
  // GIT_TARGET_ARCH wins so git arch is decoupled from node-pty arch: the
  // win32-arm64 bundle runs an x64-emulated server (npm_config_target_arch
  // stays x64 for node-pty) but ships NATIVE arm64 git. See change:
  // embed-git-bash-on-windows.
  const raw =
    process.env.GIT_TARGET_ARCH ||
    process.env.npm_config_target_arch ||
    process.env.TARGET_ARCH ||
    process.arch;
  return raw === "arm64" || raw === "aarch64" ? "arm64" : "x64";
}

function resolveTargetPlatform() {
  // Cross-building win32 from another OS is not a supported path; the bundle
  // step runs on windows-latest. Treat the build host as the target.
  return process.env.npm_config_target_platform || process.platform;
}

/** Idle-socket timeout (ms): abort a stalled download so the build fails
 *  loudly instead of hanging the CI job indefinitely. */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** GET with redirect following (GitHub release assets 302 → codeload/S3). */
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("too many redirects"));
    const req = https.get(url, { headers: { "User-Agent": "pi-dashboard-build" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const out = createWriteStream(dest);
      res.pipe(out);
      out.on("finish", () => out.close(() => resolve()));
      out.on("error", reject);
    });
    req.on("error", reject);
    // Fail-closed on a stalled connection: destroy the socket and reject.
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy(new Error(`download timed out after ${DOWNLOAD_TIMEOUT_MS}ms: ${url}`));
    });
  });
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

function writeLicense(manifest) {
  const bundledLicense = path.join(GIT_OUT_DIR, "LICENSE.txt");
  const header = [
    "Bundled Git for Windows (via desktop/dugite-native)",
    "===================================================",
    "",
    // Stable marker line — parsed by the Electron About dialog.
    `Git version: ${manifest.gitVersion}`,
    `Pinned release: dugite-native ${manifest.dugiteNativeTag}`,
    "Corresponding source (GPLv2 §3 written offer / pointer):",
    "  https://github.com/desktop/dugite-native",
    "",
    "This bundle redistributes Git for Windows and its MSYS2/MinGW runtime",
    "(git, sh/bash, coreutils, OpenSSL, zlib, libidn2, expat, Git LFS, Git",
    "Credential Manager). Git is licensed under the GNU General Public",
    "License, version 2.",
    "",
    "                    GNU GENERAL PUBLIC LICENSE",
    "                       Version 2, June 1991",
    "",
    "The verbatim license texts for Git and every bundled component ship",
    "inside this directory (see LICENSE.txt below and the per-component",
    "license files under usr/ and the arch libdir). The full corresponding",
    "source for all GPL components is available at the dugite-native URL",
    "above and its upstream (https://github.com/git-for-windows/git).",
    "",
    "----------------------------------------------------------------------",
    "",
  ].join("\n");

  let body = "";
  if (existsSync(bundledLicense)) {
    body = readFileSync(bundledLicense, "utf8");
  }
  writeFileSync(path.join(GIT_OUT_DIR, "THIRD-PARTY-LICENSE.txt"), header + body, "utf8");
}

async function main() {
  const targetPlatform = resolveTargetPlatform();
  if (targetPlatform !== "win32") {
    console.log(`  [git-bundle] target platform ${targetPlatform} — skipping (Windows-only)`);
    return;
  }

  const manifest = JSON.parse(readFileSync(VERSION_FILE, "utf8"));
  const arch = resolveTargetArch();
  const key = `windows-${arch}`;
  const expectedSha = manifest.sha256[key];
  if (!expectedSha) {
    console.error(`✗ [git-bundle] no pinned sha256 for ${key} in _git-version.json`);
    process.exit(1);
  }

  const file = `dugite-native-${manifest.assetInfix}-windows-${arch}.tar.gz`;
  const url = `https://github.com/desktop/dugite-native/releases/download/${manifest.dugiteNativeTag}/${file}`;
  console.log(`  [git-bundle] ${manifest.dugiteNativeTag} ${key} ← ${url}`);

  const tmp = path.join(tmpdir(), `dugite-${process.pid}-${file}`);
  try {
    await download(url, tmp);
    const actualSha = await sha256(tmp);
    if (actualSha !== expectedSha) {
      console.error("✗ [git-bundle] checksum mismatch — refusing to extract");
      console.error(`    expected ${expectedSha}`);
      console.error(`    actual   ${actualSha}`);
      process.exit(1);
    }
    console.log(`  [git-bundle] sha256 OK (${actualSha.slice(0, 12)}…)`);

    rmSync(GIT_OUT_DIR, { recursive: true, force: true });
    mkdirSync(GIT_OUT_DIR, { recursive: true });
    await extract({ file: tmp, cwd: GIT_OUT_DIR });
    // dugite-native ships bash only as usr/bin/sh.exe; pi resolves a file named
    // bash.exe. See change: fix-windows-bundled-bash-exe.
    if (ensureBundledBashExe(GIT_OUT_DIR)) console.log("  [git-bundle] usr/bin/bash.exe ← usr/bin/sh.exe");
    writeLicense(manifest);
    console.log(`  [git-bundle] extracted to ${GIT_OUT_DIR}`);
  } finally {
    rmSync(tmp, { force: true });
  }
}

main().catch((err) => {
  console.error(`✗ [git-bundle] ${err?.message ?? err}`);
  process.exit(1);
});
