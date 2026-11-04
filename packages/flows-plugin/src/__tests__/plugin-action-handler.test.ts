/**
 * flows-plugin plugin_action handler — the production wiring that replaced the
 * v1 logging stub. `flow.run` emits the `flow:run` event pi-flows consumes;
 * `flow.new` launches the manage-flows skill; a missing sessionId is a guarded
 * no-op. See change: fix-plugin-action-fanout-and-handlers.
 */
import { describe, expect, it, vi } from "vitest";
import { registerPlugin } from "../server/index.js";

type Handler = (msg: unknown) => void;

async function setup() {
  const emitEventToSession = vi.fn(() => true);
  const sendToSession = vi.fn(() => true);
  let handler: Handler | undefined;
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    broadcastToSubscribers: vi.fn(),
    emitEventToSession,
    sendToSession,
    provide: vi.fn(),
    consume: vi.fn(),
    sessionManager: { listActive: () => [], listAll: () => [] },
    // `register` runs encapsulated-scope callbacks against the same fake
    // (rate-limited flow-file routes; see change: attach-flow-before-run).
    fastify: (() => {
      const f: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; register: (fn: unknown, opts?: unknown) => Promise<void> } = {
        get: vi.fn(),
        put: vi.fn(),
        post: vi.fn(),
        // Scope callbacks (no options) run; option-bearing plugin
        // registrations (e.g. @fastify/rate-limit) are no-ops here.
        register: async (fn, opts) => {
          if (typeof fn === "function" && opts === undefined) await fn(f);
        },
      };
      return f;
    })(),
    getPluginConfig: () => ({}),
    onEvent: () => () => {},
    onSessionEnded: () => () => {},
    updatePluginConfig: vi.fn(async () => {}),
    registerBrowserHandler: (type: string, h: Handler) => {
      if (type === "plugin_action") handler = h;
    },
  } as unknown as Parameters<typeof registerPlugin>[0];

  await registerPlugin(ctx);
  if (!handler) throw new Error("plugin_action handler not registered");
  return { handler, emitEventToSession, sendToSession, ctx };
}

describe("flows plugin_action handler", () => {
  it("flow.run emits flow:run into the target session (not a stub)", async () => {
    const { handler, emitEventToSession } = await setup();
    handler({ pluginId: "flows", sessionId: "s1", action: "flow.run", payload: { flow: "ns:build", task: "do it" } });
    expect(emitEventToSession).toHaveBeenCalledWith("s1", "flow:run", { flowName: "ns:build", task: "do it" });
  });

  it("flow.request-catalog asks the session to report (rediscover passed through)", async () => {
    const { handler, emitEventToSession } = await setup();
    handler({ pluginId: "flows", sessionId: "s1", action: "flow.request-catalog", payload: { rediscover: true } });
    expect(emitEventToSession).toHaveBeenCalledWith("s1", "dashboard-flows:report-files", { rediscover: true });
  });

  it("flow.new launches the manage-flows skill via sendToSession", async () => {
    const { handler, sendToSession } = await setup();
    handler({ pluginId: "flows", sessionId: "s1", action: "flow.new" });
    expect(sendToSession).toHaveBeenCalledWith("s1", "/skill:manage-flows");
  });

  it("ignores a mismatched pluginId (defense-in-depth) and guards missing sessionId", async () => {
    const { handler, emitEventToSession } = await setup();
    handler({ pluginId: "goal", sessionId: "s1", action: "flow.run", payload: { flow: "ns:x" } });
    handler({ pluginId: "flows", action: "flow.run", payload: { flow: "ns:x" } });
    expect(emitEventToSession).not.toHaveBeenCalled();
  });

  it("flow.set-edit-mode is wired to the per-project handler (unknown session: no emit)", async () => {
    const { handler, emitEventToSession, ctx } = await setup();
    handler({ pluginId: "flows", sessionId: "s1", action: "flow.set-edit-mode", payload: { enabled: true } });
    await new Promise((r) => setTimeout(r, 0));
    expect(emitEventToSession).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining("flow.set-edit-mode session=s1"));
  });

  it("registers the edit-mode routes and does not touch plugin config without a legacy key", async () => {
    const { ctx } = await setup();
    const f = ctx.fastify as unknown as { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
    expect(f.get.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(["/api/plugins/flows/edit-mode-default", "/api/plugins/flows/edit-mode-state"]),
    );
    expect(f.put.mock.calls.map((c) => c[0])).toContain("/api/plugins/flows/edit-mode-default");
    expect(ctx.updatePluginConfig).not.toHaveBeenCalled();
  });
});

// ── Flow-control actions (update-flows-plugin D2; test-plan E33–E36, X6) ──
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function controlSetup(opts: { delivered?: boolean } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "flows-ctl-"));
  const sessions: Record<string, { id: string; cwd: string; driver?: string }> = {
    s1: { id: "s1", cwd },
    p1: { id: "p1", cwd },
    a1: { id: "a1", cwd, driver: "acp" },
  };
  const emitEventToSession = vi.fn(() => opts.delivered ?? true);
  const recordRejectedAction = vi.fn();
  let handler: Handler | undefined;
  const f = {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    register: async (fn: unknown, o?: unknown) => {
      if (typeof fn === "function" && o === undefined) await (fn as (x: unknown) => Promise<void>)(f);
    },
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx = {
    logger,
    broadcastToSubscribers: vi.fn(),
    emitEventToSession,
    sendToSession: vi.fn(),
    recordRejectedAction,
    provide: vi.fn(),
    consume: vi.fn(),
    sessionManager: {
      listActive: () => Object.values(sessions),
      listAll: () => Object.values(sessions),
      getSession: (id: string) => sessions[id],
    },
    fastify: f,
    getPluginConfig: () => ({}),
    onEvent: () => () => {},
    onSessionEnded: () => () => {},
    updatePluginConfig: vi.fn(async () => {}),
    registerBrowserHandler: (type: string, h: Handler) => {
      if (type === "plugin_action") handler = h;
    },
  } as unknown as Parameters<typeof registerPlugin>[0];
  await registerPlugin(ctx);
  // Server-start catalog asks (dashboard-flows:report-files) are not flow commands.
  await new Promise((r) => setTimeout(r, 0));
  emitEventToSession.mockClear();
  logger.warn.mockClear();
  logger.info.mockClear();
  const emits = () => emitEventToSession.mock.calls.map((c) => [c[1], c[2]] as const);
  const send = (sessionId: string | undefined, action: string, payload?: Record<string, unknown>, pluginId = "flows") =>
    handler!({ pluginId, ...(sessionId ? { sessionId } : {}), action, ...(payload ? { payload } : {}) });
  return { send, emits, emitEventToSession, recordRejectedAction, logger, f };
}

describe("flow-control plugin_action: six actions (E33)", () => {
  it("emits exactly the fixed events, in order", async () => {
    const t = await controlSetup();
    t.send("s1", "flow.abort");
    expect(t.emits()).toEqual([["flow:abort", {}], ["flow:architect-abort", {}]]);
    t.emitEventToSession.mockClear();
    t.send("s1", "flow.toggle-autonomous");
    expect(t.emits()).toEqual([["flow:toggle-autonomous", {}]]);
    t.emitEventToSession.mockClear();
    t.send("s1", "flow.dismiss-summary");
    expect(t.emits()).toEqual([["flow:summary-dismissed", {}]]);
    t.emitEventToSession.mockClear();
    t.send("s1", "flow.delete", { flowName: "batch:apply" });
    expect(t.emits()).toEqual([
      ["flow:delete-request", { flowName: "batch:apply" }],
      ["flow:notify", { message: 'Flow "batch:apply" deleted.', level: "info" }],
    ]);
    t.emitEventToSession.mockClear();
    t.send("s1", "flow.run", { flowName: "research", task: "Find bugs" });
    expect(t.emits()).toEqual([["flow:run", { flowName: "research", task: "Find bugs" }]]);
    t.emitEventToSession.mockClear();
    // Current effective edit mode is off (no settings) → desired on emits.
    t.send("s1", "flow.set-edit-mode", { enabled: true });
    expect(t.emits()).toEqual([["flow:set-edit-mode", { enabled: true }]]);
    expect(t.recordRejectedAction).not.toHaveBeenCalled();
  });
});

describe("flow-control plugin_action: invalid payloads (E34)", () => {
  it.each([
    ["flow.set-edit-mode", { enabled: "true" }],
    ["flow.set-edit-mode", { enabled: 1 }],
    ["flow.set-edit-mode", {}],
    ...["", "   ", 42, "../x", "a/b", "x\ny"].flatMap((v) => [
      ["flow.delete", { flowName: v }] as const,
      ["flow.run", { flowName: v }] as const,
    ]),
  ] as Array<[string, Record<string, unknown>]>)("%s %j emits nothing, warns and counts", async (action, payload) => {
    const t = await controlSetup();
    t.send("s1", action, payload);
    await new Promise((r) => setTimeout(r, 0));
    expect(t.emitEventToSession).not.toHaveBeenCalled();
    expect(t.logger.warn).toHaveBeenCalledTimes(1);
    expect(t.recordRejectedAction).toHaveBeenCalledTimes(1);
  });
});

describe("flow-control plugin_action: unknown / foreign / no session (E35)", () => {
  it("emits nothing; only the unknown flows action is warned and counted", async () => {
    const t = await controlSetup();
    t.send("s1", "flow.rename");
    expect(t.logger.warn).toHaveBeenCalledWith(expect.stringContaining("flow.rename"));
    expect(t.recordRejectedAction).toHaveBeenCalledTimes(1);
    t.logger.warn.mockClear();
    t.send("s1", "flow.abort", undefined, "other");
    expect(t.logger.warn).not.toHaveBeenCalled();
    t.send(undefined, "flow.abort");
    expect(t.emitEventToSession).not.toHaveBeenCalled();
    expect(t.recordRejectedAction).toHaveBeenCalledTimes(1);
  });
});

describe("flow-control plugin_action: ACP refused before relay (E36)", () => {
  it("refuses all six for an ACP session; a pi session relays", async () => {
    const t = await controlSetup();
    const payloads: Record<string, Record<string, unknown>> = {
      "flow.delete": { flowName: "x" },
      "flow.run": { flowName: "x" },
      "flow.set-edit-mode": { enabled: true },
    };
    for (const a of ["flow.abort", "flow.toggle-autonomous", "flow.dismiss-summary", "flow.run", "flow.delete", "flow.set-edit-mode"]) {
      t.send("a1", a, payloads[a]);
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(t.emitEventToSession).not.toHaveBeenCalled();
    expect(t.recordRejectedAction).toHaveBeenCalledTimes(6);
    expect(t.logger.warn).toHaveBeenCalledWith(expect.stringContaining("unsupported_for_acp"));
    t.send("p1", "flow.abort");
    expect(t.emitEventToSession).toHaveBeenCalledTimes(2);
  });
});

describe("flow-control: relay not delivered (X6)", () => {
  it("does not throw; logs delivered=false", async () => {
    const t = await controlSetup({ delivered: false });
    expect(() => t.send("s1", "flow.abort")).not.toThrow();
    expect(t.logger.info).toHaveBeenCalledWith(expect.stringContaining("delivered=false"));
  });

  it("registers the POST control route", async () => {
    const t = await controlSetup();
    expect(t.f.post.mock.calls.map((c) => c[0])).toContain("/api/plugins/flows/control");
  });
});
