/**
 * E90 helpers (encrypt-credentials-at-rest): the static macOS gate for the
 * bundled Node. `hasDisableLibraryValidation` must recognise the entitlement in
 * both `codesign -d --entitlements -` output shapes and reject its absence or
 * `false` (spike row 10: re-signing the bundled Node without DLV kills the binding).
 * The darwin gate itself runs as a build leg (_electron-build.yml); non-darwin is a no-op.
 *
 * See change: encrypt-credentials-at-rest (design D5 "Signed bundle", E90).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module, no type declarations by design.
import { bundledPaths, hasDisableLibraryValidation, smokeRequired } from "../../scripts/assert-mac-bundled-node-keyring.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/assert-mac-bundled-node-keyring.mjs");
const KEY = "com.apple.security.cs.disable-library-validation";

describe("E90: hasDisableLibraryValidation", () => {
  it("E90: accepts the XML plist form", () => {
    const xml = `Executable=/x/node\n<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>${KEY}</key>\n<true/></dict></plist>`;
    expect(hasDisableLibraryValidation(xml)).toBe(true);
  });

  it("E90: accepts the [Dict] text form", () => {
    const text = `[Dict]\n\t[Key] com.apple.security.cs.allow-jit\n\t[Value]\n\t\t[Bool] true\n\t[Key] ${KEY}\n\t[Value]\n\t\t[Bool] true\n`;
    expect(hasDisableLibraryValidation(text)).toBe(true);
  });

  it("E90: rejects an entitlement set without it (re-signed without DLV)", () => {
    const xml = `<plist><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>`;
    expect(hasDisableLibraryValidation(xml)).toBe(false);
    expect(hasDisableLibraryValidation("")).toBe(false);
  });

  it("E90: rejects the key set to false", () => {
    expect(hasDisableLibraryValidation(`<key>${KEY}</key><false/>`)).toBe(false);
    expect(hasDisableLibraryValidation(`[Key] ${KEY}\n\t[Value]\n\t\t[Bool] false\n`)).toBe(false);
  });

  it("E90: is not fooled by the key naming another entitlement's value", () => {
    const xml = `<key>${KEY}</key><false/><key>com.apple.security.cs.allow-jit</key><true/>`;
    expect(hasDisableLibraryValidation(xml)).toBe(false);
  });
});

describe("E90: bundled paths and smoke policy", () => {
  it("E90: bundledPaths points at Resources/node/bin/node and the keyring .node of the triple", () => {
    const p = bundledPaths("/A/PI.app", "arm64");
    expect(p.node).toBe(path.join("/A/PI.app", "Contents", "Resources", "node", "bin", "node"));
    expect(p.binding).toBe(path.join("/A/PI.app", "Contents", "Resources", "server", "node_modules", "@napi-rs", "keyring-darwin-arm64", "keyring.darwin-arm64.node"));
    expect(p.keyringDir).toBe(path.join("/A/PI.app", "Contents", "Resources", "server", "node_modules", "@napi-rs", "keyring"));
  });

  it("E90: the smoke is required only when a signing identity is present", () => {
    expect(smokeRequired({})).toBe(false);
    expect(smokeRequired({ APPLE_IDENTITY: "" })).toBe(false);
    expect(smokeRequired({ APPLE_IDENTITY: "Developer ID Application: X" })).toBe(true);
  });

  it.skipIf(process.platform === "darwin")("E90: exits 0 without probing on non-darwin", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "/nonexistent.app"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("not darwin");
  });
});
