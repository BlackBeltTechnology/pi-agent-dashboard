/**
 * The reload PREDICATE (which `send_prompt` messages enter the reload path)
 * and the ladder's non-keeper branches (bridge forward, refusal, the PID
 * conjunct that stops a terminal-hosted session from being respawned).
 *
 * See change: fix-out-of-band-reload (test-plan #E3, #E4, #E5, #X3, #X8).
 */
import { describe, it, expect, vi } from "vitest";
import { isBareReloadCommand } from "../browser-handlers/session-action-helpers.js";
import {
  dispatchReload,
  RELOAD_BUSY_MESSAGE,
  RELOAD_COMPACTING_MESSAGE,
  type DispatchReloadContext,
} from "../rpc-keeper/dispatch-reload.js";

function msg(overrides: Partial<{ text: string; images: unknown[]; sessionId: string }> = {}) {
  return {
    type: "send_prompt" as const,
    sessionId: overrides.sessionId ?? "S1",
    text: overrides.text ?? "/reload",
    images: overrides.images as any,
  };
}

interface HarnessOpts {
  status?: string;
  compacting?: boolean;
  connected?: boolean;
  pid?: number;
  hasKeeper?: boolean;
  sendOk?: boolean;
  missingSession?: boolean;
}

function harness(opts: HarnessOpts = {}) {
  const writeRpc = vi.fn(async () => true);
  const sendToSession = vi.fn(() => opts.sendOk ?? true);
  const respawn = vi.fn(async () => {});
  const feedback: Array<{ command: string; status: string; message?: string }> = [];
  const ctx: DispatchReloadContext = {
    headlessPidRegistry: {
      hasKeeper: () => opts.hasKeeper ?? false,
      getPid: () => opts.pid,
      writeRpc,
      listSessions: () => [],
    },
    getSession: () =>
      opts.missingSession
        ? undefined
        : { status: opts.status ?? "idle", compacting: opts.compacting },
    isSessionConnected: () => opts.connected ?? false,
    sendToSession,
    respawn,
    emitCommandFeedback: (_sid, command, status, message) =>
      feedback.push({ command, status, message }),
  };
  return { ctx, writeRpc, sendToSession, respawn, feedback };
}

describe("isBareReloadCommand (test-plan #E5)", () => {
  it("returns true for the exact bare '/reload'", () => {
    expect(isBareReloadCommand(msg() as any)).toBe(true);
  });

  it("returns true when images is an empty array", () => {
    expect(isBareReloadCommand(msg({ images: [] }) as any)).toBe(true);
  });

  it("returns false for surrounding whitespace", () => {
    expect(isBareReloadCommand(msg({ text: " /reload" }) as any)).toBe(false);
    expect(isBareReloadCommand(msg({ text: "/reload " }) as any)).toBe(false);
  });

  it("returns false for '/reload now'", () => {
    expect(isBareReloadCommand(msg({ text: "/reload now" }) as any)).toBe(false);
  });

  it("returns false when images are attached", () => {
    expect(
      isBareReloadCommand(msg({ images: [{ type: "image", data: "xxx" }] }) as any),
    ).toBe(false);
  });

  it("returns false for unrelated commands and plain text", () => {
    expect(isBareReloadCommand(msg({ text: "/new" }) as any)).toBe(false);
    expect(isBareReloadCommand(msg({ text: "hello" }) as any)).toBe(false);
  });

  it("does NOT consult the session shape — the ladder decides delivery", () => {
    // Regression guard for the old `shouldInterceptReload`, whose headless-PID
    // conjunct made kill-and-respawn the default for every headless session.
    expect(isBareReloadCommand(msg({ sessionId: "anything" }) as any)).toBe(true);
  });
});

describe("dispatchReload — non-keeper branches", () => {
  it("forwards to the bridge for a tmux session, with no kill and no spawn (#E3)", async () => {
    const h = harness({ connected: true, pid: undefined, hasKeeper: false });
    const outcome = await dispatchReload("S1", h.ctx);
    expect(outcome).toBe("forwarded");
    expect(h.sendToSession).toHaveBeenCalledWith("S1", "/reload");
    expect(h.respawn).not.toHaveBeenCalled();
    expect(h.writeRpc).not.toHaveBeenCalled();
  });

  it("NEVER respawns a session with no registered PID (#E4)", async () => {
    // A tmux session whose WS is momentarily down. Respawning here would
    // start a SECOND pi against the same session file.
    const h = harness({ connected: false, pid: undefined, hasKeeper: false });
    const outcome = await dispatchReload("S1", h.ctx);
    expect(outcome).toBe("error");
    expect(h.respawn).not.toHaveBeenCalled();
    expect(h.feedback).toHaveLength(1);
    expect(h.feedback[0]).toMatchObject({ command: "/reload", status: "error" });
  });

  it("falls back to respawn when the send fails after a passing probe (#X3)", async () => {
    const h = harness({ connected: true, sendOk: false, pid: 4242, hasKeeper: false });
    const outcome = await dispatchReload("S1", h.ctx);
    expect(outcome).toBe("respawn");
    expect(h.respawn).toHaveBeenCalledWith("S1", { ignoreStreamingGuard: true });
  });

  it("refuses a compacting session: no write, no respawn, wait wording (#X8)", async () => {
    const h = harness({ compacting: true, hasKeeper: true, pid: 4242, connected: true });
    const outcome = await dispatchReload("S1", h.ctx);
    expect(outcome).toBe("refused");
    expect(h.writeRpc).not.toHaveBeenCalled();
    expect(h.respawn).not.toHaveBeenCalled();
    expect(h.feedback).toEqual([
      { command: "/reload", status: "error", message: RELOAD_COMPACTING_MESSAGE },
    ]);
  });

  it("refuses a connected streaming session with pi's wait wording", async () => {
    const h = harness({ status: "streaming", connected: true, hasKeeper: true, pid: 42 });
    const outcome = await dispatchReload("S1", h.ctx);
    expect(outcome).toBe("refused");
    expect(h.writeRpc).not.toHaveBeenCalled();
    expect(h.feedback).toEqual([
      { command: "/reload", status: "error", message: RELOAD_BUSY_MESSAGE },
    ]);
  });

  it("emits an error for an unknown session", async () => {
    const h = harness({ missingSession: true });
    const outcome = await dispatchReload("S1", h.ctx);
    expect(outcome).toBe("error");
    expect(h.feedback).toHaveLength(1);
  });
});
