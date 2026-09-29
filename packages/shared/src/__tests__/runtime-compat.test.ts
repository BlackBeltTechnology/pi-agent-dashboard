/**
 * Runtime compatibility gate + preflight (D6).
 *
 * test-plan: E5, E6. See change: electron-runtime-overlay-updates.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateRuntimeCandidate,
  localRequiredPaths,
  overlayRequiredPaths,
  preflightLocal,
  preflightOverlay,
} from "../runtime-overlay/compat.js";
import {
  parseRuntimeManifest,
  type RuntimeManifest,
  readRuntimeManifest,
  writeRuntimeManifest,
} from "../runtime-overlay/manifest.mjs";

const manifest = (over: Partial<RuntimeManifest> = {}): RuntimeManifest => ({
  version: "0.9.0",
  minShellVersion: "0.9.0",
  nodeEngines: ">=22.11",
  origin: "npm",
  ...over,
});

// ── runtime-manifest.json shape ─────────────────────────────────────────────

describe("runtime manifest", () => {
  it("round-trips through write/read and preserves optional fields", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-manifest-"));
    try {
      const m = manifest({ integrity: "sha512-abc", piVersion: "0.75.1", origin: "bundled" });
      writeRuntimeManifest(dir, m);
      expect(readRuntimeManifest(dir)).toEqual(m);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    [null],
    [[]],
    [{ version: "0.9.0" }],
    [{ ...manifest(), origin: "ftp" }],
    [{ ...manifest(), version: 9 }],
  ])("rejects invalid shape %j", (raw) => {
    expect(parseRuntimeManifest(raw)).toBeNull();
  });

  it("reads a missing file as null", () => {
    expect(readRuntimeManifest("/definitely/not/here")).toBeNull();
  });
});

// ── E5: compatibility gate BVA ──────────────────────────────────────────────

describe("evaluateRuntimeCandidate — shell version (E5)", () => {
  it.each([
    ["0.8.9", { ok: true }],
    ["0.9.0", { ok: true }],
    ["0.9.1", { ok: false, code: "requires_app", message: "requires_app >=0.9.1" }],
  ] as const)("minShellVersion %s", (minShellVersion, expected) => {
    const got = evaluateRuntimeCandidate({
      manifest: manifest({ minShellVersion }),
      shellVersion: "0.9.0",
      nodeVersion: "22.12.0",
    });
    expect(got).toEqual(expected);
  });
});

describe("evaluateRuntimeCandidate — Node engines (E5)", () => {
  it.each([
    [">=22.11", { ok: true }],
    [">=22.12", { ok: true }],
    [">=22.13", { ok: false, code: "node_engines", message: "node_engines >=22.13" }],
    ["^20", { ok: false, code: "node_engines", message: "node_engines ^20" }],
  ] as const)("nodeEngines %s", (nodeEngines, expected) => {
    const got = evaluateRuntimeCandidate({
      manifest: manifest({ nodeEngines }),
      shellVersion: "0.9.0",
      nodeVersion: "v22.12.0",
    });
    expect(got).toEqual(expected);
  });

  it("shell check wins when both fail", () => {
    const got = evaluateRuntimeCandidate({
      manifest: manifest({ minShellVersion: "1.0.0", nodeEngines: "^20" }),
      shellVersion: "0.9.0",
      nodeVersion: "22.12.0",
    });
    expect(got).toMatchObject({ ok: false, code: "requires_app" });
  });

  it("refuses a missing or unparsable manifest", () => {
    expect(
      evaluateRuntimeCandidate({ manifest: null, shellVersion: "0.9.0", nodeVersion: "22.12.0" }),
    ).toMatchObject({ ok: false, code: "invalid_manifest" });
    expect(
      evaluateRuntimeCandidate({
        manifest: manifest({ nodeEngines: "not a range !!" }),
        shellVersion: "0.9.0",
        nodeVersion: "22.12.0",
      }),
    ).toMatchObject({ ok: false, code: "node_engines" });
  });

  it("accepts a prerelease shell at/above the minimum", () => {
    expect(
      evaluateRuntimeCandidate({
        manifest: manifest({ minShellVersion: "0.9.0" }),
        shellVersion: "0.10.0-beta.1",
        nodeVersion: "22.12.0",
      }),
    ).toEqual({ ok: true });
  });
});

// ── E6: preflight files ─────────────────────────────────────────────────────

describe("preflightOverlay (E6)", () => {
  const root = "/rt/versions/0.9.0";
  const required = overlayRequiredPaths(root);

  it("lists server cli, web index.html, extension entry and resources/plugins", () => {
    expect(required).toEqual([
      path.join(root, "node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts"),
      path.join(root, "node_modules/@blackbelt-technology/pi-dashboard-web/dist/index.html"),
      path.join(root, "node_modules/@blackbelt-technology/pi-dashboard-extension/src/bridge.ts"),
      path.join(root, "resources/plugins"),
    ]);
  });

  it("passes when every required path exists", () => {
    expect(preflightOverlay(root, () => true)).toEqual({ ok: true });
  });

  it.each(required.map((p) => [p]))("refuses naming the missing path %s", (missing) => {
    const got = preflightOverlay(root, (p) => p !== missing);
    expect(got).toMatchObject({ ok: false, code: "missing_file", path: missing });
    if (!got.ok) expect(got.message).toContain(missing);
  });
});

describe("preflightLocal (E6)", () => {
  const root = "/r/co";
  const required = localRequiredPaths(root);

  it("lists server cli, client dist, extension entry and node_modules", () => {
    expect(required).toEqual([
      path.join(root, "packages/server/src/cli.ts"),
      path.join(root, "packages/client/dist/index.html"),
      path.join(root, "packages/extension/src/bridge.ts"),
      path.join(root, "node_modules"),
    ]);
  });

  it("passes when every required path exists", () => {
    expect(preflightLocal(root, () => true)).toEqual({ ok: true });
  });

  it("missing client build names the path and the build command", () => {
    const missing = path.join(root, "packages/client/dist/index.html");
    const got = preflightLocal(root, (p) => p !== missing);
    expect(got).toMatchObject({ ok: false, code: "missing_file", path: missing });
    if (!got.ok) {
      expect(got.message).toContain(missing);
      expect(got.message).toContain("npm run build");
    }
  });

  it("missing node_modules names the path and the install command", () => {
    const missing = path.join(root, "node_modules");
    const got = preflightLocal(root, (p) => p !== missing);
    expect(got).toMatchObject({ ok: false, code: "missing_file", path: missing });
    if (!got.ok) expect(got.message).toContain("pnpm install");
  });
});
