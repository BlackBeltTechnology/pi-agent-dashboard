/**
 * `handleSendPrompt` when there is no live bridge.
 *
 * A prompt to a dashboard-spawned session whose process is gone (cleanly
 * "ended", OR phantom-active: status still "active" but bridge + carrier are
 * gone) auto-resumes and delivers, instead of taking the live-send branch where
 * `sendToSession` returns false and the prompt is silently dropped. A session
 * WITH a live bridge still delivers live.
 *
 * TWO protections are locked here on purpose:
 *  - the reopen is scoped to `source === "dashboard"`, so a TUI/cli session with
 *    a transient bridge drop is never given a headless twin against its own
 *    transcript (change: resume-zombie-active-session). A previous local variant
 *    of this handler gated on the bridge ALONE and would have done exactly that;
 *    the case below exists so a future merge cannot quietly widen it back.
 *  - the resume re-applies the session's bound spawn env, so a resumed scoped
 *    session does not silently come back on the full tool surface (§5.4).
 *
 * See changes: make-invoice-session-canonical (§5), resume-zombie-active-session.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../spawn-process/process-manager.js", () => ({ spawnPiSession: vi.fn() }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/config.js", () => ({
  loadConfig: () => ({ spawnStrategy: "headless" as const, spawnRegisterTimeoutMs: 30_000 }),
  clampSpawnRegisterTimeoutMs: (ms: number) => ms,
}));

import { handleSendPrompt } from "../browser-handlers/session-action-handler.js";
import { spawnPiSession } from "../spawn-process/process-manager.js";

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

describe("handleSendPrompt with no live bridge (§5.1–5.3)", () => {
  beforeEach(() => {
    vi.mocked(spawnPiSession).mockReset().mockResolvedValue({ success: true } as Awaited<ReturnType<typeof spawnPiSession>>);
  });

  it("5.1 phantom-active dashboard session (status 'active', NO live bridge) → resumes, never live-sends (no drop)", async () => {
    const { ctx, sendToSession, recorded } = makeCtx({
      session: { id: "s1", cwd: "/w", status: "active", source: "dashboard", sessionFile: "/w/s.jsonl" },
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
      session: { id: "s1", cwd: "/w", status: "ended", source: "dashboard", sessionFile: "/w/s.jsonl" },
      connected: false,
    });
    await handleSendPrompt(prompt(), ctx);
    expect(vi.mocked(spawnPiSession)).toHaveBeenCalledTimes(1);
    expect(sendToSession).not.toHaveBeenCalled();
  });

  it("5.2 live bridge present → live-sends, never resumes", async () => {
    const { ctx, sendToSession } = makeCtx({
      session: { id: "s1", cwd: "/w", status: "active", source: "dashboard", sessionFile: "/w/s.jsonl" },
      connected: true,
    });
    await handleSendPrompt(prompt(), ctx);
    expect(sendToSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawnPiSession)).not.toHaveBeenCalled();
  });

  it("a phantom-active NON-dashboard (TUI) session is NEVER given a headless twin", async () => {
    // The TUI owns its own lifecycle: continue-spawning here would mint a
    // second pi against the transcript the TUI still holds. Locking the
    // `source === "dashboard"` scope so it cannot be widened back by a merge.
    const { ctx, sendToSession } = makeCtx({
      session: { id: "s1", cwd: "/w", status: "active", source: "cli", sessionFile: "/w/s.jsonl" },
      connected: false,
    });
    await handleSendPrompt(prompt(), ctx);
    expect(vi.mocked(spawnPiSession)).not.toHaveBeenCalled();
    expect(sendToSession).toHaveBeenCalledTimes(1);
  });

  it("5.4 resume re-applies the bound spawn env into the continue-spawn", async () => {
    const { ctx } = makeCtx({
      session: { id: "s1", cwd: "/w", status: "ended", source: "dashboard", sessionFile: "/w/s.jsonl" },
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
      session: { id: "s1", cwd: "/w", status: "ended", source: "dashboard", sessionFile: "/w/s.jsonl" },
      connected: false,
    });
    await handleSendPrompt(prompt(), ctx);
    expect(vi.mocked(spawnPiSession).mock.calls[0]![1]).not.toHaveProperty("env");
  });

  it("no live bridge + no sessionFile → cannot resume; does not spawn and does not silently live-send", async () => {
    const { ctx, sendToSession } = makeCtx({
      session: { id: "s1", cwd: "/w", status: "active", source: "dashboard", sessionFile: undefined },
      connected: false,
    });
    await handleSendPrompt(prompt(), ctx);
    expect(vi.mocked(spawnPiSession)).not.toHaveBeenCalled();
    expect(sendToSession).not.toHaveBeenCalled();
  });
});
