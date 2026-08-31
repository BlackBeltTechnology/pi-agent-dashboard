/**
 * Doctor core — section assignment, suggestion taxonomy, and the
 * Decision-8 lint (every non-ok check has non-empty
 * message/detail/suggestion). See change: doctor-rich-output.
 *
 * Also hosts the spawn-runtime visibility rows (test-plan E15), the
 * extension-tree ABI mismatch rows (E11), and the autoRebuild consent /
 * abstention decision (X6). See change: unify-pi-runtime-identity.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkAttachedServerVersion,
  type DoctorCheck,
  type DoctorStatus,
  decideAutoRebuild,
  runSharedChecks,
  SECTION_OF,
  type SharedChecksDeps,
  SUGGESTIONS,
  stampSectionsAndSuggestions,
} from "../doctor-core.js";
import type { ProbeOutcome } from "../platform/native-module-abi.js";
import type { ResolvedRuntime } from "../platform/spawn-runtime.js";

const ALL_CHECK_NAMES = Object.keys(SECTION_OF);

describe("SECTION_OF", () => {
  it("maps every canonical check name to one of the six sections", () => {
    const allowed = new Set([
      "runtime",
      "pi-tooling",
      "server",
      "tunnel",
      "setup",
      "diagnostics",
    ]);
    for (const name of ALL_CHECK_NAMES) {
      expect(allowed.has(SECTION_OF[name])).toBe(true);
    }
  });

  it("covers all six sections (none empty)", () => {
    const sections = new Set(Object.values(SECTION_OF));
    for (const s of [
      "runtime",
      "pi-tooling",
      "server",
      "tunnel",
      "setup",
      "diagnostics",
    ]) {
      expect(sections.has(s as never)).toBe(true);
    }
  });

  it("routes the four tunnel checks to section: 'tunnel'", () => {
    expect(SECTION_OF["zrok binary"]).toBe("tunnel");
    expect(SECTION_OF["zrok environment"]).toBe("tunnel");
    expect(SECTION_OF["zrok API reachable"]).toBe("tunnel");
    expect(SECTION_OF["tunnel runtime"]).toBe("tunnel");
  });
});

describe("SUGGESTIONS", () => {
  it("returns undefined for status=ok across every check name", () => {
    for (const name of ALL_CHECK_NAMES) {
      const fn = SUGGESTIONS[name];
      expect(fn).toBeDefined();
      expect(fn?.("ok")).toBeUndefined();
    }
  });

  it("returns a non-empty string for status=error or warning when defined", () => {
    for (const name of ALL_CHECK_NAMES) {
      const fn = SUGGESTIONS[name];
      // Electron is the only one that returns undefined even for non-ok
      // (because today it never fails). Skip it.
      if (name === "Electron") continue;
      const w = fn?.("warning");
      const e = fn?.("error");
      expect(typeof w === "string" && w.length > 0).toBe(true);
      expect(typeof e === "string" && e.length > 0).toBe(true);
    }
  });

  it("constrains suggestion text to the allowed Markdown subset", () => {
    // Allowed: **bold**, single-backtick code, [text](url). Disallow: tables,
    // headings, fenced blocks, raw HTML.
    for (const name of ALL_CHECK_NAMES) {
      const fn = SUGGESTIONS[name];
      const candidates: (string | undefined)[] = [
        fn?.("warning"),
        fn?.("error"),
        fn?.("error", undefined, "not-found"),
        fn?.("error", undefined, "permission-denied"),
        fn?.("error", undefined, "timeout"),
        fn?.("error", undefined, "non-zero-exit"),
      ];
      for (const s of candidates) {
        if (!s) continue;
        // No fenced code blocks.
        expect(/```/.test(s)).toBe(false);
        // No headings at line start.
        expect(/^#{1,6}\s/m.test(s)).toBe(false);
        // No raw HTML tags (closing, self-closing, or with attributes).
        // Plain `<placeholder>` text is allowed (used as prose).
        expect(/<\/[a-zA-Z]|<[a-zA-Z][^>]*\s+[^>]+>|<[a-zA-Z][^>]*\/>/.test(s)).toBe(false);
        // Triple-asterisk or underline for bold not allowed.
        expect(/\*\*\*|___/.test(s)).toBe(false);
      }
    }
  });
});

describe("stampSectionsAndSuggestions (Decision 8 lint)", () => {
  it("stamps section + suggestion on non-ok rows by name", () => {
    const checks: DoctorCheck[] = [
      { name: "pi CLI", section: undefined as unknown as never, status: "error", message: "Not found", detail: "Searched PATH" },
      { name: "System Node.js", section: undefined as unknown as never, status: "ok", message: "v22 at /usr/bin/node" },
    ];
    const out = stampSectionsAndSuggestions(checks);
    expect(out[0].section).toBe("pi-tooling");
    expect(out[0].suggestion).toBeDefined();
    expect(out[1].section).toBe("runtime");
    expect(out[1].suggestion).toBeUndefined();
  });

  it("every non-ok row produced through stamping has non-empty message + detail + suggestion", () => {
    const statuses: DoctorStatus[] = ["warning", "error"];
    for (const name of ALL_CHECK_NAMES) {
      // Electron suggestion is always undefined (decision-by-design); skip.
      if (name === "Electron") continue;
      for (const status of statuses) {
        const checks: DoctorCheck[] = [
          {
            name,
            section: undefined as unknown as never,
            status,
            message: "synthetic message",
            detail: "synthetic detail",
          },
        ];
        const [stamped] = stampSectionsAndSuggestions(checks);
        expect(stamped.message.length).toBeGreaterThan(0);
        expect((stamped.detail ?? "").length).toBeGreaterThan(0);
        expect((stamped.suggestion ?? "").length).toBeGreaterThan(0);
      }
    }
  });

  it("does not overwrite an existing suggestion", () => {
    const checks: DoctorCheck[] = [
      {
        name: "pi CLI",
        section: "pi-tooling",
        status: "error",
        message: "x",
        detail: "y",
        suggestion: "custom",
      },
    ];
    const out = stampSectionsAndSuggestions(checks);
    expect(out[0].suggestion).toBe("custom");
  });
});

describe("checkAttachedServerVersion", () => {
  const fetcher = (health: { version?: string; launchSource?: string } | null) =>
    async () => health;

  it("matching versions → ok", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: fetcher({ version: "0.5.3", launchSource: "electron" }),
    });
    expect(c.status).toBe("ok");
    expect(c.section).toBe("setup");
  });

  it("mismatch + standalone → warning, suggestion mentions npm", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: fetcher({ version: "0.5.1", launchSource: "standalone" }),
    });
    expect(c.status).toBe("warning");
    expect(c.suggestion).toContain("npm i -g @blackbelt-technology/pi-dashboard@0.5.3");
  });

  it("mismatch + bridge → warning, suggestion mentions pi session", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: fetcher({ version: "0.5.1", launchSource: "bridge" }),
    });
    expect(c.status).toBe("warning");
    expect(c.suggestion?.toLowerCase()).toContain("pi session");
  });

  it("mismatch + bridge-orphaned → same bridge suggestion", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: fetcher({ version: "0.5.1", launchSource: "bridge-orphaned" }),
    });
    expect(c.status).toBe("warning");
    expect(c.suggestion?.toLowerCase()).toContain("pi session");
  });

  it("mismatch + electron → warning, suggestion mentions other Electron", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: fetcher({ version: "0.5.1", launchSource: "electron" }),
    });
    expect(c.status).toBe("warning");
    expect(c.suggestion?.toLowerCase()).toContain("electron");
  });

  it("mismatch + unknown/missing launchSource → warning, source-agnostic suggestion (not electron)", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: fetcher({ version: "0.5.1" }), // no launchSource
    });
    expect(c.status).toBe("warning");
    // Must NOT misattribute an unknown source to the other-Electron remedy.
    expect(c.suggestion?.toLowerCase()).not.toContain("quit the other electron");
    expect((c.suggestion ?? "").length).toBeGreaterThan(0);
  });

  it("healthFetcher returns null → error with non-empty message", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: fetcher(null),
    });
    expect(c.status).toBe("error");
    expect(c.message.length).toBeGreaterThan(0);
  });

  it("healthFetcher throws → error", async () => {
    const c = await checkAttachedServerVersion({
      appVersion: "0.5.3",
      healthFetcher: async () => { throw new Error("ECONNREFUSED"); },
    });
    expect(c.status).toBe("error");
  });
});

// ── Spawn-runtime visibility + ABI mismatch rows (test-plan E11 / E15 / X6) ──
// See change: unify-pi-runtime-identity (tasks 5.4 / 6.1 / 9.11 / 9.15 / 9.24).

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-core-runtime-"));
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
function fakeRuntime(over: Partial<ResolvedRuntime> = {}): ResolvedRuntime {
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
    ...over,
  };
}

/** Bytes of a fake V8-bound binary: real symbols, NO N-API registration. */
function v8Bytes(): Buffer {
  return Buffer.from(
    `...fake-object-header...${"__ZN2v88internal7Isolate8NewEPNS0_12Allocator_tE ".repeat(4)}...`,
    "latin1",
  );
}

/** Bytes of a fake N-API binary: exports the N-API registration symbol. */
function napiBytes(): Buffer {
  return Buffer.from(
    `...fake-macho-header...__napi:${"napi_register_module_v1"}...__LINKEDIT...`,
    "latin1",
  );
}

function writeNodeFile(p: string, bytes: Buffer): string {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  return p;
}

/** A Tier-B probe outcome: module built for ABI 115, resolved needs 137. */
const mismatchOutcome: ProbeOutcome = {
  compatible: false,
  builtAbi: 115,
  requiredAbi: 137,
  raw: "was compiled against a different Node.js version using NODE_MODULE_VERSION 115. This version of Node.js requires NODE_MODULE_VERSION 137.",
};

describe("extension-tree ABI mismatch rows (test-plan E11 / task 9.11)", () => {
  it("V8-bound module in a prebuilds layout with mismatched ABI → named row; N-API module skipped", async () => {
    const treeRoot = path.join(tmp, "ext", "node_modules");
    // better-sqlite3 v13-style per-platform prebuilds layout — the layout
    // does NOT exempt the module (distribution format ≠ ABI stability).
    writeNodeFile(
      path.join(treeRoot, "better-sqlite3", "prebuilds", "darwin-arm64", "better_sqlite3.node"),
      v8Bytes(),
    );
    const probedPaths: string[] = [];
    const checks = await runSharedChecks(
      baseDeps({
        spawnRuntime: fakeRuntime(),
        extensionTreeRoot: treeRoot,
        abiScan: {
          probe: (dotNodePath) => {
            probedPaths.push(dotNodePath);
            return mismatchOutcome;
          },
        },
      }),
    );

    const mismatchRows = checks.filter((c) => c.name.startsWith("ABI mismatch:"));
    expect(mismatchRows.map((c) => c.name)).toEqual(["ABI mismatch: better-sqlite3"]);
    const row = mismatchRows[0]!;
    expect(row.section).toBe("pi-tooling");
    expect(row.status).toBe("error");
    expect(row.message).toContain("better-sqlite3");
    expect(row.message).toContain("ABI 115");
    expect(row.message).toContain("ABI 137");
    expect(row.message).toContain("/resolved/node");
    // Scoped rebuild command names the module and the resolved runtime.
    expect(row.suggestion).toContain("rebuild better-sqlite3");
    // The V8 module was probed under the RESOLVED runtime's binary.
    expect(probedPaths).toHaveLength(1);
    expect(probedPaths[0]).toContain("better_sqlite3.node");
  });

  it("N-API module → no row (never probed)", async () => {
    const treeRoot = path.join(tmp, "ext", "node_modules");
    writeNodeFile(
      path.join(treeRoot, "napi-pkg", "build", "Release", "thing.node"),
      napiBytes(),
    );
    const probedPaths: string[] = [];
    const checks = await runSharedChecks(
      baseDeps({
        spawnRuntime: fakeRuntime(),
        extensionTreeRoot: treeRoot,
        abiScan: {
          probe: (dotNodePath) => {
            probedPaths.push(dotNodePath);
            return mismatchOutcome;
          },
        },
      }),
    );
    expect(checks.filter((c) => c.name.startsWith("ABI mismatch:"))).toHaveLength(0);
    expect(probedPaths).toHaveLength(0);
  });

  it("absent extension tree → no rows", async () => {
    const checks = await runSharedChecks(
      baseDeps({
        spawnRuntime: fakeRuntime(),
        extensionTreeRoot: path.join(tmp, "no-such-tree"),
      }),
    );
    expect(checks.filter((c) => c.name.startsWith("ABI mismatch:"))).toHaveLength(0);
  });
});

describe("resolved spawn runtime visibility row (test-plan E15 / task 9.15)", () => {
  it("resolved runtime + divergent PATH install → both shown, node -v remedy, override pointer", async () => {
    const checks = await runSharedChecks(
      baseDeps({
        spawnRuntime: fakeRuntime(),
        detectSystemNode: () => ({ found: true, path: "/usr/local/bin/node" }),
      }),
    );
    const row = checks.find((c) => c.name === "Spawn runtime (resolved)");
    expect(row).toBeDefined();
    expect(row!.section).toBe("runtime");
    expect(row!.status).toBe("warning");
    // Both runtimes are named…
    expect(row!.message).toContain("/resolved/node");
    expect(row!.message).toContain("/usr/local/bin/node");
    // …with the compare remedy and the deterministic escape hatch.
    expect(row!.detail).toContain("node -v");
    expect(row!.detail).toContain("runtime.override");
    expect(row!.suggestion).toContain("node -v");
  });

  it("base row names binary, version, ABI, and ladder source", async () => {
    const checks = await runSharedChecks(
      baseDeps({
        spawnRuntime: fakeRuntime({ rung: "override" }),
        detectSystemNode: () => ({ found: true, path: "/resolved/node" }),
      }),
    );
    const row = checks.find((c) => c.name === "Spawn runtime (resolved)");
    expect(row!.status).toBe("ok");
    expect(row!.message).toContain("/resolved/node");
    expect(row!.message).toContain("v24.0.0");
    expect(row!.message).toContain("ABI 137");
    expect(row!.message).toContain("via override");
    // No divergence → no override-pointer advice.
    expect(row!.detail).not.toContain("Divergent probe");
  });

  it("override shadowing a selection → the shadowed selection is named in the detail", async () => {
    const checks = await runSharedChecks(
      baseDeps({
        spawnRuntime: fakeRuntime({
          rung: "override",
          via: undefined,
          trail: [
            {
              rung: "selection",
              candidate: "/selected/by-family/node",
              outcome: "skipped",
              reason: "shadowed by runtime.override",
            },
          ],
        }),
        detectSystemNode: () => ({ found: true, path: "/resolved/node" }),
      }),
    );
    const row = checks.find((c) => c.name === "Spawn runtime (resolved)")!;
    expect(row.detail).toContain("Shadowed selection");
    expect(row.detail).toContain("/selected/by-family/node");
  });

  it("resolved major at/above the engines cap → informational note, status NOT an error", async () => {
    const checks = await runSharedChecks(
      baseDeps({
        spawnRuntime: fakeRuntime({ version: "v27.0.0" }),
        detectSystemNode: () => ({ found: true, path: "/resolved/node" }),
      }),
    );
    const row = checks.find((c) => c.name === "Spawn runtime (resolved)")!;
    expect(row.status).toBe("ok");
    expect(row.message).toContain("exceeds the dashboard-tested range");
    expect(row.detail).toContain("informational, not a failure");
  });

  it("no spawnRuntime provided → row suppressed", async () => {
    const checks = await runSharedChecks(baseDeps());
    expect(checks.find((c) => c.name === "Spawn runtime (resolved)")).toBeUndefined();
  });
});

describe("decideAutoRebuild consent + abstention (test-plan X6 / task 9.24)", () => {
  const mismatches = [{ entry: { path: "/x/better-sqlite3/build/Release/x.node" }, builtAbi: 115 }];

  it("autoRebuild off/absent → offer only (consent by default)", () => {
    expect(decideAutoRebuild({ autoRebuild: undefined, mismatches, divergenceDetected: false })).toBe("offer");
    expect(decideAutoRebuild({ autoRebuild: undefined, mismatches, divergenceDetected: true })).toBe("offer");
    expect(decideAutoRebuild({ autoRebuild: false, mismatches, divergenceDetected: false })).toBe("offer");
  });

  it("autoRebuild on + no divergence → unattended rebuild", () => {
    expect(decideAutoRebuild({ autoRebuild: true, mismatches, divergenceDetected: false })).toBe("rebuild");
  });

  it("autoRebuild on + divergence → abstain (offer interactively)", () => {
    expect(decideAutoRebuild({ autoRebuild: true, mismatches, divergenceDetected: true })).toBe("abstain");
  });

  it("no mismatches → offer (nothing to reconcile)", () => {
    expect(decideAutoRebuild({ autoRebuild: true, mismatches: [], divergenceDetected: false })).toBe("offer");
  });
});

describe("autoRebuild unattended executor (task 5.4 / spec X6 run half)", () => {
  it("executor fires per mismatched module when consent authorizes the rebuild", async () => {
    const treeRoot = path.join(tmp, "ext", "node_modules");
    writeNodeFile(
      path.join(treeRoot, "better-sqlite3", "build", "Release", "better_sqlite3.node"),
      v8Bytes(),
    );
    const executed: Array<{ module: string; treeRoot: string }> = [];
    const checks = await runSharedChecks(
      baseDeps({
        spawnRuntime: fakeRuntime(),
        // Same binary as the resolved runtime → no divergence → decision "rebuild".
        detectSystemNode: () => ({ found: true, path: "/resolved/node" }),
        extensionTreeRoot: treeRoot,
        readAutoRebuild: () => true,
        abiScan: { probe: () => mismatchOutcome },
        rebuildExecutor: async (moduleName, root) => {
          executed.push({ module: moduleName, treeRoot: root });
          return { ok: true, detail: "rebuilt" };
        },
      }),
    );
    expect(executed).toEqual([{ module: "better-sqlite3", treeRoot }]);
    const row = checks.find((c) => c.name.startsWith("ABI mismatch:"));
    expect(row?.suggestion).toContain("autoRebuild authorized");
  });

  it("no executor wired → nothing executes (Electron arm records the decision only)", async () => {
    const treeRoot = path.join(tmp, "ext2", "node_modules");
    writeNodeFile(path.join(treeRoot, "pkg", "build", "Release", "a.node"), v8Bytes());
    const checks = await runSharedChecks(
      baseDeps({
        spawnRuntime: fakeRuntime(),
        extensionTreeRoot: treeRoot,
        readAutoRebuild: () => true,
        abiScan: { probe: () => mismatchOutcome },
      }),
    );
    expect(checks.find((c) => c.name.startsWith("ABI mismatch:"))).toBeDefined();
  });

  it("throwing executor is contained: row survives, report survives", async () => {
    const treeRoot = path.join(tmp, "ext3", "node_modules");
    writeNodeFile(path.join(treeRoot, "pkg", "build", "Release", "a.node"), v8Bytes());
    const checks = await runSharedChecks(
      baseDeps({
        spawnRuntime: fakeRuntime(),
        extensionTreeRoot: treeRoot,
        readAutoRebuild: () => true,
        abiScan: { probe: () => mismatchOutcome },
        rebuildExecutor: async () => {
          throw new Error("npm blew up");
        },
      }),
    );
    expect(checks.find((c) => c.name.startsWith("ABI mismatch:"))).toBeDefined();
  });
});
