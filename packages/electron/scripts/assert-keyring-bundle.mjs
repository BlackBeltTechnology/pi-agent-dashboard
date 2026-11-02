#!/usr/bin/env node
/**
 * assert-keyring-bundle.mjs — GO/NO-GO for the OS-keychain binding in the bundled server.
 *
 * `bundle-server.mjs` calls `checkKeyringBundle` next to the node-pty / koffi GO/NO-GO
 * and exits 1 on any error, so a mis-built bundle fails at build time instead of
 * shipping a server whose credential files are locked `keychain_unavailable`.
 *
 * Asserts, for the triple of the TARGET platform/arch (not the build host):
 *   1. `node_modules/@napi-rs/keyring-<triple>/keyring.<triple>.node` exists
 *      (spike rows 3, 5, 6, 12: `npm_config_target_arch` does not select the optional
 *      package; `--omit=optional` removes it; a host-arch bundle on another arch has no binding).
 *   2. the platform package version equals `@napi-rs/keyring`'s (spike row 11: skew loads silently).
 *   3. the keychain worker entry `credential-key-worker.mjs` ships in the bundled server package.
 *   4. Linux: `LICENSE.third-party.md` sits next to the `.node` (statically linked libdbus,
 *      AFL-2.1 OR GPL-2.0-or-later). The node_modules prune must not delete it.
 *   5. macOS: `codesign --verify` passes on the `.node` (injected `verifySignature`).
 *
 * win32-arm64 ships x64 Node (node-pty has no arm64 prebuild), so it needs the x64 binding.
 * The pure function takes the bundle dir + target and an optional signature verifier, so L1
 * drives fixture trees. See change: encrypt-credentials-at-rest (design D5, tasks 11.1; E88, E89).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const WORKER_ENTRY = "credential-key-worker.mjs";
const LICENSE_FILE = "LICENSE.third-party.md";
const SUPPORTED = new Set(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]);

/**
 * `@napi-rs/keyring-<triple>` suffix for a target. win32-arm64 maps to the x64 binding
 * (the bundled Node there is x64, run under emulation). Linux defaults to glibc (Electron).
 */
export function keyringTriple({ platform, arch, libc = "gnu" }) {
  const effectiveArch = platform === "win32" && arch === "arm64" ? "x64" : arch;
  const key = `${platform}-${effectiveArch}`;
  if (!SUPPORTED.has(key)) throw new Error(`unsupported keyring target ${platform}/${arch}`);
  if (platform === "darwin") return key;
  return platform === "linux" ? `${key}-${libc}` : `${key}-msvc`;
}

function readVersion(pkgJsonPath) {
  try {
    return JSON.parse(readFileSync(pkgJsonPath, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/** Names of `@napi-rs/keyring-*` platform packages present, for the NO-GO hint. */
function presentTriples(napiDir) {
  try {
    return readdirSync(napiDir)
      .filter((n) => n.startsWith("keyring-"))
      .map((n) => n.slice("keyring-".length));
  } catch {
    return [];
  }
}

function checkBinding({ napiDir, nodeFile, triple, platform, arch, verifySignature }) {
  if (existsSync(nodeFile)) {
    const bad = platform === "darwin" && verifySignature ? verifySignature(nodeFile) : null;
    return bad ? [`codesign --verify failed on keyring.${triple}.node: ${bad}`] : [];
  }
  const found = presentTriples(napiDir);
  return [
    `@napi-rs/keyring-${triple} binding missing: expected ${nodeFile} for ${platform}/${arch} ` +
      `(found: ${found.length > 0 ? found.join(", ") : "none"}). ` +
      "npm_config_target_arch does not select the optional package; use --os/--cpu (--libc), " +
      "an npm run under `arch -x86_64`, or drop --omit=optional.",
  ];
}

function checkVersions({ napiDir, platformDir, triple }) {
  const mainVersion = readVersion(path.join(napiDir, "keyring", "package.json"));
  if (!mainVersion) return ["@napi-rs/keyring missing from the bundle (node_modules/@napi-rs/keyring/package.json)"];
  const platformVersion = readVersion(path.join(platformDir, "package.json"));
  if (!platformVersion || platformVersion === mainVersion) return [];
  return [
    `@napi-rs/keyring ${mainVersion} != @napi-rs/keyring-${triple} ${platformVersion} ` +
      "(version skew loads silently; the bundle must carry matching versions)",
  ];
}

function checkWorker(bundleDir) {
  const worker = path.join(bundleDir, "node_modules", "@blackbelt-technology", "pi-dashboard-server", "src", "auth", WORKER_ENTRY);
  return existsSync(worker) ? [] : [`${WORKER_ENTRY} missing from the bundle (expected ${worker})`];
}

function checkLicense({ platform, platformDir }) {
  if (platform !== "linux" || existsSync(path.join(platformDir, LICENSE_FILE))) return [];
  return [`${LICENSE_FILE} missing next to the Linux keyring binding (statically linked libdbus licence notice)`];
}

/**
 * @param {{ bundleDir: string, platform: string, arch: string, libc?: string,
 *           verifySignature?: (nodePath: string) => string | null }} opts
 *   `bundleDir` is the server bundle root (contains `node_modules/`).
 *   `verifySignature` returns an error text, or null when the signature is valid.
 * @returns {{ ok: boolean, triple: string, errors: string[] }}
 */
export function checkKeyringBundle({ bundleDir, platform, arch, libc, verifySignature }) {
  const triple = keyringTriple({ platform, arch, libc });
  const napiDir = path.join(bundleDir, "node_modules", "@napi-rs");
  const platformDir = path.join(napiDir, `keyring-${triple}`);
  const nodeFile = path.join(platformDir, `keyring.${triple}.node`);
  const errors = [
    ...checkBinding({ napiDir, nodeFile, triple, platform, arch, verifySignature }),
    ...checkVersions({ napiDir, platformDir, triple }),
    ...checkWorker(bundleDir),
    ...checkLicense({ platform, platformDir }),
  ];
  return { ok: errors.length === 0, triple, errors };
}

/** `codesign --verify --strict` as a signature verifier (macOS hosts only). */
export function codesignVerify(nodePath) {
  const r = spawnSync("codesign", ["--verify", "--strict", nodePath], { encoding: "utf8" });
  if (r.error) return r.error.message;
  return r.status === 0 ? null : (r.stderr || r.stdout || `exit ${r.status}`).trim().split("\n")[0];
}
