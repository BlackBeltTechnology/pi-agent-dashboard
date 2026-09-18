/**
 * Session heap ceiling: argv normalization + the provenance-gated strip of the
 * dashboard's own inherited flag.
 *
 * Structure follows `process-manager-spawn-env.test.ts` (the nearest existing
 * spec of this category): a tmp HOME, the exported pure builders, no spawning.
 *
 * See change: bound-session-heap-and-gc-telemetry
 * (test-plan #E10–#E15, #X4, #X5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import {
  buildSessionHeapArgs,
  HEAP_FLAG_MARKER_ENV,
  MAX_OLD_SPACE_FLAG_PATTERN,
  mergeHeapIntoNodeOptions,
  stampHeapFlag,
  stripDashboardHeapFlag,
} from "@blackbelt-technology/pi-dashboard-shared/heap-flags.js";
import {
  DEFAULT_SERVER_HEAP,
  MIN_HEAP_MB,
} from "@blackbelt-technology/pi-dashboard-shared/heap-limits.js";
import type { ResolvedRuntime } from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-runtime.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetHeapFallbackForTests,
  applyHeapArgsToPiArgv,
  hasNodeShebang,
  heapFallbackStatus,
  recordHeapArgvFallback,
} from "../spawn-process/heap-args.js";
import {
  applySpawnRuntimeToPiArgv,
  buildSpawnEnv,
} from "../spawn-process/process-manager.js";

const isWin = process.platform === "win32";

let tmpHome: string;
let origHome: string | undefined;
let origUserProfile: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pm-heap-"));
  origHome = process.env.HOME;
  origUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  if (isWin) process.env.USERPROFILE = tmpHome;
  _resetHeapFallbackForTests();
});

afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUserProfile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  _resetHeapFallbackForTests();
});

function seedConfig(config: Record<string, unknown>): void {
  const file = path.join(tmpHome, ".pi", "dashboard", "config.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config));
}

const NODE = path.join("/opt", "node", "bin", "node");
const runtime = (nodeBinary: string): ResolvedRuntime =>
  ({ nodeBinary, nodeBinDir: path.dirname(nodeBinary) }) as ResolvedRuntime;

const HEAP = ["--max-old-space-size=512"];
/** Stand-in for the on-disk read: the bare entry IS a node script. */
const isNodeScript = () => true;
/** Drive the shebang predicate with a literal first line instead of a file. */
const hasNodeShebangForTests = (line: string) => hasNodeShebang("/unused", () => line);

describe("argv normalization (test-plan #E10)", () => {
  it("the node-wrapped pair gains a heap slot before the entry", () => {
    const { argv, fallback } = applyHeapArgsToPiArgv([NODE, "/abs/cli.js"], HEAP, null, isNodeScript);
    expect(argv).toEqual([NODE, "--max-old-space-size=512", "/abs/cli.js"]);
    expect(fallback).toBe(false);
  });

  it("a bare shebang entry is normalized against the resolved runtime", () => {
    const { argv, fallback } = applyHeapArgsToPiArgv(["/abs/pi"], HEAP, runtime(NODE), isNodeScript);
    expect(argv).toEqual([NODE, "--max-old-space-size=512", "/abs/pi"]);
    expect(fallback).toBe(false);
  });

  it("heap args land strictly BEFORE the entry point in both shapes", () => {
    for (const argv of [
      applyHeapArgsToPiArgv([NODE, "/abs/cli.js"], HEAP, null, isNodeScript).argv,
      applyHeapArgsToPiArgv(["/abs/pi"], HEAP, runtime(NODE), isNodeScript).argv,
    ]) {
      const heapIdx = argv.findIndex((a) => a.startsWith("--max-old-space-size"));
      const entryIdx = argv.length - 1;
      // After the entry they would be PI's arguments, and pi rejects them.
      expect(heapIdx).toBeGreaterThan(0);
      expect(heapIdx).toBeLessThan(entryIdx);
    }
  });

  it("an entry that is not a node script yields no runtime slot", () => {
    const { argv, fallback } = applyHeapArgsToPiArgv(
      ["C:\\bin\\pi.cmd"],
      HEAP,
      runtime(NODE),
      () => false,
    );
    // Prepending `node` to a shim produces an invocation that cannot run at
    // all, so the ceiling is dropped and the fallback is reported instead.
    expect(argv).toEqual(["C:\\bin\\pi.cmd"]);
    expect(fallback).toBe(true);
  });

  it("no configured flags ⇒ pass-through, and NOT a fallback", () => {
    const { argv, fallback } = applyHeapArgsToPiArgv([NODE, "/abs/cli.js"], [], null, isNodeScript);
    expect(argv).toEqual([NODE, "/abs/cli.js"]);
    expect(fallback).toBe(false);
  });
});

describe("ordering vs the runtime re-point (test-plan #E11)", () => {
  it("re-point still applies AND heap args are present", () => {
    const resolved = runtime("/resolved/node");
    // The production order: re-point first, heap second. Reversing it would
    // insert a flag at index 1 and destroy the pair detection below.
    const repointed = applySpawnRuntimeToPiArgv(["/other/node", "/abs/cli.js"], resolved);
    expect(repointed[0]).toBe("/resolved/node");
    const { argv } = applyHeapArgsToPiArgv(repointed, HEAP, resolved, isNodeScript);
    expect(argv).toEqual(["/resolved/node", "--max-old-space-size=512", "/abs/cli.js"]);
  });

  it("applying heap FIRST would break the re-point — pinning why order matters", () => {
    const resolved = runtime("/resolved/node");
    const heapedFirst = applyHeapArgsToPiArgv(
      ["/other/node", "/abs/cli.js"],
      HEAP,
      resolved,
      isNodeScript,
    ).argv;
    // argv[1] is now a flag, not a `.js`, so the pair detector declines.
    expect(applySpawnRuntimeToPiArgv(heapedFirst, resolved)[0]).toBe("/other/node");
  });
});

describe("pi's own args are untouched (test-plan #E12)", () => {
  it("session flags keep order and content, and carry no heap flag", () => {
    const piArgs = ["--mode", "rpc", "--session", "/abs/s.jsonl", "--name", "demo"];
    const { argv } = applyHeapArgsToPiArgv([NODE, "/abs/cli.js"], HEAP, null, isNodeScript);
    const full = [...argv, ...piArgs];
    expect(full.slice(-piArgs.length)).toEqual(piArgs);
    expect(piArgs.some((a) => a.includes("old-space"))).toBe(false);
  });
});

describe("invalid values never reach a process (test-plan #X5)", () => {
  it('maxOldSpaceMb "lots" loads as the default and emits an integer token', () => {
    seedConfig({ sessionHeap: { maxOldSpaceMb: "lots" } });
    const args = buildSessionHeapArgs(loadConfig().sessionHeap);
    expect(args).toEqual(["--max-old-space-size=512"]);
    for (const a of args) expect(a).toMatch(/^--[a-z-]+=\d+$/);
  });

  it("a value that somehow bypassed loadConfig is dropped at the boundary", () => {
    // Defence in depth: the spawn boundary re-validates rather than trusting
    // that every caller went through `loadConfig`.
    const args = buildSessionHeapArgs({ maxOldSpaceMb: "lots" as unknown as number });
    expect(args).toEqual([]);
  });

  it("optional fields below the floor are dropped, not emitted", () => {
    const args = buildSessionHeapArgs({ maxOldSpaceMb: 512, initialOldSpaceMb: 16 });
    expect(args).toEqual(["--max-old-space-size=512"]);
  });

  it("valid optional fields are emitted", () => {
    expect(buildSessionHeapArgs({ maxOldSpaceMb: 512, initialOldSpaceMb: 128, maxSemiSpaceMb: 8 }))
      .toEqual([
        "--max-old-space-size=512",
        "--initial-old-space-size=128",
        "--max-semi-space-size=8",
      ]);
  });
});

describe("provenance decision table (test-plan #E13)", () => {
  const OURS = "--max-old-space-size=8192";

  it("marker + matching flag ⇒ stripped", () => {
    const env = stripDashboardHeapFlag({
      NODE_OPTIONS: OURS,
      [HEAP_FLAG_MARKER_ENV]: OURS,
    });
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env[HEAP_FLAG_MARKER_ENV]).toBeUndefined();
  });

  it("marker + a DIFFERENT flag ⇒ the operator's flag survives verbatim", () => {
    const env = stripDashboardHeapFlag({
      NODE_OPTIONS: "--max-old-space-size=2048",
      [HEAP_FLAG_MARKER_ENV]: OURS,
    });
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=2048");
  });

  it("no marker + a flag ⇒ untouched (presence is not provenance)", () => {
    const env = stripDashboardHeapFlag({ NODE_OPTIONS: OURS });
    expect(env.NODE_OPTIONS).toBe(OURS);
  });

  it("neither ⇒ untouched", () => {
    const env = stripDashboardHeapFlag({ PATH: "/usr/bin" });
    expect(env).toEqual({ PATH: "/usr/bin" });
  });
});

describe("operator pins in EITHER spelling survive (review round 1)", () => {
  // V8 accepts `--max_old_space_size=N` (verified: 1024 → 1216 MB limit) and
  // resolves a repeated flag LAST-WINS. A hyphen-only pin detector therefore
  // appends the dashboard's value AFTER an operator's underscore pin and
  // silently defeats it — the exact regression a substring/prefix test invites.
  it.each(["--max-old-space-size=2048", "--max_old_space_size=2048"])(
    "%s is treated as an operator pin and never overridden",
    (pin) => {
      const env = stampHeapFlag<Record<string, string>>({ NODE_OPTIONS: pin }, 1536);
      expect(env.NODE_OPTIONS).toBe(pin);
      expect(env[HEAP_FLAG_MARKER_ENV]).toBeUndefined();
    },
  );

  it("drops OUR stale token when honouring a pin — last-wins would beat the pin", () => {
    const ours = "--max-old-space-size=1536";
    const env = stampHeapFlag(
      { NODE_OPTIONS: `--max_old_space_size=2048 ${ours}`, [HEAP_FLAG_MARKER_ENV]: ours },
      1536,
    );
    expect(env.NODE_OPTIONS).toBe("--max_old_space_size=2048");
    expect(env[HEAP_FLAG_MARKER_ENV]).toBeUndefined();
  });

  it("still re-stamps when only OUR OWN previous token is present", () => {
    const ours = "--max-old-space-size=1536";
    const env = stampHeapFlag({ NODE_OPTIONS: ours, [HEAP_FLAG_MARKER_ENV]: ours }, 4096);
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=4096");
    expect(env[HEAP_FLAG_MARKER_ENV]).toBe("--max-old-space-size=4096");
  });
});

describe("the wrapper and the shared rule stay in lockstep", () => {
  // `packages/server/bin/pi-dashboard.mjs` runs BEFORE jiti and cannot import
  // the shared module, so the pin rule is duplicated there. Duplication is
  // tolerated; DRIFT is not — that is how the hyphen-only bug reached two
  // places at once.
  it("pi-dashboard.mjs carries the canonical pin pattern", () => {
    const wrapper = fs.readFileSync(
      path.join(import.meta.dirname, "..", "..", "bin", "pi-dashboard.mjs"),
      "utf-8",
    );
    expect(wrapper).toContain(`/${MAX_OLD_SPACE_FLAG_PATTERN}/`);
  });

  it("the wrapper's default matches the shared default", () => {
    const wrapper = fs.readFileSync(
      path.join(import.meta.dirname, "..", "..", "bin", "pi-dashboard.mjs"),
      "utf-8",
    );
    expect(wrapper).toContain(
      `const DEFAULT_SERVER_MAX_OLD_SPACE_MB = ${DEFAULT_SERVER_HEAP.maxOldSpaceMb};`,
    );
    expect(wrapper).toContain(`const MIN_HEAP_MB = ${MIN_HEAP_MB};`);
  });

  it("the wrapper names the SAME provenance marker", () => {
    // Drift here does not fail loudly: the wrapper would stamp under one name
    // and the spawn-side strip would look for another, so the server's flag
    // would quietly start leaking into sessions again.
    const wrapper = fs.readFileSync(
      path.join(import.meta.dirname, "..", "..", "bin", "pi-dashboard.mjs"),
      "utf-8",
    );
    expect(wrapper).toContain(`const HEAP_FLAG_MARKER_ENV = "${HEAP_FLAG_MARKER_ENV}";`);
  });
});

describe("the strip is surgical (test-plan #E14)", () => {
  it("removes only the dashboard's token from a multi-flag NODE_OPTIONS", () => {
    const ours = "--max-old-space-size=8192";
    const env = stripDashboardHeapFlag({
      NODE_OPTIONS: `--enable-source-maps ${ours}`,
      [HEAP_FLAG_MARKER_ENV]: ours,
    });
    expect(env.NODE_OPTIONS).toBe("--enable-source-maps");
  });
});

describe("buildSpawnEnv end-to-end strip (test-plan #E15)", () => {
  it("drops the dashboard heap token and nothing else", () => {
    const ours = "--max-old-space-size=8192";
    const env = buildSpawnEnv({
      PATH: "/usr/bin",
      HOME: tmpHome,
      PI_DASHBOARD_URL: "ws://localhost:8001",
      NODE_OPTIONS: `--enable-source-maps ${ours}`,
      [HEAP_FLAG_MARKER_ENV]: ours,
    });
    expect(env.NODE_OPTIONS).toBe("--enable-source-maps");
    expect(env.HOME).toBe(tmpHome);
    expect(env.PI_DASHBOARD_URL).toBe("ws://localhost:8001");
    // PATH is legitimately rewritten (resolver prepends); it must still exist.
    expect(env.PATH).toBeTruthy();
    expect(env[HEAP_FLAG_MARKER_ENV]).toBeUndefined();
  });

  it("leaves an operator-pinned ceiling in the session env", () => {
    const env = buildSpawnEnv({
      PATH: "/usr/bin",
      HOME: tmpHome,
      NODE_OPTIONS: "--max-old-space-size=2048",
    });
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=2048");
  });
});

describe("fallback reporting (test-plan #X4)", () => {
  it("is not reported on the normal argv route", () => {
    applyHeapArgsToPiArgv([NODE, "/abs/cli.js"], HEAP, null, isNodeScript);
    expect(heapFallbackStatus().used).toBe(false);
  });

  it("is reported, with the mechanism, once taken", () => {
    recordHeapArgvFallback("wt", "no runtime slot");
    expect(heapFallbackStatus()).toEqual({
      used: true,
      mechanism: "wt",
      detail: "no runtime slot",
    });
  });
});

// ── Env-borne delivery preserves what it finds (CodeRabbit review) ─────────
// Both env routes (tmux per-window `-e`, the wt fallback) previously either
// OVERWROTE `NODE_OPTIONS` wholesale — discarding unrelated operator options —
// or appended blindly after an operator pin, which V8's last-wins resolution
// turns into an override. One merge now owns both.
describe("mergeHeapIntoNodeOptions", () => {
  const HEAP = "--max-old-space-size=512";

  it("preserves unrelated operator options alongside the ceiling", () => {
    expect(mergeHeapIntoNodeOptions("--enable-source-maps", HEAP)).toBe(
      "--enable-source-maps --max-old-space-size=512",
    );
  });

  it("an operator pin WINS — ours is not appended after it", () => {
    for (const pin of ["--max-old-space-size=2048", "--max_old_space_size=2048"]) {
      expect(mergeHeapIntoNodeOptions(`--enable-source-maps ${pin}`, HEAP)).toBe(
        `--enable-source-maps ${pin}`,
      );
    }
  });

  it("replaces OUR OWN marker-matched token rather than stacking on it", () => {
    const ours = "--max-old-space-size=8192";
    expect(mergeHeapIntoNodeOptions(`--enable-source-maps ${ours}`, HEAP, ours)).toBe(
      "--enable-source-maps --max-old-space-size=512",
    );
  });

  it("returns the surviving options when nothing is configured", () => {
    expect(mergeHeapIntoNodeOptions("--enable-source-maps", "")).toBe("--enable-source-maps");
    expect(mergeHeapIntoNodeOptions(undefined, "")).toBe("");
  });
});

describe("hasNodeShebang rejects a look-alike interpreter", () => {
  // `\bnode\b` accepted `#!/usr/bin/my-node`, and the rewrite would then swap
  // that interpreter for the resolved node binary — a silent behaviour change.
  it.each([
    ["#!/usr/bin/env node", true],
    ["#!/usr/bin/node", true],
    ["#!/usr/bin/env -S node --enable-source-maps", true],
    ["#!/usr/bin/env -S node --enable-source-maps --no-warnings", true],
    ["#!/usr/bin/env NODE_ENV=production node", true],
    ["#!/usr/bin/my-node", false],
    ["#!/usr/bin/env node-wrapper", false],
    ["#!/bin/sh", false],
    // `node` appears, but NOT in the interpreter position — a whole-line regex
    // says yes here and the rewrite then replaces the real interpreter.
    ["#!/bin/sh node", false],
    ["#!/usr/bin/env node-wrapper node", false],
    ["#!/usr/bin/python3 -m nodething", false],
    ["not a shebang", false],
  ])("%s → %s", (line, expected) => {
    expect(hasNodeShebangForTests(line)).toBe(expected);
  });
});
