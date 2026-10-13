/**
 * Spawn-time and resume-time model / thinking choices reach `spawnPiSession`.
 * test-plan: E1, E6, E22, E23, E24, E25, X5, X6.
 * See change: redesign-directory-home-split.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cfg = vi.hoisted(() => ({
  value: { spawnStrategy: "headless" as const, spawnRegisterTimeoutMs: 30000, defaultModel: "", defaultThinkingLevel: "" },
}));

vi.mock("../../spawn-process/process-manager.js", () => ({
  spawnPiSession: vi.fn(),
  getKeeperManager: () => ({ isKeeperAlive: () => false }),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/config.js", () => ({
  loadConfig: () => cfg.value,
}));
vi.mock("../../spawn-process/spawn-preflight.js", () => ({
  preflightSpawn: vi.fn().mockReturnValue({ ok: true, reasons: [] }),
}));
vi.mock("../../spawn-process/spawn-register-watchdog.js", () => ({
  getSpawnRegisterWatchdog: vi.fn().mockReturnValue({ arm: vi.fn() }),
  armSpawnWatchdog: vi.fn(),
}));
vi.mock("../../spawn-process/spawn-failure-log.js", () => ({ appendSpawnFailure: vi.fn() }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js", () => ({
  ToolResolver: function MockToolResolver() {
    return { resolvePi: vi.fn().mockReturnValue(["pi"]), resolveNode: vi.fn().mockReturnValue("/usr/bin/node") };
  },
}));

import { spawnPiSession } from "../../spawn-process/process-manager.js";
import type { BrowserHandlerContext } from "../handler-context.js";
import { handleResumeSession, handleSendPrompt, handleSpawnSession } from "../session-action-handler.js";

const spawn = spawnPiSession as unknown as ReturnType<typeof vi.fn>;
const lastOptions = (n = 0) => spawn.mock.calls[n]?.[1] as Record<string, unknown>;

function makeCtx(sessions: Record<string, Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  const sent: unknown[] = [];
  const ctx = {
    ws: { id: "ws" },
    sessionManager: {
      get: (id: string) => sessions[id],
      update: (id: string, patch: Record<string, unknown>) => Object.assign(sessions[id] ?? {}, patch),
    },
    piGateway: { isSessionConnected: () => false, sendToSession: vi.fn().mockReturnValue(true) },
    headlessPidRegistry: { getPid: () => undefined, register: vi.fn() },
    pendingResumeRegistry: { record: vi.fn(), consume: vi.fn() },
    pendingResumeIntents: { record: vi.fn() },
    pendingDashboardSpawns: new Map<string, number>(),
    broadcast: vi.fn(),
    sendTo: (_ws: unknown, m: unknown) => sent.push(m),
    eventStore: { insertEvent: () => 1 },
    ...extra,
  } as unknown as BrowserHandlerContext;
  return { ctx, sent };
}

beforeEach(() => {
  vi.clearAllMocks();
  spawn.mockResolvedValue({ success: true, message: "ok", spawnToken: "tok" });
  cfg.value = { spawnStrategy: "headless", spawnRegisterTimeoutMs: 30000, defaultModel: "", defaultThinkingLevel: "" };
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("spawn_session model/thinking", () => {
  it("E1: valid choices reach spawnPiSession", async () => {
    const { ctx } = makeCtx({});
    await handleSpawnSession(
      { type: "spawn_session", cwd: "/p", model: "anthropic/claude-sonnet-5", thinkingLevel: "high" },
      ctx,
    );
    expect(lastOptions()).toMatchObject({ model: "anthropic/claude-sonnet-5", thinking: "high" });
  });

  it("an invalid model is dropped and the spawn proceeds", async () => {
    const { ctx } = makeCtx({});
    await handleSpawnSession({ type: "spawn_session", cwd: "/p", model: "--help/x" }, ctx);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(lastOptions()).not.toHaveProperty("model");
  });

  it("E6a: thinking-only is paired with the configured default model", async () => {
    cfg.value = { ...cfg.value, defaultModel: "anthropic/claude-opus-5-5" };
    const { ctx } = makeCtx({});
    await handleSpawnSession({ type: "spawn_session", cwd: "/p", thinkingLevel: "high" }, ctx);
    expect(lastOptions()).toMatchObject({ model: "anthropic/claude-opus-5-5", thinking: "high" });
  });

  it("E6b: thinking-only with no configured default carries no model", async () => {
    const { ctx } = makeCtx({});
    await handleSpawnSession({ type: "spawn_session", cwd: "/p", thinkingLevel: "high" }, ctx);
    expect(lastOptions()).toMatchObject({ thinking: "high" });
    expect(lastOptions()).not.toHaveProperty("model");
  });
});

describe("auto-resume via send_prompt", () => {
  const ended = (over: Record<string, unknown> = {}) => ({
    id: "s1",
    status: "ended",
    cwd: "/p",
    sessionFile: "/p/s1.jsonl",
    model: "m/zero",
    thinkingLevel: "high",
    ...over,
  });

  it("E22: pick decision table", async () => {
    const cases: Array<[Record<string, string>, Record<string, string | undefined>]> = [
      [{ model: "m/one" }, { model: "m/one", thinking: "high" }],
      [{ thinkingLevel: "low" }, { thinking: "low" }],
      [{ model: "m/one", thinkingLevel: "low" }, { model: "m/one", thinking: "low" }],
      [{}, {}],
    ];
    for (const [pick, want] of cases) {
      spawn.mockClear();
      const { ctx } = makeCtx({ s1: ended() });
      await handleSendPrompt({ type: "send_prompt", sessionId: "s1", text: "hi", ...pick } as never, ctx);
      const opts = lastOptions();
      expect(opts.model, JSON.stringify(pick)).toBe(want.model);
      expect(opts.thinking, JSON.stringify(pick)).toBe(want.thinking);
      expect(opts.mode).toBe("continue");
    }
  });

  it("E24: an invalid model is ignored on resume", async () => {
    const { ctx } = makeCtx({ s1: ended() });
    await handleSendPrompt({ type: "send_prompt", sessionId: "s1", text: "hi", model: "--help/x" }, ctx);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(lastOptions().model).toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it("E25: a live session ignores pick fields — prompt forwarded, no spawn", async () => {
    const live = { id: "s1", status: "active", source: "tui", cwd: "/p" };
    const { ctx } = makeCtx({ s1: live }, { piGateway: { isSessionConnected: () => true, sendToSession: vi.fn().mockReturnValue(true) } });
    await handleSendPrompt({ type: "send_prompt", sessionId: "s1", text: "hi", model: "m/one" }, ctx);
    expect(spawn).not.toHaveBeenCalled();
    const sendToSession = (ctx.piGateway as unknown as { sendToSession: ReturnType<typeof vi.fn> }).sendToSession;
    expect(sendToSession).toHaveBeenCalledTimes(1);
    expect(sendToSession.mock.calls[0]?.[1]).not.toHaveProperty("model");
  });

  it("X5: concurrent resumes of different sessions never share a pick", async () => {
    const sessions = { A: ended({ id: "A", sessionFile: "/p/A.jsonl" }), B: ended({ id: "B", sessionFile: "/p/B.jsonl" }) };
    const { ctx } = makeCtx(sessions);
    await Promise.all([
      handleSendPrompt({ type: "send_prompt", sessionId: "A", text: "a", model: "m/one" }, ctx),
      handleSendPrompt({ type: "send_prompt", sessionId: "B", text: "b" }, ctx),
    ]);
    const byFile = new Map(spawn.mock.calls.map((c) => [(c[1] as { sessionFile: string }).sessionFile, c[1] as Record<string, unknown>]));
    expect(byFile.get("/p/A.jsonl")?.model).toBe("m/one");
    expect(byFile.get("/p/B.jsonl")?.model).toBeUndefined();
  });

  it("X6: a second pick while the resume is in flight is not applied", async () => {
    let release!: (v: unknown) => void;
    spawn.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const { ctx } = makeCtx({ s1: ended() });
    const first = handleSendPrompt({ type: "send_prompt", sessionId: "s1", text: "a", model: "m/one" }, ctx);
    await Promise.resolve();
    await handleSendPrompt({ type: "send_prompt", sessionId: "s1", text: "b", model: "m/two" }, ctx);
    expect(spawn).toHaveBeenCalledTimes(1);
    release({ success: true, message: "ok" });
    await first;
    expect(lastOptions().model).toBe("m/one");
  });
});

describe("resume_session", () => {
  it("E23: continue applies the pick; fork ignores it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "resume-choice-"));
    const file = join(dir, "s1.jsonl");
    writeFileSync(file, "{}\n");
    const base = { id: "s1", status: "ended", cwd: dir, sessionFile: file, thinkingLevel: "high" };

    const c1 = makeCtx({ s1: { ...base } });
    await handleResumeSession({ type: "resume_session", sessionId: "s1", mode: "continue", model: "m/one" }, c1.ctx);
    expect(lastOptions()).toMatchObject({ mode: "continue", model: "m/one", thinking: "high" });

    spawn.mockClear();
    const c2 = makeCtx({ s1: { ...base } });
    await handleResumeSession({ type: "resume_session", sessionId: "s1", mode: "fork", model: "m/one" }, c2.ctx);
    expect(lastOptions().mode).toBe("fork");
    expect(lastOptions()).not.toHaveProperty("model");
    expect(lastOptions()).not.toHaveProperty("thinking");
  });
});
