/**
 * Unit tests for pickNodeForServer() — all I/O injected, no real fs calls.
 *
 * Order (change raise-node-floor-to-26, test-plan #E12): bundled → pre-resolved
 * system Node → Electron executable only when its embedded Node satisfies the
 * server range → unavailable (reason names the embedded version + range).
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { pickNodeForServer, type PickNodeInput } from "../pick-node.js";

const FAKE_EXECPATH = "/Applications/PI-Dashboard.app/Contents/MacOS/pi-dashboard";

function input(overrides: Partial<PickNodeInput> = {}): PickNodeInput {
  return {
    bundledNodeDir: null,
    processExecPath: FAKE_EXECPATH,
    platform: "darwin",
    existsSync: () => false,
    embeddedNodeVersion: "26.0.0",
    ...overrides,
  };
}

describe("pickNodeForServer — bundled branch", () => {
  it("returns bundled when bundled node exists on POSIX", () => {
    const result = pickNodeForServer(
      input({
        bundledNodeDir: "/app/Contents/Resources/node",
        existsSync: (p) => p === "/app/Contents/Resources/node/bin/node",
      }),
    );
    expect(result).toEqual({
      kind: "bundled",
      nodeBin: "/app/Contents/Resources/node/bin/node",
    });
  });

  it("returns bundled when bundled node.exe exists on Windows", () => {
    const winDir = "C:\\app\\resources\\node";
    const winNodeExe = path.win32.join(winDir, "node.exe");
    const result = pickNodeForServer(
      input({
        bundledNodeDir: winDir,
        platform: "win32",
        existsSync: (p) => p === winNodeExe,
      }),
    );
    expect(result).toEqual({
      kind: "bundled",
      nodeBin: winNodeExe,
    });
  });
});

describe("pickNodeForServer — launch-source regression contract", () => {
  // See change: fix-electron-launch-source-bundled-node-dir.
  // These tests pin the exact input shape that distinguishes the
  // correct bundled-Node dir (`<res>\node`) from the dirname-chain
  // bug shape (`<res>`) on Windows. Future refactors of
  // launch-source.ts that regress to dirname(dirname(getBundledNodePath()))
  // will trip the second test.
  const RES = "C:\\test5\\zip\\x64\\PI-Dashboard-win32-x64\\resources";
  const NODE_DIR = path.win32.join(RES, "node");
  const NODE_EXE = path.win32.join(NODE_DIR, "node.exe");
  const exists = (p: string) => p === NODE_EXE;

  it("resolves bundled when launch-source passes <res>\\node (correct, via getBundledNodeDir)", () => {
    const result = pickNodeForServer({
      bundledNodeDir: NODE_DIR,
      processExecPath: "C:\\app\\pi-dashboard.exe",
      platform: "win32",
      existsSync: exists,
      embeddedNodeVersion: "26.0.0",
    });
    expect(result).toEqual({ kind: "bundled", nodeBin: NODE_EXE });
  });

  it("falls back when launch-source passes <res> (regression shape from dirname-dirname chain)", () => {
    const result = pickNodeForServer({
      bundledNodeDir: RES,
      processExecPath: "C:\\app\\pi-dashboard.exe",
      platform: "win32",
      existsSync: exists,
      embeddedNodeVersion: "26.0.0",
    });
    expect(result.kind).toBe("execpath-fallback");
  });
});

describe("pickNodeForServer — execpath-fallback branch", () => {
  it("returns execpath-fallback when bundled dir is null", () => {
    const result = pickNodeForServer(input());
    expect(result).toEqual({
      kind: "execpath-fallback",
      nodeBin: FAKE_EXECPATH,
      needsElectronRunAsNode: true,
    });
  });

  it("returns execpath-fallback when bundled binary missing", () => {
    const result = pickNodeForServer(
      input({
        bundledNodeDir: "/app/Contents/Resources/node",
        existsSync: () => false,
      }),
    );
    expect(result).toMatchObject({ kind: "execpath-fallback", nodeBin: FAKE_EXECPATH });
  });

  it("needsElectronRunAsNode is only true on the fallback branch", () => {
    const bundled = pickNodeForServer(
      input({
        bundledNodeDir: "/r/node",
        existsSync: (p) => p.endsWith("/node"),
      }),
    );
    expect("needsElectronRunAsNode" in bundled).toBe(false);

    const fallback = pickNodeForServer(input());
    expect((fallback as { needsElectronRunAsNode?: boolean }).needsElectronRunAsNode).toBe(true);
  });
});

describe("pickNodeForServer — Node 26 floor order (test-plan #E12)", () => {
  const BUNDLED_DIR = "/app/Contents/Resources/node";
  const BUNDLED_BIN = "/app/Contents/Resources/node/bin/node";

  it("bundled present wins over everything", () => {
    const r = pickNodeForServer(
      input({
        bundledNodeDir: BUNDLED_DIR,
        existsSync: (p) => p === BUNDLED_BIN,
        systemNode: { nodeBin: "/usr/local/bin/node", version: "v26.1.0" },
        embeddedNodeVersion: "24.22.0",
      }),
    );
    expect(r).toEqual({ kind: "bundled", nodeBin: BUNDLED_BIN });
  });

  it("bundled missing + qualifying system Node → system, no ELECTRON_RUN_AS_NODE", () => {
    const r = pickNodeForServer(
      input({ systemNode: { nodeBin: "/usr/local/bin/node", version: "v26.1.0" }, embeddedNodeVersion: "24.22.0" }),
    );
    expect(r).toEqual({ kind: "system", nodeBin: "/usr/local/bin/node", version: "v26.1.0" });
    expect("needsElectronRunAsNode" in r).toBe(false);
  });

  it("bundled missing + embedded Node 26.0.0 → execpath-fallback with the flag", () => {
    const r = pickNodeForServer(input({ embeddedNodeVersion: "26.0.0" }));
    expect(r).toEqual({ kind: "execpath-fallback", nodeBin: FAKE_EXECPATH, needsElectronRunAsNode: true });
  });

  it("bundled missing + embedded Node 24.18.1 → unavailable naming 24.18.1 and >=26.0.0 <27", () => {
    const r = pickNodeForServer(input({ embeddedNodeVersion: "24.18.1" }));
    expect(r.kind).toBe("unavailable");
    if (r.kind !== "unavailable") return;
    expect(r.reason).toContain("v24.18.1");
    expect(r.reason).toContain(">=26.0.0 <27");
  });
});
