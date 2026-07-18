import { describe, it, expect } from "vitest";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

describe("memory-session-manager", () => {
  it("registers a session", () => {
    const sm = createMemorySessionManager();
    const session = sm.register({
      id: "s1",
      cwd: "/tmp",
      source: "tui",
      name: "Test",
    });
    expect(session.id).toBe("s1");
    expect(session.status).toBe("active");
    expect(session.name).toBe("Test");
  });

  it("gets session by id", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s1", cwd: "/tmp", source: "tui" });
    expect(sm.get("s1")).toBeDefined();
    expect(sm.get("nonexistent")).toBeUndefined();
  });

  it("unregisters session", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s1", cwd: "/tmp", source: "tui" });
    sm.unregister("s1");
    const s = sm.get("s1");
    expect(s?.status).toBe("ended");
    expect(s?.endedAt).toBeDefined();
  });

  it("updates session", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s1", cwd: "/tmp", source: "tui" });
    sm.update("s1", { tokensIn: 100, model: "test/model" });
    expect(sm.get("s1")?.tokensIn).toBe(100);
    expect(sm.get("s1")?.model).toBe("test/model");
  });

  it("updates hidden state on session object", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s1", cwd: "/tmp", source: "tui" });
    sm.update("s1", { hidden: true });
    expect(sm.get("s1")?.hidden).toBe(true);
  });

  it("listActive excludes ended sessions", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s1", cwd: "/tmp", source: "tui" });
    sm.register({ id: "s2", cwd: "/tmp", source: "tui" });
    sm.unregister("s1");
    expect(sm.listActive()).toHaveLength(1);
    expect(sm.listActive()[0].id).toBe("s2");
  });

  it("listAll includes all sessions", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s1", cwd: "/tmp", source: "tui" });
    sm.register({ id: "s2", cwd: "/tmp", source: "tui" });
    sm.unregister("s1");
    expect(sm.listAll()).toHaveLength(2);
  });

  it("starts empty after creation", () => {
    const sm = createMemorySessionManager();
    expect(sm.listAll()).toHaveLength(0);
  });

  // ── Auto-hide headless non-dashboard sessions at first register ──────────
  // See change: auto-hide-headless-worker-sessions.
  describe("auto-hide at first register", () => {
    it("hides a headless non-dashboard worker by default", () => {
      const sm = createMemorySessionManager();
      const s = sm.register({ id: "w1", cwd: "/tmp", source: "tui", hasUI: false });
      expect(s.hidden).toBe(true);
    });

    it("keeps a TUI session visible", () => {
      const sm = createMemorySessionManager();
      const s = sm.register({ id: "t1", cwd: "/tmp", source: "tui", hasUI: true });
      expect(s.hidden).toBe(false);
    });

    it("keeps a dashboard-spawned headless session visible", () => {
      const sm = createMemorySessionManager();
      const s = sm.register({ id: "d1", cwd: "/tmp", source: "dashboard", hasUI: false });
      expect(s.hidden).toBe(false);
    });

    it("does not auto-hide when hasUI is absent (legacy bridge)", () => {
      const sm = createMemorySessionManager();
      const s = sm.register({ id: "l1", cwd: "/tmp", source: "tui" });
      expect(s.hidden).toBe(false);
    });

    it("honors visibilityIntent 'visible' on a headless session", () => {
      const sm = createMemorySessionManager();
      const s = sm.register({ id: "v1", cwd: "/tmp", source: "tui", hasUI: false, visibilityIntent: "visible" });
      expect(s.hidden).toBe(false);
    });

    it("honors visibilityIntent 'hidden' on a TUI session", () => {
      const sm = createMemorySessionManager();
      const s = sm.register({ id: "h1", cwd: "/tmp", source: "tui", hasUI: true, visibilityIntent: "hidden" });
      expect(s.hidden).toBe(true);
    });
  });

  describe("auto-hide is one-shot; manual state survives re-registration", () => {
    it("preserves a manual unhide across a reattach register", () => {
      const sm = createMemorySessionManager();
      // First register auto-hides the worker.
      sm.register({ id: "w1", cwd: "/tmp", source: "tui", hasUI: false });
      expect(sm.get("w1")?.hidden).toBe(true);
      // User manually unhides.
      sm.update("w1", { hidden: false });
      // Worker reconnects (reattach) — still headless, but manual unhide sticks.
      const re = sm.register({ id: "w1", cwd: "/tmp", source: "tui", hasUI: false, registerReason: "reattach" });
      expect(re.hidden).toBe(false);
    });

    it("preserves a manual hide across a reattach register", () => {
      const sm = createMemorySessionManager();
      sm.register({ id: "t1", cwd: "/tmp", source: "tui", hasUI: true });
      sm.update("t1", { hidden: true });
      const re = sm.register({ id: "t1", cwd: "/tmp", source: "tui", hasUI: true, registerReason: "reattach" });
      expect(re.hidden).toBe(true);
    });

    it("reattach sources hidden from a restored (persisted) record", () => {
      const sm = createMemorySessionManager();
      // Simulate server restart: registry rebuilt from persistence with a
      // manually-unhidden worker. `restore` seeds the record directly.
      sm.restore({
        id: "w1", cwd: "/tmp", source: "tui", status: "ended",
        startedAt: Date.now(), hidden: false, tokensIn: 0, tokensOut: 0, cost: 0,
      } as any);
      // Bridge reattaches after the restart — headless, would otherwise re-hide.
      const re = sm.register({ id: "w1", cwd: "/tmp", source: "tui", hasUI: false, registerReason: "reattach" });
      expect(re.hidden).toBe(false);
    });
  });

  it("onChange receives sessionId", () => {
    const sm = createMemorySessionManager();
    const ids: string[] = [];
    sm.onChange = (sessionId) => ids.push(sessionId);
    sm.register({ id: "s1", cwd: "/tmp", source: "tui" });
    sm.update("s1", { tokensIn: 50 });
    sm.unregister("s1");
    expect(ids).toEqual(["s1", "s1", "s1"]);
  });
});
