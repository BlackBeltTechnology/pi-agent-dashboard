/**
 * Tests for spawn-preflight.ts — pure validation, no process spawning.
 * See change: spawn-failure-diagnostics.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// We mock the ToolResolver so no binary lookup is attempted.
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js", () => ({
  ToolResolver: function MockToolResolver() {
    return {
      resolvePi: vi.fn().mockReturnValue(["pi"]),
      resolveNode: vi.fn().mockReturnValue("/usr/bin/node"),
    };
  },
}));

import { preflightSpawn } from "../spawn-process/spawn-preflight.js";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";

function makeResolver(overrides: { resolvePi?: () => string[] | null; resolveNode?: () => string | null }) {
  return {
    resolvePi: overrides.resolvePi ?? (() => ["pi"]),
    resolveNode: overrides.resolveNode ?? (() => "/usr/bin/node"),
  } as unknown as InstanceType<typeof ToolResolver>;
}

describe("preflightSpawn", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "preflight-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns ok when all checks pass", () => {
    const result = preflightSpawn(tmpDir, { resolver: makeResolver({}) });
    expect(result.ok).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("returns DIR_MISSING when cwd does not exist", () => {
    const result = preflightSpawn("/nonexistent/does/not/exist", { resolver: makeResolver({}) });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.code === "DIR_MISSING")).toBe(true);
  });

  it("returns DIR_NOT_DIRECTORY when cwd is a file", () => {
    const filePath = path.join(tmpDir, "regular-file.txt");
    writeFileSync(filePath, "hello");
    const result = preflightSpawn(filePath, { resolver: makeResolver({}) });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.code === "DIR_NOT_DIRECTORY")).toBe(true);
  });

  it("returns PI_NOT_FOUND when pi binary unresolvable", () => {
    const result = preflightSpawn(tmpDir, { resolver: makeResolver({ resolvePi: () => null }) });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.code === "PI_NOT_FOUND")).toBe(true);
  });

  it("returns NODE_NOT_FOUND when node binary unresolvable", () => {
    const result = preflightSpawn(tmpDir, { resolver: makeResolver({ resolveNode: () => null }) });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.code === "NODE_NOT_FOUND")).toBe(true);
  });

  it("accumulates multiple reasons (no short-circuit)", () => {
    const result = preflightSpawn("/nonexistent/does/not/exist", {
      resolver: makeResolver({ resolvePi: () => null }),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.code === "DIR_MISSING")).toBe(true);
    expect(result.reasons.some((r) => r.code === "PI_NOT_FOUND")).toBe(true);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("does not call login-shell resolver (resolver.resolvePi is called, not whichViaLoginShell)", () => {
    const mockResolver = makeResolver({});
    const spyPi = vi.spyOn(mockResolver, "resolvePi");
    const spyNode = vi.spyOn(mockResolver, "resolveNode");
    preflightSpawn(tmpDir, { resolver: mockResolver });
    expect(spyPi).toHaveBeenCalled();
    expect(spyNode).toHaveBeenCalled();
  });
});
