/**
 * Tests for the worktree-init hook engine: readInitHook, evaluateGate,
 * runInitHook (script + agent), hookDefHash.
 *
 * See change: generalize-worktree-init-hook.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  readInitHook,
  normalizeHook,
  evaluateGate,
  runInitHook,
  hookDefHash,
  type WorktreeInitHook,
} from "../git-worktree/worktree-init.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wt-init-"));
});
afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
});

function writeSettings(obj: unknown) {
  fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".pi", "settings.json"), JSON.stringify(obj), "utf8");
}

// ── readInitHook ────────────────────────────────────────────────────────────

describe("readInitHook", () => {
  it("returns a script hook when declared", () => {
    writeSettings({ worktreeInit: { gate: "test ! -d node_modules", run: { type: "script", command: "npm ci" } } });
    expect(readInitHook(tmp)).toEqual({
      gate: "test ! -d node_modules",
      run: { type: "script", command: "npm ci" },
    });
  });

  it("returns an agent hook carrying prompt + model", () => {
    writeSettings({ worktreeInit: { gate: "test ! -f .ready", run: { type: "agent", prompt: "set up", model: "claude-sonnet-4" } } });
    expect(readInitHook(tmp)).toEqual({
      gate: "test ! -f .ready",
      run: { type: "agent", prompt: "set up", model: "claude-sonnet-4" },
    });
  });

  it("returns null when no worktreeInit key", () => {
    writeSettings({ packages: [] });
    expect(readInitHook(tmp)).toBeNull();
  });

  it("returns null when settings file is missing", () => {
    expect(readInitHook(tmp)).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".pi", "settings.json"), "{ not json", "utf8");
    expect(readInitHook(tmp)).toBeNull();
  });

  it("rejects unrecognized run shapes (fail-open)", () => {
    expect(normalizeHook({ gate: "x", run: { type: "script" } })).toBeNull();
    expect(normalizeHook({ gate: "x", run: { type: "agent" } })).toBeNull();
    expect(normalizeHook({ gate: "", run: { type: "script", command: "y" } })).toBeNull();
    expect(normalizeHook({ run: { type: "script", command: "y" } })).toBeNull();
    expect(normalizeHook(null)).toBeNull();
  });
});

// ── evaluateGate ──────────────────────────────────────────────────────────

describe("evaluateGate", () => {
  const hook = (gate: string): WorktreeInitHook => ({ gate, run: { type: "script", command: ":" } });

  it("needsInit true when gate exits 0", async () => {
    // node_modules absent in tmp → `test ! -d node_modules` exits 0.
    const res = await evaluateGate(tmp, hook("test ! -d node_modules"));
    expect(res).toEqual({ needsInit: true });
  });

  it("needsInit false when gate exits non-zero", async () => {
    fs.mkdirSync(path.join(tmp, "node_modules"), { recursive: true });
    const res = await evaluateGate(tmp, hook("test ! -d node_modules"));
    expect(res).toEqual({ needsInit: false });
  });

  it("fails closed when the gate cannot be spawned", async () => {
    const res = await evaluateGate(tmp, hook("test ! -d node_modules"), {
      spawnFn: () => { throw new Error("spawn ENOENT"); },
    });
    expect(res).toEqual({ needsInit: false });
  });
});

// ── runInitHook (script) ──────────────────────────────────────────────────

describe("runInitHook script flavor", () => {
  it("ok on success", async () => {
    const hook: WorktreeInitHook = { gate: "false", run: { type: "script", command: "exit 0" } };
    const res = await runInitHook(tmp, hook, () => {});
    expect(res.ok).toBe(true);
    expect(res.ran).toBe(true);
  });

  it("carries stderr tail on failure", async () => {
    const hook: WorktreeInitHook = { gate: "false", run: { type: "script", command: "echo boom 1>&2; exit 3" } };
    const res = await runInitHook(tmp, hook, () => {});
    expect(res.ok).toBe(false);
    expect(res.code).toBe("script_nonzero_exit");
    expect(res.stderr).toContain("boom");
  });

  it("handles a synchronous spawn failure with the stable failure envelope", async () => {
    const hook: WorktreeInitHook = { gate: "false", run: { type: "script", command: ":" } };
    const res = await runInitHook(tmp, hook, () => {}, {
      spawnFn: () => { throw new Error("spawn ENOENT"); },
    });
    expect(res.ok).toBe(false);
    expect(res.ran).toBe(true);
    expect(res.code).toBe("spawn_error");
  });
});

// ── runInitHook (agent) ───────────────────────────────────────────────────

describe("runInitHook agent flavor", () => {
  const agentHook: WorktreeInitHook = { gate: "test ! -f .ready", run: { type: "agent", prompt: "go", model: "m" } };

  it("done when the gate flips after the detached process exits", async () => {
    const res = await runInitHook(tmp, agentHook, () => {}, {
      resolvePiBin: () => "/fake/pi",
      spawnFn: () => fakeChild(0),
      evaluateGateFn: async () => ({ needsInit: false }),
    });
    expect(res.ok).toBe(true);
    expect(res.ran).toBe(true);
  });

  it("failed with log tail when the gate still needs init", async () => {
    fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
    const res = await runInitHook(tmp, agentHook, () => {}, {
      resolvePiBin: () => "/fake/pi",
      spawnFn: () => fakeChild(0),
      evaluateGateFn: async () => ({ needsInit: true }),
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("agent_incomplete");
  });

  it("kills a hung agent after timeoutMs and reports failed", async () => {
    const res = await runInitHook(tmp, agentHook, () => {}, {
      resolvePiBin: () => "/fake/pi",
      spawnFn: () => neverExitsChild(),
      evaluateGateFn: async () => ({ needsInit: true }),
      timeoutMs: 50,
    });
    expect(res.ok).toBe(false);
    expect(res.ran).toBe(true);
    expect(res.code).toBe("agent_failed");
  });

  it("ran:false when the pi binary cannot be resolved", async () => {
    const res = await runInitHook(tmp, agentHook, () => {}, { resolvePiBin: () => null });
    expect(res.ok).toBe(false);
    expect(res.ran).toBe(false);
    expect(res.code).toBe("pi_unresolved");
  });
});

// ── hookDefHash ───────────────────────────────────────────────────────────

describe("hookDefHash", () => {
  it("is stable across key ordering", () => {
    const a: WorktreeInitHook = { gate: "g", run: { type: "script", command: "c" } };
    const b: WorktreeInitHook = { run: { command: "c", type: "script" }, gate: "g" } as WorktreeInitHook;
    expect(hookDefHash(a)).toBe(hookDefHash(b));
  });

  it("changes when any field changes", () => {
    const base: WorktreeInitHook = { gate: "g", run: { type: "script", command: "c" } };
    expect(hookDefHash(base)).not.toBe(hookDefHash({ ...base, gate: "g2" }));
    expect(hookDefHash(base)).not.toBe(hookDefHash({ gate: "g", run: { type: "script", command: "c2" } }));
  });
});

// ── helpers ────────────────────────────────────────────────────────────────

import { EventEmitter } from "node:events";
/** Minimal fake ChildProcess that exits with `code` on next tick. */
function fakeChild(code: number): any {
  const ee: any = new EventEmitter();
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.kill = () => {};
  ee.unref = () => {};
  setImmediate(() => ee.emit("exit", code, null));
  return ee;
}

/** Fake child that never exits on its own; emits exit only when killed. */
function neverExitsChild(): any {
  const ee: any = new EventEmitter();
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.unref = () => {};
  ee.kill = () => { setImmediate(() => ee.emit("exit", null, "SIGTERM")); };
  return ee;
}
