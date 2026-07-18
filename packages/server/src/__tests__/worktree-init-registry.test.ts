/**
 * Tests for `createWorktreeInitRegistry` — requestId -> ws lookup,
 * TTL expiry, drop-on-close, subscribe-replace semantics.
 *
 * Uses a minimal fake WebSocket (`once` + `readyState` + `send`).
 *
 * See change: generalize-worktree-init-hook.
 */
import { describe, it, expect, vi } from "vitest";
import { createWorktreeInitRegistry } from "../git-worktree/worktree-init-registry.js";

type Listener = (...args: unknown[]) => void;

function fakeWs() {
  const listeners = new Map<string, Listener[]>();
  return {
    readyState: 1,
    OPEN: 1,
    send: vi.fn(),
    once(ev: string, cb: Listener) {
      const list = listeners.get(ev) ?? [];
      list.push(cb);
      listeners.set(ev, list);
    },
    _emit(ev: string) {
      const list = listeners.get(ev) ?? [];
      for (const cb of list) cb();
      listeners.delete(ev);
    },
  } as any;
}

describe("createWorktreeInitRegistry", () => {
  it("send delivers to subscribed ws", () => {
    const reg = createWorktreeInitRegistry();
    const ws = fakeWs();
    reg.subscribe("req-1", ws);
    const ok = reg.send("req-1", { type: "worktree_init_done", requestId: "req-1", cwd: "/x", durationMs: 1 });
    expect(ok).toBe(true);
    expect(ws.send).toHaveBeenCalledTimes(1);
  });

  it("send returns false for unknown requestId", () => {
    const reg = createWorktreeInitRegistry();
    const ok = reg.send("nope", { type: "worktree_init_done", requestId: "nope", cwd: "/x", durationMs: 1 });
    expect(ok).toBe(false);
  });

  it("unsubscribe drops the mapping", () => {
    const reg = createWorktreeInitRegistry();
    const ws = fakeWs();
    reg.subscribe("r", ws);
    reg.unsubscribe("r");
    expect(reg.send("r", { type: "worktree_init_done", requestId: "r", cwd: "/x", durationMs: 0 })).toBe(false);
  });

  it("subscribe replaces a prior subscription for the same requestId", () => {
    const reg = createWorktreeInitRegistry();
    const wsA = fakeWs(); const wsB = fakeWs();
    reg.subscribe("r", wsA);
    reg.subscribe("r", wsB);
    reg.send("r", { type: "worktree_init_done", requestId: "r", cwd: "/x", durationMs: 0 });
    expect(wsA.send).not.toHaveBeenCalled();
    expect(wsB.send).toHaveBeenCalledTimes(1);
  });

  it("drops all subscriptions held by a ws on close", () => {
    const reg = createWorktreeInitRegistry();
    const ws = fakeWs();
    reg.subscribe("a", ws);
    reg.subscribe("b", ws);
    expect(reg.size()).toBe(2);
    ws._emit("close");
    expect(reg.size()).toBe(0);
  });

  it("TTL expires the subscription", async () => {
    const reg = createWorktreeInitRegistry({ ttlMs: 5 });
    const ws = fakeWs();
    reg.subscribe("r", ws);
    await new Promise((r) => setTimeout(r, 20));
    expect(reg.size()).toBe(0);
  });

  it("dispose() clears all entries", () => {
    const reg = createWorktreeInitRegistry();
    reg.subscribe("a", fakeWs());
    reg.subscribe("b", fakeWs());
    reg.dispose();
    expect(reg.size()).toBe(0);
  });
});

describe("cwd-keyed run tracking", () => {
  it("registers a running entry on start", () => {
    const reg = createWorktreeInitRegistry();
    reg.startRun("/x", 1000);
    const runs = reg.getActiveRuns();
    expect(runs).toEqual([{ cwd: "/x", phase: "running", startedAt: 1000 }]);
  });

  it("progress updates lastLine on the running entry", () => {
    const reg = createWorktreeInitRegistry();
    reg.startRun("/x");
    reg.progressRun("/x", "installing…", "full\nlog\ntail");
    expect(reg.getActiveRuns()[0]?.lastLine).toBe("installing…");
  });

  it("done sets terminal phase and retains within TTL", () => {
    const reg = createWorktreeInitRegistry();
    reg.startRun("/x");
    reg.finishRun("/x", "done");
    expect(reg.getActiveRuns()).toEqual([
      expect.objectContaining({ cwd: "/x", phase: "done" }),
    ]);
  });

  it("failed sets code and terminal phase", () => {
    const reg = createWorktreeInitRegistry();
    reg.startRun("/x");
    reg.finishRun("/x", "failed", "script_nonzero_exit");
    expect(reg.getActiveRuns()[0]).toEqual(
      expect.objectContaining({ cwd: "/x", phase: "failed", code: "script_nonzero_exit" }),
    );
  });

  it("evicts expired terminal entries on read", async () => {
    const reg = createWorktreeInitRegistry({ terminalTtlMs: 5 });
    reg.startRun("/x");
    reg.finishRun("/x", "done");
    await new Promise((r) => setTimeout(r, 20));
    expect(reg.getActiveRuns()).toEqual([]);
  });

  it("single run per cwd — start replaces prior state", () => {
    const reg = createWorktreeInitRegistry();
    reg.startRun("/x", 1);
    reg.startRun("/x", 2);
    const runs = reg.getActiveRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.startedAt).toBe(2);
  });
});

describe("cwd-keyed fan-out", () => {
  it("sendCwd fans out to every subscriber", () => {
    const reg = createWorktreeInitRegistry();
    const a = fakeWs(); const b = fakeWs();
    reg.subscribeCwd("/x", a);
    reg.subscribeCwd("/x", b);
    const n = reg.sendCwd("/x", { type: "worktree_init_done", requestId: "", cwd: "/x", durationMs: 0 });
    expect(n).toBe(2);
    expect(a.send).toHaveBeenCalledTimes(1);
    expect(b.send).toHaveBeenCalledTimes(1);
  });

  it("sendCwd returns 0 for an unknown cwd", () => {
    const reg = createWorktreeInitRegistry();
    expect(reg.sendCwd("/nope", { type: "worktree_init_done", requestId: "", cwd: "/nope", durationMs: 0 })).toBe(0);
  });

  it("drops cwd subscriptions on ws close", () => {
    const reg = createWorktreeInitRegistry();
    const ws = fakeWs();
    reg.subscribeCwd("/x", ws);
    ws._emit("close");
    expect(reg.sendCwd("/x", { type: "worktree_init_done", requestId: "", cwd: "/x", durationMs: 0 })).toBe(0);
  });

  it("unsubscribeCwd removes a single subscriber", () => {
    const reg = createWorktreeInitRegistry();
    const a = fakeWs(); const b = fakeWs();
    reg.subscribeCwd("/x", a);
    reg.subscribeCwd("/x", b);
    reg.unsubscribeCwd("/x", a);
    expect(reg.sendCwd("/x", { type: "worktree_init_done", requestId: "", cwd: "/x", durationMs: 0 })).toBe(1);
  });
});
