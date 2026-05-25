/**
 * Unit tests for pickNodeForServer() — all I/O injected, no real fs calls.
 *
 * Under the immutable-bundle architecture (see change:
 * eliminate-electron-runtime-install), the picker has two branches only:
 *   - bundled         (bundled Node binary exists)
 *   - execpath-fallback (bundled missing — corrupted install)
 *
 * System-Node selection and the nodejs/node#58515 version-skip logic are
 * gone: the bundled Node is the only intended runtime.
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
    });
    expect(result).toEqual({ kind: "bundled", nodeBin: NODE_EXE });
  });

  it("falls back when launch-source passes <res> (regression shape from dirname-dirname chain)", () => {
    const result = pickNodeForServer({
      bundledNodeDir: RES,
      processExecPath: "C:\\app\\pi-dashboard.exe",
      platform: "win32",
      existsSync: exists,
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
    expect(result.kind).toBe("execpath-fallback");
    expect(result.nodeBin).toBe(FAKE_EXECPATH);
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
