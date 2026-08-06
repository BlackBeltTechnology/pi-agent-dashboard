/**
 * §5.1–5.3 — handleSendPrompt is BRIDGE-gated, not status-gated. A prompt to a
 * session with no live bridge (cleanly ended OR phantom-active: status "active"
 * but the process/bridge is gone) auto-resumes and delivers, instead of taking
 * the live-send branch where sendToSession returns false and the prompt is
 * silently dropped. A session WITH a live bridge still delivers live.
 *
 * See change: make-invoice-session-canonical (§5).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../process-manager.js", () => ({ spawnPiSession: vi.fn() }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/config.js", () => ({
  loadConfig: () => ({ spawnStrategy: "headless" as const }),
}));

import { handleSendPrompt } from "../browser-handlers/session-action-handler.js";
import { spawnPiSession } from "../process-manager.js";

function makeCtx(opts: {
  session?: Record<string, unknown>;
  connected: boolean;
  resumeSpawnEnv?: (sessionId: string) => Record<string, string> | undefined;
}) {
  const sessions: Record<string, Record<string, unknown>> = {};
  if (opts.session) sessions[opts.session.id as string] = opts.session;
  const sendToSession = vi.fn().mockReturnValue(true);
  const recorded: Array<{ cwd: string; e: Record<string, unknown> }> = [];
  const updates: Array<{ sid: string; u: Record<string, unknown> }> = [];
  const ctx = {
    ws: { readyState: 1 },
    sessionManager: {
      get: (sid: string) => sessions[sid],
      update: (sid: string, u: Record<string, unknown>) => {
        updates.push({ sid, u });
        if (sessions[sid]) Object.assign(sessions[sid], u);
      },
      unregister: vi.fn(),
    },
    piGateway: {
      isSessionConnected: () => opts.connected,
      sendToSession,
    },
    headlessPidRegistry: { getPid: () => undefined, register: vi.fn() },
    pendingResumeRegistry: { record: (cwd: string, e: Record<string, unknown>) => recorded.push({ cwd, e }), consume: vi.fn() },
    pendingResumeIntents: { record: vi.fn() },
    pendingDashboardSpawns: new Map<string, number>(),
    broadcast: vi.fn(),
    ...(opts.resumeSpawnEnv ? { resumeSpawnEnv: opts.resumeSpawnEnv } : {}),
  } as unknown as Parameters<typeof handleSendPrompt>[1];
  return { ctx, sendToSession, recorded };
}

const prompt = (text = "hello") => ({ type: "send_prompt", sessionId: "s1", text }) as Parameters<typeof handleSendPrompt>[0];

describe("handleSendPrompt is bridge-gated (§5.1–5.3)", () => {
  beforeEach(() => {
    vi.mocked(spawnPiSession).mockReset().mockResolvedValue({ success: true } as Awaited<ReturnType<typeof spawnPiSession>>);
  });

  it("5.1 phantom-active (status 'active', NO live bridge) → resumes, never live-sends (no drop)", async () => {
    const { ctx, sendToSession, recorded } = makeCtx({
      session: { id: "s1", cwd: "/w", status: "active", sessionFile: "/w/s.jsonl" },
      connected: false,
    });
    await handleSendPrompt(prompt(), ctx);
    expect(vi.mocked(spawnPiSession)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawnPiSession).mock.calls[0]![1]).toMatchObject({ mode: "continue", sessionFile: "/w/s.jsonl" });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.e.text).toBe("hello");
    expect(sendToSession).not.toHaveBeenCalled();
  });

  it("5.1b cleanly ended, no live bridge → resumes", async () => {
    const { ctx, sendToSession } = makeCtx({
      session: { id: "s1", cwd: "/w", status: "ended", sessionFile: "/w/s.jsonl" },
      connected: false,
    });
    await handleSendPrompt(prompt(), ctx);
    expect(vi.mocked(spawnPiSession)).toHaveBeenCalledTimes(1);
    expect(sendToSession).not.toHaveBeenCalled();
  });

  it("5.2 live bridge present → live-sends, never resumes", async () => {
    const { ctx, sendToSession } = makeCtx({
      session: { id: "s1", cwd: "/w", status: "active", sessionFile: "/w/s.jsonl" },
      connected: true,
    });
    await handleSendPrompt(prompt(), ctx);
    expect(sendToSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawnPiSession)).not.toHaveBeenCalled();
  });

  it("5.4 resume re-applies the bound scope env (IB_TOOLSET/IB_INVOICE_ID) into the continue-spawn", async () => {
    const { ctx } = makeCtx({
      session: { id: "s1", cwd: "/w", status: "ended", sessionFile: "/w/s.jsonl" },
      connected: false,
      resumeSpawnEnv: (sid) => (sid === "s1" ? { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: "inv-9" } : undefined),
    });
    await handleSendPrompt(prompt(), ctx);
    expect(vi.mocked(spawnPiSession)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawnPiSession).mock.calls[0]![1]).toMatchObject({
      mode: "continue",
      env: { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: "inv-9" },
    });
  });

  it("5.4 resume with no scope resolver carries no env (unchanged)", async () => {
    const { ctx } = makeCtx({
      session: { id: "s1", cwd: "/w", status: "ended", sessionFile: "/w/s.jsonl" },
      connected: false,
    });
    await handleSendPrompt(prompt(), ctx);
    expect(vi.mocked(spawnPiSession).mock.calls[0]![1]).not.toHaveProperty("env");
  });

  it("no live bridge + no sessionFile → cannot resume; does not spawn and does not silently live-send", async () => {
    const { ctx, sendToSession } = makeCtx({
      session: { id: "s1", cwd: "/w", status: "active", sessionFile: undefined },
      connected: false,
    });
    await handleSendPrompt(prompt(), ctx);
    expect(vi.mocked(spawnPiSession)).not.toHaveBeenCalled();
    expect(sendToSession).not.toHaveBeenCalled();
  });
});
