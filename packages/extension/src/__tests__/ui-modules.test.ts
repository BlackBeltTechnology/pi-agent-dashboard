import { describe, it, expect, vi, beforeEach } from "vitest";
import { refreshUiModules, subscribeUiInvalidate, handleUiManagement, type UiModulesBridgeCtx } from "../ui-modules.js";
import type { ExtensionUiModule } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Minimal bus + ctx harness. The real bridge wires this up via `pi.events`
 * (a real `EventEmitter`); the contract this module relies on is `on` /
 * `emit`, so a hand-rolled bus is sufficient for tests.
 */
function createTestCtx(sessionId = "s1") {
  const listeners = new Map<string, Array<(...args: any[]) => any>>();
  const sent: any[] = [];

  const ctx: UiModulesBridgeCtx & { _sent: any[]; _listeners: typeof listeners } = {
    pi: {
      events: {
        on: vi.fn((event: string, fn: (...args: any[]) => any) => {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event)!.push(fn);
        }) as any,
        emit: vi.fn((event: string, ...args: any[]) => {
          const handlers = listeners.get(event) ?? [];
          for (const h of handlers) h(...args);
        }) as any,
      },
    },
    connection: {
      send: vi.fn((msg: unknown) => {
        sent.push(msg);
      }) as any,
    },
    getSessionId: () => sessionId,
    _sent: sent,
    _listeners: listeners,
  };
  return ctx;
}

const sampleModule = (id: string, command: string): ExtensionUiModule => ({
  kind: "management-modal",
  id,
  command,
  title: id,
  view: { kind: "table", dataEvent: `${id}:rows`, fields: [{ key: "id", label: "ID", kind: "text" }] },
});

describe("refreshUiModules", () => {
  it("emits ui:list-modules and forwards collected modules as ui_modules_list", () => {
    const ctx = createTestCtx("session-A");
    ctx._listeners.set("ui:list-modules", [
      (probe: { modules: ExtensionUiModule[] }) => {
        probe.modules.push(sampleModule("judo-status", "/judo:status"));
        probe.modules.push(sampleModule("ragger-workspaces", "/ragger:workspaces"));
      },
    ]);

    refreshUiModules(ctx);

    expect(ctx.pi.events!.emit).toHaveBeenCalledWith("ui:list-modules", expect.any(Object));
    expect(ctx._sent).toHaveLength(1);
    expect(ctx._sent[0]).toMatchObject({
      type: "ui_modules_list",
      sessionId: "session-A",
      modules: [
        expect.objectContaining({ id: "judo-status", command: "/judo:status" }),
        expect.objectContaining({ id: "ragger-workspaces", command: "/ragger:workspaces" }),
      ],
    });
  });

  it("forwards an empty modules list when no listeners push", () => {
    const ctx = createTestCtx();
    refreshUiModules(ctx);
    expect(ctx._sent).toEqual([{ type: "ui_modules_list", sessionId: "s1", modules: [] }]);
  });

  it("last-write-wins on duplicate id and warns once per collision", () => {
    const ctx = createTestCtx();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      ctx._listeners.set("ui:list-modules", [
        (probe: { modules: ExtensionUiModule[] }) => {
          // First push wins on insertion order; second push for same id replaces it.
          const a: ExtensionUiModule = { ...sampleModule("dup", "/a"), title: "First" };
          const b: ExtensionUiModule = { ...sampleModule("dup", "/b"), title: "Second" };
          const c: ExtensionUiModule = { ...sampleModule("dup", "/c"), title: "Third" };
          probe.modules.push(a, b, c);
        },
      ]);

      refreshUiModules(ctx);

      const sent = ctx._sent[0] as { modules: ExtensionUiModule[] };
      expect(sent.modules).toHaveLength(1);
      expect(sent.modules[0]).toMatchObject({ id: "dup", title: "Third", command: "/c" });
      // Two collisions reported, but only one warning per id.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/duplicate module id "dup"/);
    } finally {
      warn.mockRestore();
    }
  });

  it("ignores modules with missing/empty id", () => {
    const ctx = createTestCtx();
    ctx._listeners.set("ui:list-modules", [
      (probe: { modules: any[] }) => {
        probe.modules.push({ kind: "management-modal", id: "", command: "/x", title: "x", view: { kind: "table" } });
        probe.modules.push({ kind: "management-modal", command: "/y", title: "y", view: { kind: "table" } });
        probe.modules.push(sampleModule("ok", "/ok"));
      },
    ]);

    refreshUiModules(ctx);
    const sent = ctx._sent[0] as { modules: ExtensionUiModule[] };
    expect(sent.modules.map((m) => m.id)).toEqual(["ok"]);
  });

  it("does not throw or send when pi.events is missing", () => {
    const ctx = createTestCtx();
    ctx.pi = { events: undefined as any };
    expect(() => refreshUiModules(ctx)).not.toThrow();
    expect(ctx._sent).toHaveLength(0);
  });

  it("absorbs handler errors without breaking the bridge", () => {
    const ctx = createTestCtx();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      ctx._listeners.set("ui:list-modules", [
        () => {
          throw new Error("listener exploded");
        },
      ]);
      expect(() => refreshUiModules(ctx)).not.toThrow();
      expect(errSpy).toHaveBeenCalled();
      expect(ctx._sent).toHaveLength(0);
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("subscribeUiInvalidate", () => {
  it("re-runs the probe whenever ui:invalidate fires (leading + trailing throttle, see Phase 2)", () => {
    vi.useFakeTimers();
    try {
      const ctx = createTestCtx();
      ctx._listeners.set("ui:list-modules", [
        (probe: { modules: ExtensionUiModule[] }) => {
          probe.modules.push(sampleModule("a", "/a"));
        },
      ]);

      subscribeUiInvalidate(ctx);
      // First emit triggers a leading-edge probe immediately.
      ctx.pi.events!.emit("ui:invalidate", { id: "a" });
      expect(ctx._sent).toHaveLength(1);
      expect((ctx._sent[0] as any).type).toBe("ui_modules_list");

      // Second emit within the throttle window coalesces into a trailing-edge
      // probe; advance timers past the 50ms window to flush it.
      ctx.pi.events!.emit("ui:invalidate", {});
      vi.advanceTimersByTime(100);
      expect(ctx._sent).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is a no-op when pi.events.on is missing", () => {
    const ctx = createTestCtx();
    ctx.pi = { events: { emit: vi.fn() as any } as any };
    expect(() => subscribeUiInvalidate(ctx)).not.toThrow();
  });
});

describe("handleUiManagement", () => {
  it("re-emits the event on pi.events with action and _reply injected, and forwards synchronous data.items", () => {
    const ctx = createTestCtx("S");
    ctx._listeners.set("judo:status-rows", [
      (data: { action: string; items?: unknown[] }) => {
        expect(data.action).toBe("list");
        data.items = [{ id: 1 }, { id: 2 }];
      },
    ]);

    handleUiManagement(ctx, {
      type: "ui_management",
      sessionId: "S",
      action: "list",
      event: "judo:status-rows",
    });

    expect(ctx.pi.events!.emit).toHaveBeenCalledWith("judo:status-rows", expect.any(Object));
    expect(ctx._sent).toEqual([
      { type: "ui_data_list", sessionId: "S", event: "judo:status-rows", items: [{ id: 1 }, { id: 2 }] },
    ]);
  });

  it("supports async _reply path (extension calls _reply asynchronously)", () => {
    const ctx = createTestCtx();
    ctx._listeners.set("judo:rows", [
      (data: { _reply: (items: unknown[]) => void }) => {
        // Simulate async: call _reply later in this tick.
        setTimeout(() => data._reply([{ id: 7 }]), 0);
      },
    ]);

    handleUiManagement(ctx, { type: "ui_management", sessionId: "s1", action: "list", event: "judo:rows" });
    // Synchronous fast-path didn't fire because data.items wasn't set.
    expect(ctx._sent).toHaveLength(0);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(ctx._sent).toEqual([
          { type: "ui_data_list", sessionId: "s1", event: "judo:rows", items: [{ id: 7 }] },
        ]);
        resolve();
      }, 5);
    });
  });

  it("does not double-send if both data.items is set and _reply is called", () => {
    const ctx = createTestCtx();
    ctx._listeners.set("e", [
      (data: { _reply: (items: unknown[]) => void; items?: unknown[] }) => {
        data._reply([1, 2]);
        data.items = [3, 4];
      },
    ]);
    handleUiManagement(ctx, { type: "ui_management", sessionId: "s1", action: "list", event: "e" });
    // _reply ran synchronously inside the emit; data.items fast-path is gated by `replied`.
    expect(ctx._sent).toHaveLength(1);
    expect((ctx._sent[0] as any).items).toEqual([1, 2]);
  });

  it("does NOT send a ui_data_list for fire-and-forget actions (no items, no _reply)", () => {
    const ctx = createTestCtx();
    ctx._listeners.set("judo:delete-row", [() => { /* side-effect only */ }]);
    handleUiManagement(ctx, {
      type: "ui_management",
      sessionId: "s1",
      action: "delete",
      event: "judo:delete-row",
      params: { id: 42 },
    });
    expect(ctx._sent).toHaveLength(0);
  });

  it("forwards the action and params verbatim to listeners", () => {
    const ctx = createTestCtx();
    let captured: any = null;
    ctx._listeners.set("e", [(data: any) => { captured = { ...data }; }]);
    handleUiManagement(ctx, {
      type: "ui_management",
      sessionId: "s1",
      action: "delete",
      event: "e",
      params: { id: 42, force: true },
    });
    expect(captured).toMatchObject({ action: "delete", id: 42, force: true });
    expect(typeof captured._reply).toBe("function");
  });

  it("absorbs handler errors without sending data", () => {
    const ctx = createTestCtx();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      ctx._listeners.set("explode", [() => { throw new Error("boom"); }]);
      expect(() => handleUiManagement(ctx, { type: "ui_management", sessionId: "s1", action: "list", event: "explode" })).not.toThrow();
      expect(errSpy).toHaveBeenCalled();
      expect(ctx._sent).toHaveLength(0);
    } finally {
      errSpy.mockRestore();
    }
  });
});
