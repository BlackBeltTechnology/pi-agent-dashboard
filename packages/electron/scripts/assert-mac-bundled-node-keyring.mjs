#!/usr/bin/env node
/**
 * assert-mac-bundled-node-keyring.mjs — macOS build gate for the OS-keychain binding.
 *
 * The credential data key lives in the login keychain, read through `@napi-rs/keyring`,
 * which the server loads into the BUNDLED Node (`Resources/node/bin/node`) — not the
 * Electron binary. The darwin `.node` is signed by a third-party team; the hardened
 * runtime refuses it (`different Team IDs`) unless the loading process carries
 * `com.apple.security.cs.disable-library-validation` (spike row 10). Every macOS user would
 * then get `keychain_unavailable`.
 *
 * Gates (darwin only; exit 0 elsewhere), in order:
 *   1. STATIC (always blocking): `codesign -d --entitlements -` on the bundled Node lists
 *      the DLV entitlement. GitHub macOS runners run with SIP disabled and load the binding
 *      even without DLV (CI spike C14/C15), so a load check alone cannot catch the regression.
 *   2. STATIC (always blocking): `codesign --verify --strict` on the bundled keyring `.node`.
 *   3. SMOKE: the bundled Node loads the binding and round-trips a throwaway service entry.
 *      Blocking when a signing identity is present (`APPLE_IDENTITY`); advisory (warning)
 *      when absent, because an unsigned dev leg has no identity to prove.
 *
 * Usage: node assert-mac-bundled-node-keyring.mjs <path-to-.app> [--arch=arm64|x64]
 * Exit 0 pass / not darwin; 1 a gate failed; 2 usage.
 *
 * Hand-off to `macos-notarization`: whoever signs `Resources/node/bin/node` MUST pass
 * entitlements containing `com.apple.security.cs.disable-library-validation`
 * (`packages/electron/entitlements.plist` does).
 * See change: encrypt-credentials-at-rest (design D5 "Signed bundle", tasks 11.1; E90).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DLV = "com.apple.security.cs.disable-library-validation";

/** True when `codesign -d --entitlements -` output lists the DLV entitlement set to true (XML or `[Dict]` text form). */
export function hasDisableLibraryValidation(text) {
  const s = String(text ?? "");
  const xml = new RegExp(`<key>${DLV.replaceAll(".", "\\.")}</key>\\s*<true\\s*/>`);
  const dict = new RegExp(`\\[Key\\]\\s*${DLV.replaceAll(".", "\\.")}\\s*\\[Value\\]\\s*\\[Bool\\]\\s*true`);
  return xml.test(s) || dict.test(s);
}

/** Locations inside the packaged `.app` for the bundled Node and the keyring binding of `arch`. */
export function bundledPaths(appPath, arch) {
  const res = path.join(appPath, "Contents", "Resources");
  const triple = `darwin-${arch}`;
  const napi = path.join(res, "server", "node_modules", "@napi-rs");
  return {
    node: path.join(res, "node", "bin", "node"),
    keyringDir: path.join(napi, "keyring"),
    binding: path.join(napi, `keyring-${triple}`, `keyring.${triple}.node`),
  };
}

/** The load smoke blocks only when a signing identity is configured. */
export function smokeRequired(env) {
  return Boolean(env.APPLE_IDENTITY);
}

/** Round-trips a throwaway entry in the bundled Node. The value is a constant, never a real secret. */
const SMOKE_SOURCE = `
const { Entry } = require(process.argv[1]);
const service = "pi-dashboard-ci-smoke-" + process.pid + "-" + Date.now();
const e = new Entry(service, "data-key-v1");
e.setPassword("smoke");
const got = e.getPassword();
e.deletePassword();
if (got !== "smoke") { console.error("round-trip mismatch"); process.exit(3); }
console.log("round-trip ok");
`;

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: "utf8", timeout: 60_000 });
}

/** Gate 1: the bundled Node carries the DLV entitlement. Returns an error text or null. */
function entitlementError(p) {
  if (!existsSync(p.node)) return `bundled Node not found at ${p.node}`;
  const ent = run("codesign", ["-d", "--entitlements", "-", p.node]);
  if (hasDisableLibraryValidation(`${ent.stdout ?? ""}\n${ent.stderr ?? ""}`)) {
    console.log(`  OK  bundled Node carries ${DLV}`);
    return null;
  }
  return (
    `${p.node} lacks ${DLV}. Re-signed without it, dlopen refuses the third-party-signed @napi-rs/keyring ` +
    "binding and every macOS user gets keychain_unavailable (spike row 10). Sign it with packages/electron/entitlements.plist."
  );
}

/** Gate 2: the keyring `.node` signature verifies. Returns an error text or null. */
function signatureError(p) {
  if (!existsSync(p.binding)) return `keyring binding not found at ${p.binding}`;
  const v = run("codesign", ["--verify", "--strict", p.binding]);
  if (v.status === 0) {
    console.log(`  OK  codesign --verify passes on ${path.basename(p.binding)}`);
    return null;
  }
  return `codesign --verify failed on ${p.binding}: ${(v.stderr || v.stdout || "").trim().split("\n")[0]}`;
}

/** Gate 3: load smoke. Returns an error text only when the smoke is required; advisory failures warn. */
function smokeError(p) {
  if (!existsSync(p.node) || !existsSync(p.binding)) return null;
  const r = run(p.node, ["-e", SMOKE_SOURCE, p.keyringDir]);
  if (r.status === 0) {
    console.log("  OK  bundled Node loaded the binding and round-tripped a throwaway entry");
    return null;
  }
  const lines = (r.stderr || r.stdout || r.error?.message || `exit ${r.status}`).split("\n").map((l) => l.trim()).filter(Boolean);
  const detail = (lines.find((l) => /dlopen|code signature|different Team|Cannot find|Fatal/i.test(l)) ?? lines[0] ?? `exit ${r.status}`).slice(0, 300);
  if (smokeRequired(process.env)) return `bundled-Node keyring smoke failed: ${detail}`;
  console.warn(`::warning::bundled-Node keyring smoke failed (no APPLE_IDENTITY, advisory): ${detail}`);
  return null;
}

function main() {
  const argv = process.argv.slice(2);
  const appPath = argv.find((a) => !a.startsWith("--"));
  if (process.platform !== "darwin") {
    console.log("assert-mac-bundled-node-keyring: not darwin — skipped");
    return 0;
  }
  if (!appPath || !existsSync(appPath)) {
    console.error("usage: assert-mac-bundled-node-keyring.mjs <path-to-.app> [--arch=arm64|x64]");
    return 2;
  }
  const arch = (argv.find((a) => a.startsWith("--arch=")) ?? `--arch=${process.arch}`).slice("--arch=".length);
  const p = bundledPaths(appPath, arch);
  const errors = [entitlementError(p), signatureError(p), smokeError(p)].filter(Boolean);
  for (const e of errors) console.error(`::error::${e}`);
  return errors.length > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
