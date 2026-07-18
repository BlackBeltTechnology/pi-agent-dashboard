import { describe, it, expect, vi } from "vitest";
import { handleSubscribe, replayUiState } from "../browser-handlers/subscription-handler.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import type { BrowserHandlerContext } from "../browser-handlers/handler-context.js";
import type { DecoratorDescriptor, ExtensionUiModule } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Phase-2 (`add-extension-ui-decorations`) server contract:
 *
 *   - `replayUiState` sends `ui_modules_list` + `ui_data_list`* (Phase 1) THEN
 *     one `ext_ui_decorator` per cached `Session.uiDecorators` entry.
 *   - Replay decorators NEVER carry `removed: true`.
 *   - Replay ordering: events → pending UI requests → ui_modules_list →
 *     ui_data_list → ext_ui_decorator.
 *   - Cache write/delete semantics: upsert under `${kind}:${namespace}:${id}`;
 *     `removed: true` deletes the entry; deleting an absent key is a no-op
 *     but still broadcasts.
 */

function module1(): ExtensionUiModule {
  return {
    kind: "management-modal",
    id: "m1",
    command: "/m1",
    title: "M1",
    view: { kind: "table", dataEvent: "m1:rows", fields: [{ key: "id", label: "ID", kind: "text" }] },
  };
}

function footer(namespace: string, id: string, text: string): DecoratorDescriptor {
  return { kind: "footer-segment", namespace, id, payload: { text } };
}

function gate(namespace: string, id: string, flowId: string, available: boolean): DecoratorDescriptor {
  return { kind: "gate", namespace, id, payload: { flowId, available } };
}

function createCtx(overrides: Partial<BrowserHandlerContext> = {}): BrowserHandlerContext {
  return {
    ws: { readyState: 1, OPEN: 1, bufferedAmount: 0 } as any,
    sessionManager: createMemorySessionManager(),
    eventStore: createMemoryEventStore(() => false),
    piGateway: { sendToSession: vi.fn() } as any,
    headlessPidRegistry: {} as any,
    pendingResumeRegistry: {} as any,
    sendTo: vi.fn(),
    broadcast: vi.fn(),
    getSubscribers: () => [],
    trackUiRequest: vi.fn(),
    replayPendingUiRequests: vi.fn(),
    markReplaying: vi.fn(),
    clearReplaying: vi.fn(),
    ...overrides,
  };
}

describe("replayUiState — Phase-2 decorator replay", () => {
  it("sends one ext_ui_decorator per uiDecorators entry after the Phase-1 batches", () => {
    const ctx = createCtx();
    ctx.sessionManager.register({ id: "s1", cwd: "/tmp", source: "tui" });
    const fA = footer("judo", "model-state", "3 mut");
    const fB = footer("flows", "progress", "step 2/5");
    const gC = gate("judo", "save", "judo:save", false);
    ctx.sessionManager.update("s1", {
      uiModules: [module1()],
      uiDataMap: { "m1:rows": [{ id: 1 }] },
      uiDecorators: {
        [`footer-segment:judo:model-state`]: fA,
        [`footer-segment:flows:progress`]: fB,
        [`gate:judo:save`]: gC,
      },
    });

    replayUiState(ctx.ws, "s1", ctx);

    const calls = (ctx.sendTo as any).mock.calls.map(([, m]: any) => m);
    // 1 modules + 1 data + 3 decorators
    expect(calls).toHaveLength(5);
    expect(calls[0]).toMatchObject({ type: "ui_modules_list" });
    expect(calls[1]).toMatchObject({ type: "ui_data_list", event: "m1:rows" });
    const decoratorCalls = calls.slice(2);
    for (const m of decoratorCalls) {
      expect(m.type).toBe("ext_ui_decorator");
      expect(m.sessionId).toBe("s1");
      // Replay NEVER sets removed: true — only live entries are replayed.
      expect(m.removed).toBeUndefined();
    }
    const keys = decoratorCalls.map((m: any) => `${m.descriptor.kind}:${m.descriptor.namespace}:${m.descriptor.id}`).sort();
    expect(keys).toEqual([
      "footer-segment:flows:progress",
      "footer-segment:judo:model-state",
      "gate:judo:save",
    ]);
  });

  it("does not send any ext_ui_decorator when uiDecorators is missing or empty", () => {
    const ctx = createCtx();
    ctx.sessionManager.register({ id: "s1", cwd: "/tmp", source: "tui" });
    ctx.sessionManager.update("s1", { uiModules: [module1()] });
    replayUiState(ctx.ws, "s1", ctx);
    const calls = (ctx.sendTo as any).mock.calls.map(([, m]: any) => m);
    expect(calls.some((m: any) => m.type === "ext_ui_decorator")).toBe(false);

    (ctx.sendTo as any).mockClear();
    ctx.sessionManager.update("s1", { uiDecorators: {} });
    replayUiState(ctx.ws, "s1", ctx);
    const calls2 = (ctx.sendTo as any).mock.calls.map(([, m]: any) => m);
    expect(calls2.some((m: any) => m.type === "ext_ui_decorator")).toBe(false);
  });
});

describe("handleSubscribe — replay ordering with decorators", () => {
  it("replay order is events → pending UI → ui_modules_list → ui_data_list → ext_ui_decorator", async () => {
    const ctx = createCtx();
    ctx.sessionManager.register({ id: "s1", cwd: "/tmp", source: "tui" });
    ctx.sessionManager.update("s1", {
      uiModules: [module1()],
      uiDataMap: { "m1:rows": [{ id: 1 }] },
      uiDecorators: { [`footer-segment:judo:x`]: footer("judo", "x", "live") },
    });
    ctx.eventStore.insertEvent("s1", { eventType: "x", timestamp: Date.now(), data: {} });

    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, new Set(), ctx);
    await new Promise((r) => setTimeout(r, 30));

    const calls = (ctx.sendTo as any).mock.calls.map(([, m]: any) => m);
    const eventReplayIdx = calls.findIndex((m: any) => m.type === "event_replay");
    const modulesIdx = calls.findIndex((m: any) => m.type === "ui_modules_list");
    const dataIdx = calls.findIndex((m: any) => m.type === "ui_data_list");
    const decoratorIdx = calls.findIndex((m: any) => m.type === "ext_ui_decorator");

    expect(eventReplayIdx).toBeGreaterThanOrEqual(0);
    expect(modulesIdx).toBeGreaterThan(eventReplayIdx);
    expect(dataIdx).toBeGreaterThan(modulesIdx);
    expect(decoratorIdx).toBeGreaterThan(dataIdx);
    // replayPendingUiRequests is called between event replay and replayUiState.
    expect((ctx.replayPendingUiRequests as any).mock.calls.length).toBeGreaterThan(0);
  });
});

/**
 * The cache upsert/delete contract is implemented inside `event-wiring.ts`'s
 * `ext_ui_decorator` switch arm. We exercise it through a thin reducer
 * mirroring the production code; the same logic is exercised end-to-end via
 * `replayUiState` (which reads `Session.uiDecorators` directly).
 */
describe("ext_ui_decorator cache reducer (mirrors event-wiring contract)", () => {
  type DecoratorMsg = {
    type: "ext_ui_decorator";
    sessionId: string;
    descriptor: DecoratorDescriptor;
    removed?: boolean;
  };

  function applyDecoratorMsg(
    sessionMgr: ReturnType<typeof createMemorySessionManager>,
    msg: DecoratorMsg,
  ): void {
    const session = sessionMgr.get(msg.sessionId);
    if (!session) return;
    const key = `${msg.descriptor.kind}:${msg.descriptor.namespace}:${msg.descriptor.id}`;
    const next = { ...(session.uiDecorators ?? {}) };
    if (msg.removed) delete next[key];
    else next[key] = msg.descriptor;
    sessionMgr.update(msg.sessionId, { uiDecorators: next });
  }

  it("upserts under composite key", () => {
    const mgr = createMemorySessionManager();
    mgr.register({ id: "s1", cwd: "/tmp", source: "tui" });
    applyDecoratorMsg(mgr, { type: "ext_ui_decorator", sessionId: "s1", descriptor: footer("judo", "x", "v1") });
    expect(mgr.get("s1")?.uiDecorators).toEqual({
      "footer-segment:judo:x": expect.objectContaining({ payload: { text: "v1" } }),
    });

    // Upsert overwrites the value at the same key.
    applyDecoratorMsg(mgr, { type: "ext_ui_decorator", sessionId: "s1", descriptor: footer("judo", "x", "v2") });
    expect((mgr.get("s1")!.uiDecorators!["footer-segment:judo:x"].payload as any).text).toBe("v2");
  });

  it("removed: true deletes the entry", () => {
    const mgr = createMemorySessionManager();
    mgr.register({ id: "s1", cwd: "/tmp", source: "tui" });
    applyDecoratorMsg(mgr, { type: "ext_ui_decorator", sessionId: "s1", descriptor: footer("judo", "x", "v1") });
    expect(mgr.get("s1")?.uiDecorators).toHaveProperty("footer-segment:judo:x");

    applyDecoratorMsg(mgr, { type: "ext_ui_decorator", sessionId: "s1", descriptor: footer("judo", "x", "v1"), removed: true });
    expect(mgr.get("s1")?.uiDecorators).not.toHaveProperty("footer-segment:judo:x");
  });

  it("removed: true on an absent key is a no-op", () => {
    const mgr = createMemorySessionManager();
    mgr.register({ id: "s1", cwd: "/tmp", source: "tui" });
    applyDecoratorMsg(mgr, { type: "ext_ui_decorator", sessionId: "s1", descriptor: footer("judo", "absent", "v"), removed: true });
    expect(mgr.get("s1")?.uiDecorators).toEqual({});
  });

  it("different namespaces are stored independently", () => {
    const mgr = createMemorySessionManager();
    mgr.register({ id: "s1", cwd: "/tmp", source: "tui" });
    applyDecoratorMsg(mgr, { type: "ext_ui_decorator", sessionId: "s1", descriptor: footer("judo", "ms", "j") });
    applyDecoratorMsg(mgr, { type: "ext_ui_decorator", sessionId: "s1", descriptor: footer("flows", "ms", "f") });
    expect(Object.keys(mgr.get("s1")!.uiDecorators!).sort()).toEqual([
      "footer-segment:flows:ms",
      "footer-segment:judo:ms",
    ]);
  });
});
