import { describe, it, expect } from "vitest";
import {
  classifyProcesses,
  buildPidIndex,
  type RawProcessEntry,
  type PidIndex,
} from "../spawn-process/process-classifier.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function raw(partial: Partial<RawProcessEntry> & { pid: number; command: string }): RawProcessEntry {
  return { pgid: partial.pid, elapsedMs: 60_000, ...partial };
}

function session(partial: Partial<DashboardSession> & { id: string }): DashboardSession {
  return {
    cwd: "/tmp",
    source: "pi",
    status: "active",
    startedAt: 0,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...partial,
  } as DashboardSession;
}

describe("buildPidIndex", () => {
  it("indexes connected sessions with a pid", () => {
    const idx = buildPidIndex([
      session({ id: "a", pid: 100, name: "build", model: "sonnet" }),
      session({ id: "b", pid: 200 }),
    ]);
    expect(idx.get(100)).toEqual({ sessionId: "a", name: "build", model: "sonnet" });
    expect(idx.get(200)?.sessionId).toBe("b");
  });

  it("excludes ended sessions (pid-reuse guard)", () => {
    const idx = buildPidIndex([
      session({ id: "dead", pid: 100, status: "ended" }),
      session({ id: "live", pid: 200 }),
    ]);
    expect(idx.has(100)).toBe(false);
    expect(idx.has(200)).toBe(true);
  });

  it("skips sessions without a pid", () => {
    const idx = buildPidIndex([session({ id: "a" })]);
    expect(idx.size).toBe(0);
  });
});

describe("classifyProcesses", () => {
  const empty: PidIndex = new Map();

  it("classifies a pi pid in the index as sub-session with name + ref", () => {
    const idx = buildPidIndex([session({ id: "sess-1", pid: 100, name: "build worker", model: "sonnet" })]);
    const [out] = classifyProcesses([raw({ pid: 100, command: "pi" })], idx);
    expect(out.kind).toBe("sub-session");
    expect(out.label).toBe("build worker");
    expect(out.sessionRef).toBe("sess-1");
  });

  it("falls back to model when sub-session is unnamed", () => {
    const idx = buildPidIndex([session({ id: "sess-1", pid: 100, model: "haiku" })]);
    const [out] = classifyProcesses([raw({ pid: 100, command: "pi" })], idx);
    expect(out.label).toBe("haiku");
  });

  it("classifies a pi pid NOT in the index as pi-worker", () => {
    const [out] = classifyProcesses([raw({ pid: 999, command: "pi" })], empty);
    expect(out.kind).toBe("pi-worker");
    expect(out.label).toBe("pi worker");
    expect(out.sessionRef).toBeUndefined();
  });

  it("classifies a plugin sidecar from its path", () => {
    const cmd = "bun /Users/x/.pi/agent/npm/node_modules/context-mode/server.bundle.mjs";
    const [out] = classifyProcesses([raw({ pid: 41431, command: cmd })], empty);
    expect(out.kind).toBe("plugin");
    expect(out.label).toBe("context-mode");
  });

  it("classifies anything else as a task labelled by command", () => {
    const [out] = classifyProcesses([raw({ pid: 10010, command: "node vite --watch" })], empty);
    expect(out.kind).toBe("task");
    expect(out.label).toBe("node vite --watch");
  });

  it("preserves pid/pgid/command/elapsedMs unchanged", () => {
    const entry = raw({ pid: 5, pgid: 7, command: "node x", elapsedMs: 123 });
    const [out] = classifyProcesses([entry], empty);
    expect(out.pid).toBe(5);
    expect(out.pgid).toBe(7);
    expect(out.command).toBe("node x");
    expect(out.elapsedMs).toBe(123);
  });

  it("does not link a pi pid that maps only to a dead (unindexed) session", () => {
    const idx = buildPidIndex([session({ id: "dead", pid: 100, name: "old", status: "ended" })]);
    const [out] = classifyProcesses([raw({ pid: 100, command: "pi" })], idx);
    expect(out.kind).toBe("pi-worker");
    expect(out.sessionRef).toBeUndefined();
  });
});
