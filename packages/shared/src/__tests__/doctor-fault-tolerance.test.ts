/**
 * Doctor fault isolation (test-plan X1 / task 9.19): a THROWING advisory
 * input must never fail the Doctor run — the report is still produced and
 * the failed advisory's rows are simply absent.
 *
 * Covered faults:
 *   - legacy-dir detector throws → report produced, no `Legacy install
 *     directory` row (spec: "Detector failure is non-fatal")
 *   - extension-tree ABI scan throws (probe fault) → report produced, no
 *     `ABI mismatch: …` rows
 *
 * See change: unify-pi-runtime-identity (tasks 5.4 / 6.2 / test-plan X1).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DoctorCheck,
  runSharedChecks,
  type SharedChecksDeps,
} from "../doctor-core.js";
import type { ResolvedRuntime } from "../platform/spawn-runtime.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-fault-tolerance-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function baseDeps(overrides: Partial<SharedChecksDeps> = {}): SharedChecksDeps {
  return {
    managedDir: tmp,
    detectSystemNode: () => ({ found: true, path: "/usr/bin/node" }),
    detectPi: () => ({ found: true, path: "/usr/bin/pi", source: "system" }),
    detectOpenSpec: () => ({ found: true, path: "/usr/bin/openspec", source: "system" }),
    dnsLookup: async () => undefined,
    ...overrides,
  };
}

/** Minimal fake ResolvedRuntime — only the fields the Doctor rows read. */
function fakeRuntime(): ResolvedRuntime {
  return {
    nodeBinary: "/resolved/node",
    nodeBinDir: "/resolved",
    version: "v24.0.0",
    abi: 137,
    source: "system",
    rung: "user",
    via: "path",
    arm: "npm",
    piFloor: "22.19.0",
    piFloorSource: "fallback",
    identity: null,
    trail: [],
    resolvedAt: new Date().toISOString(),
  };
}

/** Bytes of a fake V8-bound binary (no N-API registration symbol). */
function v8Bytes(): Buffer {
  return Buffer.from(
    `...fake-object-header...${"__ZN2v88internal7Isolate8NewEPNS0_12Allocator_tE ".repeat(4)}...`,
    "latin1",
  );
}

function names(checks: DoctorCheck[]): string[] {
  return checks.map((c) => c.name);
}

describe("doctor fault tolerance (test-plan X1)", () => {
  it("legacy-dir detector throws → report produced, no Legacy install directory row", async () => {
    const checks = await runSharedChecks(
      baseDeps({
        detectLegacyManagedDir: () => {
          throw new Error("simulated detector failure");
        },
      }),
    );
    expect(checks.length).toBeGreaterThan(0);
    expect(names(checks)).toContain("System Node.js");
    expect(names(checks)).not.toContain("Legacy install directory");
  });

  it("ABI scan throws → report produced, no ABI mismatch rows", async () => {
    // Real tmp tree with one V8-bound module so the scan reaches the probe,
    // then a probe that throws — the whole block collapses to "no rows".
    const moduleDir = path.join(tmp, "ext", "node_modules", "better-sqlite3");
    const dotNode = path.join(moduleDir, "build", "Release", "better_sqlite3.node");
    fs.mkdirSync(path.dirname(dotNode), { recursive: true });
    fs.writeFileSync(dotNode, v8Bytes());

    const checks = await runSharedChecks(
      baseDeps({
        spawnRuntime: fakeRuntime(),
        extensionTreeRoot: path.join(tmp, "ext", "node_modules"),
        abiScan: {
          probe: () => {
            throw new Error("simulated probe failure");
          },
        },
      }),
    );
    expect(checks.length).toBeGreaterThan(0);
    expect(names(checks)).toContain("System Node.js");
    expect(names(checks).filter((n) => n.startsWith("ABI mismatch:"))).toHaveLength(0);
  });
});
