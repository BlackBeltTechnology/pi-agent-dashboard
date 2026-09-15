/**
 * Honest server-side refusals for `send_prompt`.
 * See change: stop-discarding-known-session-state (test-plan X2/X3/X4).
 *
 * A server-side `console.error` is not a user-visible outcome: the browser
 * receives nothing and the client's 30 s timeout then blames the session. Each
 * refusal SHALL emit `command_feedback` for the session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../spawn-process/process-manager.js", () => ({
  spawnPiSession: vi.fn(),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/config.js", () => ({
  loadConfig: () => ({ spawnStrategy: "headless" as const, spawnRegisterTimeoutMs: 30000 }),
}));
vi.mock("../../spawn-process/spawn-preflight.js", () => ({
  preflightSpawn: vi.fn().mockReturnValue({ ok: true, reasons: [] }),
}));
vi.mock("../../spawn-process/spawn-register-watchdog.js", () => ({
  getSpawnRegisterWatchdog: vi.fn().mockReturnValue({ arm: vi.fn() }),
  armSpawnWatchdog: vi.fn(),
}));
vi.mock("../../spawn-process/spawn-failure-log.js", () => ({
  appendSpawnFailure: vi.fn(),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js", () => ({
  ToolResolver: function MockToolResolver() {
    return { resolvePi: vi.fn().mockReturnValue(["pi"]), resolveNode: vi.fn().mockReturnValue("/usr/bin/node") };
  },
}));

import { spawnPiSession } from "../../spawn-process/process-manager.js";
import type { BrowserHandlerContext } from "../handler-context.js";
import { handleSendPrompt } from "../session-action-handler.js";

interface Feedback {
  eventType: string;
  data: { command: string; status: string; message?: string };
}

function makeCtx(session: Record<string, unknown>) {
  const feedback: Feedback[] = [];
  const broadcasts: unknown[] = [];
  const ctx = {
    sessionManager: {
      get: () => session,
      update: vi.fn(),
    },
    piGateway: {
      isSessionConnected: () => true,
      sendToSession: () => false,
    },
    headlessPidRegistry: { getPid: () => undefined, register: vi.fn() },
    pendingResumeRegistry: { record: vi.fn(), consume: vi.fn() },
    pendingResumeIntents: { record: vi.fn() },
    pendingDashboardSpawns: new Map<string, number>(),
    broadcast: (m: unknown) => broadcasts.push(m),
    eventStore: {
      insertEvent: (_sid: string, e: Feedback) => {
        feedback.push(e);
        return feedback.length;
      },
    },
  } as unknown as BrowserHandlerContext;
  return { ctx, feedback, broadcasts };
}

const sendFeedback = (feedback: Feedback[]) =>
  feedback.filter((e) => e.eventType === "command_feedback" && e.data.status === "error");

describe("handleSendPrompt — honest refusals", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("X2: an active session with no bridge emits command feedback", async () => {
    const { ctx, feedback } = makeCtx({ id: "s1", status: "active", source: "tui", cwd: "/repo" });

    await handleSendPrompt({ type: "send_prompt", sessionId: "s1", text: "hi" }, ctx);

    const errs = sendFeedback(feedback);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.data.message).toMatch(/not delivered|isn't connected/i);
  });

  it("X3: an ended session with no sessionFile emits not-resumable feedback", async () => {
    const { ctx, feedback } = makeCtx({
      id: "s1",
      status: "ended",
      sessionFile: null,
      cwd: "/repo",
    });

    await handleSendPrompt({ type: "send_prompt", sessionId: "s1", text: "hi" }, ctx);

    const errs = sendFeedback(feedback);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.data.message).toMatch(/resume|saved transcript/i);
  });

  it("X4: a failed resume spawn rolls back AND emits the failure reason", async () => {
    (spawnPiSession as any).mockResolvedValueOnce({ success: false, message: "tmux unavailable" });
    const { ctx, feedback } = makeCtx({
      id: "s1",
      status: "ended",
      sessionFile: "/repo/session.jsonl",
      cwd: "/repo",
      resuming: false,
    });

    await handleSendPrompt({ type: "send_prompt", sessionId: "s1", text: "hi" }, ctx);

    expect(ctx.pendingResumeRegistry.consume).toHaveBeenCalledWith("/repo");
    expect(ctx.sessionManager.update).toHaveBeenCalledWith("s1", { resuming: false });
    const errs = sendFeedback(feedback);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.data.message).toMatch(/tmux unavailable/);
  });
});
