/**
 * Tests for the native-module ABI guard rail (change
 * unify-pi-runtime-identity, tasks 5.1–5.3). Scenario ids reference the
 * change's test-plan.md; folded test tasks 9.10, 9.12, 9.16, 9.17, 9.21.
 *
 * Exemplar: spawn-runtime.test.ts (injectable-probe + fixture-tree style).
 * All fixtures live under os.tmpdir(); ~/.pi is never touched.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildNativeModuleManifest,
  checkManifestDrift,
  type FakeableSpawn,
  findAbiMismatches,
  isNapiModuleFile,
  type NativeModuleEntry,
  type NativeModuleManifest,
  type ProbeOutcome,
  probeNativeModuleAbi,
  readNativeModuleAbi,
  walkNativeModuleFiles,
} from "../platform/native-module-abi.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "native-module-abi-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ── Fixture helpers ──────────────────────────────────────────────────────────

/** Bytes of a fake N-API binary: exports the N-API registration symbol. */
function napiBytes(): Buffer {
  return Buffer.from(
    `...fake-macho-header...__napi:${"napi_register_module_v1"}...__LINKEDIT...`,
    "latin1",
  );
}

/** Bytes of a fake V8-bound binary: real symbols, NO N-API registration. */
function v8Bytes(repeat = 4): Buffer {
  return Buffer.from(
    `...fake-object-header...${"__ZN2v88internal7Isolate8NewEPNS0_12Allocator_tE ".repeat(repeat)}...`,
    "latin1",
  );
}

/** Write a `.node` file (and parents) with the given bytes. */
function writeNodeFile(p: string, bytes: Buffer): string {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, bytes);
  return p;
}

/** p95 of per-iteration durations (test-plan P1/P2 timing glue). */
function p95(durations: number[]): number {
  const sorted = [...durations].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
}

/** 100-entry synthetic manifest backed by an in-memory stat map. */
function hundredEntryManifest(): { manifest: NativeModuleManifest; stat: (p: string) => { size: number; mtimeMs: number } | null } {
  const sigs = new Map<string, { size: number; mtimeMs: number }>();
  const entries: NativeModuleEntry[] = [];
  for (let i = 0; i < 100; i++) {
    const p = path.join(`/fake-tree/pkg-${i}`, "build", "Release", `mod-${i}.node`);
    const sig = { size: 1000 + i, mtimeMs: 1_700_000_000_000 + i };
    sigs.set(p, sig);
    entries.push({ path: p, size: sig.size, mtimeMs: sig.mtimeMs, classification: i % 2 === 0 ? "v8" : "napi" });
  }
  return {
    manifest: { treeRoot: "/fake-tree", scannedAt: new Date().toISOString(), entries },
    stat: (p) => sigs.get(p) ?? null,
  };
}

// ── N-API classification unit (unit half of test-plan E11) ───────────────────

describe("isNapiModuleFile — byte-level N-API classification", () => {
  it("classifies by the registration symbol only", () => {
    // Unit half of test-plan E11: N-API identified by binary inspection.
    expect(isNapiModuleFile(napiBytes())).toBe(true);
    expect(isNapiModuleFile(v8Bytes())).toBe(false);
    // Uncertain bytes (empty) → false → treated V8-bound; the probe decides.
    expect(isNapiModuleFile(Buffer.alloc(0))).toBe(false);
    // Symbol embedded mid-binary, not at an offset, still matches.
    expect(isNapiModuleFile(Buffer.concat([v8Bytes(), napiBytes(), v8Bytes()]))).toBe(true);
  });
});

// ── Tier-B probe containment (test-plan X3 / task 9.21) ──────────────────────

describe("probeNativeModuleAbi — Tier-B containment (test-plan X3 / task 9.21)", () => {
  const modPath = "/fake/tree/pkg/build/Release/mod.node";

  it("passes a fixed argv: -e script first, module path last, no shell", () => {
    let seen: { binary: string; args: readonly string[] } | null = null;
    const spawn: FakeableSpawn = (binary, args) => {
      seen = { binary, args };
      return { status: 0, stdout: "137", stderr: "" };
    };
    const outcome = probeNativeModuleAbi(modPath, "/fake/node", { spawn });
    expect(seen).not.toBeNull();
    const captured = seen as unknown as { binary: string; args: string[] };
    expect(captured.binary).toBe("/fake/node");
    expect(captured.args[0]).toBe("-e");
    expect(captured.args[captured.args.length - 1]).toBe(modPath);
    expect(outcome).toEqual({ compatible: true, builtAbi: 137, requiredAbi: 137, raw: "137" });
  });

  it("child crashes on dlopen (non-zero, no parseable message) → null verdict, no throw", () => {
    const crashSpawn: FakeableSpawn = () => ({
      status: 1,
      stdout: "",
      stderr: "some unrelated dlopen error: no suitable image found",
    });
    expect(probeNativeModuleAbi(modPath, "/fake/node", { spawn: crashSpawn })).toBeNull();

    // Killed / timed-out child (status null) → same containment.
    const killedSpawn: FakeableSpawn = () => ({ status: null, stdout: "", stderr: "" });
    expect(probeNativeModuleAbi(modPath, "/fake/node", { spawn: killedSpawn })).toBeNull();

    // Spawn itself failing (returns null) → same containment.
    const failedSpawn: FakeableSpawn = () => null;
    expect(probeNativeModuleAbi(modPath, "/fake/node", { spawn: failedSpawn })).toBeNull();

    // Garbage on the success path (exit 0, unparseable stdout) → unknown.
    const garbageSpawn: FakeableSpawn = () => ({ status: 0, stdout: "", stderr: "" });
    expect(probeNativeModuleAbi(modPath, "/fake/node", { spawn: garbageSpawn })).toBeNull();
  });

  it("child emits the NODE_MODULE_VERSION mismatch message → verdict parsed from it", () => {
    const messageSpawn: FakeableSpawn = () => ({
      status: 1,
      stdout: "",
      stderr:
        "Error: The module 'mod.node'\nwas compiled against a different Node.js version using NODE_MODULE_VERSION 141. This version of Node.js requires 137. Be sure to recompile this module with the same major version of Node.js.",
    });
    // test-plan X3: verdict recorded from the parseable message.
    const outcome = probeNativeModuleAbi(modPath, "/fake/node", { spawn: messageSpawn });
    expect(outcome).toMatchObject({ compatible: false, builtAbi: 141, requiredAbi: 137 });
    expect((outcome as ProbeOutcome).raw).toContain("NODE_MODULE_VERSION 141");

    // Historical wording ("requires NODE_MODULE_VERSION Y") parses too.
    const prefixedSpawn: FakeableSpawn = () => ({
      status: 1,
      stdout: "",
      stderr:
        "was compiled against a different Node.js version using NODE_MODULE_VERSION 141. This version of Node.js requires NODE_MODULE_VERSION 137. Please try re-compiling.",
    });
    expect(probeNativeModuleAbi(modPath, "/fake/node", { spawn: prefixedSpawn })).toMatchObject({
      compatible: false,
      builtAbi: 141,
      requiredAbi: 137,
    });
  });
});

// ── Two-tier read (task 5.1) ─────────────────────────────────────────────────

describe("readNativeModuleAbi — two-tier", () => {
  const modPath = "/fake/tree/pkg/build/Release/mod.node";

  it("N-API module → null, probe never invoked (Tier A exempts)", () => {
    let probeCalls = 0;
    const outcome = readNativeModuleAbi(modPath, {
      nodeBinary: "/fake/node",
      readBytes: () => napiBytes(),
      probe: () => {
        probeCalls++;
        return null;
      },
    });
    expect(outcome).toBeNull();
    expect(probeCalls).toBe(0);
  });

  it("V8-bound module → builtAbi from the probe, even when incompatible", () => {
    const outcome = readNativeModuleAbi(modPath, {
      nodeBinary: "/fake/node",
      readBytes: () => v8Bytes(),
      probe: () => ({ compatible: false, builtAbi: 141, requiredAbi: 137, raw: "mismatch" }),
    });
    expect(outcome).toBe(141);
  });

  it("probe verdict unknown → null", () => {
    const outcome = readNativeModuleAbi(modPath, {
      nodeBinary: "/fake/node",
      readBytes: () => v8Bytes(),
      probe: () => null,
    });
    expect(outcome).toBeNull();
  });

  it("real child dlopen failure on garbage bytes → null, caller unaffected (default spawn)", () => {
    // End-to-end containment with a REAL child: garbage bytes are not a
    // loadable module, dlopen fails with a non-ABI message → verdict null.
    const garbage = writeNodeFile(path.join(tmp, "garbage.node"), v8Bytes());
    const outcome = probeNativeModuleAbi(garbage, process.execPath, { timeoutMs: 10_000 });
    expect(outcome).toBeNull();
  });
});

// ── Discovery-walk depth boundary (test-plan E10 / task 9.10) ────────────────

describe("walkNativeModuleFiles — depth cap 8 (test-plan E10 / task 9.10)", () => {
  it("includes a .node at 8 hops and excludes one at 9 hops below the root", () => {
    // Chain d1..d9 below the root: a file's parent dir at depth 8 is in,
    // at depth 9 is out (depth(root)=0).
    const root = path.join(tmp, "tree");
    let dir = root;
    for (let i = 1; i <= 9; i++) {
      dir = path.join(dir, `d${i}`);
    }
    const atEight = writeNodeFile(
      path.join(root, "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "good.node"),
      v8Bytes(),
    );
    const atNine = path.join(root, "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "deep.node");
    writeNodeFile(atNine, v8Bytes());

    const found = walkNativeModuleFiles(root);
    expect(found).toContain(atEight);
    expect(found.some((p) => p.endsWith("deep.node"))).toBe(false);

    // test-plan E10 observable: the depth-8 file lands in the manifest (its
    // builtAbi is filled later at Doctor/pre-spawn evaluation time — the
    // walk classifies but never probes by design).
    const manifest = buildNativeModuleManifest(root);
    const entry = manifest.entries.find((e) => e.path === atEight);
    expect(entry).toBeDefined();
    expect(entry?.classification).toBe("v8");
    expect(manifest.entries.some((e) => e.path === atNine)).toBe(false);
  });

  it("honours an explicit smaller maxDepth with the same boundary rule", () => {
    const root = path.join(tmp, "shallow");
    const one = writeNodeFile(path.join(root, "d1", "one.node"), v8Bytes());
    const two = writeNodeFile(path.join(root, "d1", "d2", "two.node"), v8Bytes());
    writeNodeFile(path.join(root, "d1", "d2", "d3", "three.node"), v8Bytes());

    const found = walkNativeModuleFiles(root, { maxDepth: 2 });
    expect(found).toContain(one);
    expect(found).toContain(two);
    expect(found.some((p) => p.endsWith("three.node"))).toBe(false);
  });

  it("returns [] for a missing tree root", () => {
    expect(walkNativeModuleFiles(path.join(tmp, "nope"))).toEqual([]);
  });
});

// ── Real-fs manifest round trip (task 5.2) ───────────────────────────────────

describe("buildNativeModuleManifest — real-fs round trip", () => {
  it("walks nested node_modules and prebuilds, classifying by bytes not layout", () => {
    const root = path.join(tmp, "shared-tree");
    const nested = writeNodeFile(
      path.join(root, "node_modules", "@x", "y", "build", "Release", "a.node"),
      v8Bytes(),
    );
    // Unit half of test-plan E11: a V8-bound binary under a prebuilds
    // layout does NOT get exempted — distribution layout never influences
    // the verdict.
    const prebuildV8 = writeNodeFile(
      path.join(root, "prebuilds", "darwin-arm64", "b.node"),
      v8Bytes(),
    );
    const prebuildNapi = writeNodeFile(
      path.join(root, "prebuilds", "linux-x64", "c.node"),
      napiBytes(),
    );

    const manifest = buildNativeModuleManifest(root);
    expect(manifest.treeRoot).toBe(root);
    expect(Number.isNaN(Date.parse(manifest.scannedAt))).toBe(false);
    expect(manifest.entries.map((e) => e.path)).toEqual([nested, prebuildV8, prebuildNapi]);

    const byPath = new Map(manifest.entries.map((e) => [e.path, e]));
    expect(byPath.get(nested)?.classification).toBe("v8");
    expect(byPath.get(prebuildV8)?.classification).toBe("v8");
    expect(byPath.get(prebuildNapi)?.classification).toBe("napi");
    for (const e of manifest.entries) {
      expect(e.size).toBeGreaterThan(0);
      expect(e.mtimeMs).toBeGreaterThan(0);
    }
  });
});

// ── In-place rebuild invalidation (test-plan E12 / task 9.12) ────────────────

describe("checkManifestDrift + findAbiMismatches — in-place rebuild (test-plan E12 / task 9.12)", () => {
  it("re-detects an in-place rewrite (same tree shape) and re-evaluates the module", () => {
    const root = path.join(tmp, "tree");
    const modPath = writeNodeFile(
      path.join(root, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
      v8Bytes(4),
    );
    const manifest = buildNativeModuleManifest(root);
    expect(manifest.entries).toHaveLength(1);

    // Signatures hold → no drift.
    expect(checkManifestDrift(manifest).driftedPaths).toEqual([]);

    // External `npm rebuild` rewrites the file in place: same path, same
    // tree shape, different bytes (size differs — mtime granularity varies
    // by filesystem, size does not).
    writeNodeFile(modPath, v8Bytes(8));
    const drift = checkManifestDrift(manifest);
    expect(drift.driftedPaths).toEqual([modPath]);
    // The fresh manifest carries the CURRENT signature.
    expect(drift.fresh.entries[0]?.size).toBe(v8Bytes(8).length);

    // test-plan E12: the module is re-evaluated against the resolved ABI —
    // the stale manifest entry (v8) is probed and the mismatch reported.
    let probeCalls = 0;
    const rows = findAbiMismatches(manifest.entries, 137, {
      nodeBinary: "/fake/node",
      probe: () => {
        probeCalls++;
        return { compatible: false, builtAbi: 999, requiredAbi: 137, raw: "mismatch" };
      },
    });
    expect(probeCalls).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.builtAbi).toBe(999);
    // Re-evaluated entry carries the post-drift signature.
    expect(rows[0]?.entry.path).toBe(modPath);
    expect(rows[0]?.entry.size).toBe(v8Bytes(8).length);

    // A second in-place rebuild flips the module to N-API bytes: the
    // drifted entry is re-read before the verdict and never condemned.
    writeNodeFile(modPath, napiBytes());
    const drift2 = checkManifestDrift(manifest);
    expect(drift2.driftedPaths).toEqual([modPath]);
    probeCalls = 0;
    const rowsAfterNapiRebuild = findAbiMismatches(manifest.entries, 137, {
      nodeBinary: "/fake/node",
      probe: () => {
        probeCalls++;
        return { compatible: false, builtAbi: 999, requiredAbi: 137, raw: "mismatch" };
      },
    });
    expect(rowsAfterNapiRebuild).toEqual([]);
    expect(probeCalls).toBe(0);
  });

  it("non-drifted v8 entry: probed, mismatch row only when builtAbi differs; probe failure yields no row", () => {
    const root = path.join(tmp, "tree2");
    writeNodeFile(path.join(root, "mod.node"), v8Bytes());
    const manifest = buildNativeModuleManifest(root);

    expect(checkManifestDrift(manifest).driftedPaths).toEqual([]);

    // Matching ABI → coherent tree, no row.
    expect(
      findAbiMismatches(manifest.entries, 137, {
        nodeBinary: "/fake/node",
        probe: () => ({ compatible: true, builtAbi: 137, requiredAbi: 137, raw: "" }),
      }),
    ).toEqual([]);

    // Probe verdict unknown (crash/garbage/timeout) → no row: unknown ≠
    // mismatch.
    expect(
      findAbiMismatches(manifest.entries, 137, {
        nodeBinary: "/fake/node",
        probe: () => null,
      }),
    ).toEqual([]);
  });

  it("N-API entries never appear, and a vanished module yields no row", () => {
    const root = path.join(tmp, "tree3");
    writeNodeFile(path.join(root, "napi-mod.node"), napiBytes());
    const vanished = writeNodeFile(path.join(root, "gone.node"), v8Bytes());
    const entries = buildNativeModuleManifest(root).entries;

    let probeCalls = 0;
    const probe = (): ProbeOutcome | null => {
      probeCalls++;
      return { compatible: false, builtAbi: 999, requiredAbi: 137, raw: "" };
    };
    // N-API entry skipped without a probe; vanished entry → unknown, no row.
    const statMap = new Map(entries.map((e) => [e.path, { size: e.size, mtimeMs: e.mtimeMs }]));
    statMap.delete(vanished);
    const rows = findAbiMismatches(entries, 137, {
      nodeBinary: "/fake/node",
      probe,
      stat: (p) => statMap.get(p) ?? null,
    });
    expect(rows).toEqual([]);
    expect(probeCalls).toBe(0);
  });
});

// ── Pre-spawn latency budgets (test-plan P1 / task 9.16, P2 / task 9.17) ─────

describe("pre-spawn latency budgets", () => {
  it("P1: stat path p95 < 50ms over a 100-entry manifest, 100 iterations (test-plan P1 / task 9.16)", () => {
    const { manifest, stat } = hundredEntryManifest();
    const durations: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      const result = checkManifestDrift(manifest, { stat });
      durations.push(performance.now() - start);
      // Unchanged signatures → the cheap path: no drift, fresh manifest kept.
      if (i === 0) {
        expect(result.driftedPaths).toEqual([]);
        expect(result.fresh.entries).toHaveLength(100);
      }
    }
    expect(durations.length).toBe(100);
    expect(p95(durations)).toBeLessThan(50);
  });

  it("P2: shim-probe path p95 < 250ms over a 100-entry manifest, 20 iterations (test-plan P2 / task 9.17)", () => {
    // Shim-shaped resolution forces the per-spawn probe; the equivalent
    // workload here is drift re-stat + full re-evaluation with a probe
    // injection that resolves instantly.
    const { manifest, stat } = hundredEntryManifest();
    let probeCalls = 0;
    const probe = (): ProbeOutcome => {
      probeCalls++;
      return { compatible: false, builtAbi: 999, requiredAbi: 137, raw: "" };
    };
    const durations: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      checkManifestDrift(manifest, { stat });
      const rows = findAbiMismatches(manifest.entries, 137, { nodeBinary: "/fake/node", probe, stat });
      durations.push(performance.now() - start);
      if (i === 0) {
        // Only the 50 v8 entries probe; the 50 napi entries never do.
        expect(rows).toHaveLength(50);
      }
    }
    expect(durations.length).toBe(20);
    expect(probeCalls).toBe(50 * 20);
    expect(p95(durations)).toBeLessThan(250);
  });
});
