/**
 * Local link native-module ABI preflight (test-plan N1, N2).
 * See change: electron-local-link-node-compat.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nativeAddonAbi, preflightLocalNativeAbi } from "../runtime-overlay/compat.js";

const NODE = { version: "v26.13.0", abi: 147 };

/** Fake addon binary: the symbol string table is all the check reads. */
function addon(symbol: string): Buffer {
  return Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0]), Buffer.from(`\0_${symbol}\0_napi_create_object\0`)]);
}

function put(root: string, rel: string, bytes: Buffer): string {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, bytes);
  return p;
}

describe("nativeAddonAbi", () => {
  it("reads the ABI from a node_register_module_v<N> symbol", () => {
    expect(nativeAddonAbi(addon("node_register_module_v137"))).toBe(137);
  });
  it("returns null for an N-API addon", () => {
    expect(nativeAddonAbi(addon("napi_register_module_v1"))).toBeNull();
  });
});

describe("preflightLocalNativeAbi", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "local-abi-"));
    mkdirSync(path.join(root, "node_modules"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("N1: refuses a from-source addon built for another ABI, naming it and the rebuild command", () => {
    const bad = put(root, "node_modules/node-pty/build/Release/pty.node", addon("node_register_module_v137"));
    const got = preflightLocalNativeAbi(root, NODE);
    expect(got).toMatchObject({ ok: false, code: "node_abi", path: bad });
    if (!got.ok) {
      expect(got.message).toContain(bad);
      expect(got.message).toContain("137");
      expect(got.message).toContain("147");
      expect(got.message).toContain("pnpm rebuild");
      expect(got.message).toContain("v26.13.0");
    }
  });

  it("N1: finds a mismatched addon inside a scoped package", () => {
    const bad = put(root, "node_modules/@scope/native/build/Release/x.node", addon("node_register_module_v115"));
    expect(preflightLocalNativeAbi(root, NODE)).toMatchObject({ ok: false, code: "node_abi", path: bad });
  });

  it("N2: accepts addons built for the running Node's ABI", () => {
    put(root, "node_modules/node-pty/build/Release/pty.node", addon("node_register_module_v147"));
    expect(preflightLocalNativeAbi(root, NODE)).toEqual({ ok: true });
  });

  it("N2: accepts N-API addons and prebuilds regardless of ABI", () => {
    put(root, "node_modules/sharp/build/Release/sharp.node", addon("napi_register_module_v1"));
    put(root, "node_modules/node-pty/prebuilds/darwin-arm64/pty.node", addon("node_register_module_v137"));
    expect(preflightLocalNativeAbi(root, NODE)).toEqual({ ok: true });
  });

  it("N2: accepts a checkout with no native addons", () => {
    mkdirSync(path.join(root, "node_modules/left-pad"));
    expect(preflightLocalNativeAbi(root, NODE)).toEqual({ ok: true });
  });
});
