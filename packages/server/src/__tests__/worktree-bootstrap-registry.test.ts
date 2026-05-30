/**
 * Tests for `createWorktreeBootstrapRegistry` — requestId -> ws lookup,
 * TTL expiry, drop-on-close, subscribe-replace semantics.
 *
 * Uses a minimal fake WebSocket (`once` + `readyState` + `send`).
 *
 * See change: harden-worktree-spawn.
 */
import { describe, it, expect, vi } from "vitest";
import { createWorktreeBootstrapRegistry } from "../worktree-bootstrap-registry.js";

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

describe("createWorktreeBootstrapRegistry", () => {
  it("send delivers to subscribed ws", () => {
    const reg = createWorktreeBootstrapRegistry();
    const ws = fakeWs();
    reg.subscribe("req-1", ws);
    const ok = reg.send("req-1", { type: "worktree_bootstrap_done", requestId: "req-1", cwd: "/x", durationMs: 1 });
    expect(ok).toBe(true);
    expect(ws.send).toHaveBeenCalledTimes(1);
  });

  it("send returns false for unknown requestId", () => {
    const reg = createWorktreeBootstrapRegistry();
    const ok = reg.send("nope", { type: "worktree_bootstrap_done", requestId: "nope", cwd: "/x", durationMs: 1 });
    expect(ok).toBe(false);
  });

  it("unsubscribe drops the mapping", () => {
    const reg = createWorktreeBootstrapRegistry();
    const ws = fakeWs();
    reg.subscribe("r", ws);
    reg.unsubscribe("r");
    expect(reg.send("r", { type: "worktree_bootstrap_done", requestId: "r", cwd: "/x", durationMs: 0 })).toBe(false);
  });

  it("subscribe replaces a prior subscription for the same requestId", () => {
    const reg = createWorktreeBootstrapRegistry();
    const wsA = fakeWs(); const wsB = fakeWs();
    reg.subscribe("r", wsA);
    reg.subscribe("r", wsB);
    reg.send("r", { type: "worktree_bootstrap_done", requestId: "r", cwd: "/x", durationMs: 0 });
    expect(wsA.send).not.toHaveBeenCalled();
    expect(wsB.send).toHaveBeenCalledTimes(1);
  });

  it("drops all subscriptions held by a ws on close", () => {
    const reg = createWorktreeBootstrapRegistry();
    const ws = fakeWs();
    reg.subscribe("a", ws);
    reg.subscribe("b", ws);
    expect(reg.size()).toBe(2);
    ws._emit("close");
    expect(reg.size()).toBe(0);
  });

  it("TTL expires the subscription", async () => {
    const reg = createWorktreeBootstrapRegistry({ ttlMs: 5 });
    const ws = fakeWs();
    reg.subscribe("r", ws);
    await new Promise((r) => setTimeout(r, 20));
    expect(reg.size()).toBe(0);
  });

  it("dispose() clears all entries", () => {
    const reg = createWorktreeBootstrapRegistry();
    reg.subscribe("a", fakeWs());
    reg.subscribe("b", fakeWs());
    reg.dispose();
    expect(reg.size()).toBe(0);
  });
});
