/**
 * A remote-origin session must be refused on the path the UI ACTUALLY uses.
 *
 * D13 makes a remote session read-only here: its transcript is not on this
 * filesystem, and #E15's same-username path collision means a local resume can
 * attach a WRITER to another host's transcript. `POST /api/session/:id/resume`
 * enforced that from the start — but the dashboard client does not use it. It
 * sends `resume_session` over the browser bus, and that handler never asked.
 *
 * So the enforcement lived entirely in the client, which hides the Resume
 * button for a remote session (task 12.49). Hiding a button is not a refusal:
 * drag-to-resume, an automation, the pi-dashboard skill, or any bus client
 * could still fire the message and get a local pi spawned against a foreign
 * transcript. The gate has to be on the door, not on the sign.
 *
 * (test-plan #F3 companion — the server half → task 13.6)
 * See change: add-pi-gateway-transport-identity (D13).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../spawn-process/process-manager.js", () => ({
  spawnPiSession: vi.fn(),
}));

import { handleResumeSession } from "../browser-handlers/session-action-handler.js";
import { spawnPiSession } from "../spawn-process/process-manager.js";

type Sent = { type: string; [k: string]: unknown };

function makeCtx(session: Record<string, unknown> | undefined) {
  const sent: Sent[] = [];
  return {
    sent,
    ctx: {
      ws: { readyState: 1 } as never,
      sessionManager: {
        get: () => session,
        update: vi.fn(),
        unregister: vi.fn(),
      },
      piGateway: {
        isSessionConnected: () => false,
        findLiveSessionBySessionFile: () => undefined,
        sendToSession: vi.fn(),
      },
      headlessPidRegistry: { getPid: () => undefined },
      pendingDashboardSpawns: { add: vi.fn(), delete: vi.fn() },
      pendingResumeIntents: { record: vi.fn(), tag: vi.fn(), clear: vi.fn() },
      pendingClientCorrelations: { set: vi.fn(), delete: vi.fn() },
      pendingForkRegistry: { register: vi.fn() },
      sendTo: (_ws: unknown, m: Sent) => {
        sent.push(m);
      },
    } as never,
  };
}

const REMOTE_DEVICE = "device-7f3a";

beforeEach(() => {
  vi.mocked(spawnPiSession).mockReset();
  // The local arm proceeds to the spawn path; give it a plausible success so
  // the watchdog downstream has something to read.
  vi.mocked(spawnPiSession).mockResolvedValue({ success: true, pid: 4242 } as never);
});

describe("resume_session over the bus, for a remote-origin session", () => {
  it("refuses an ENDED remote session and says the machine is gone", async () => {
    const { ctx, sent } = makeCtx({
      id: "s-remote-ended",
      status: "ended",
      sessionFile: "/Users/robson/.pi/agent/sessions/x.jsonl",
      originDeviceId: REMOTE_DEVICE,
      source: "dashboard",
      cwd: "/tmp",
    });

    await handleResumeSession(
      { type: "resume_session", sessionId: "s-remote-ended", mode: "continue" } as never,
      ctx,
    );

    const result = sent.find((m) => m.type === "resume_result");
    expect(result?.success).toBe(false);
    // The device has to be NAMED: "cannot resume" without saying where it ran
    // leaves the user with no next action.
    expect(String(result?.message)).toContain(REMOTE_DEVICE);
    expect(String(result?.message)).toMatch(/no longer connected|cannot be resumed/i);
    // And nothing may have been spawned against that foreign transcript.
    expect(spawnPiSession).not.toHaveBeenCalled();
  });

  it("refuses a LIVE remote session with the OTHER reason — a second writer", async () => {
    const { ctx, sent } = makeCtx({
      id: "s-remote-live",
      status: "active",
      sessionFile: "/Users/robson/.pi/agent/sessions/y.jsonl",
      originDeviceId: REMOTE_DEVICE,
      source: "dashboard",
      cwd: "/tmp",
    });

    await handleResumeSession(
      { type: "resume_session", sessionId: "s-remote-live", mode: "continue" } as never,
      ctx,
    );

    const result = sent.find((m) => m.type === "resume_result");
    expect(result?.success).toBe(false);
    // Distinct from the ended case: "still running" is a different fact and a
    // different user decision.
    expect(String(result?.message)).toMatch(/still running|second pi/i);
    expect(spawnPiSession).not.toHaveBeenCalled();
  });

  it("refuses BEFORE the session-file guard — a present foreign path is the danger", async () => {
    // #E15: two hosts with the same username produce identical paths, so the
    // interesting failure is not a missing file but a plausible one that
    // belongs to someone else. Checking `sessionFile` first would report
    // "pre-migration session" and hide the real reason.
    const { ctx, sent } = makeCtx({
      id: "s-remote-nofile",
      status: "ended",
      sessionFile: null,
      originDeviceId: REMOTE_DEVICE,
      source: "dashboard",
      cwd: "/tmp",
    });

    await handleResumeSession(
      { type: "resume_session", sessionId: "s-remote-nofile", mode: "continue" } as never,
      ctx,
    );

    const result = sent.find((m) => m.type === "resume_result");
    expect(String(result?.message)).toContain(REMOTE_DEVICE);
    expect(String(result?.message)).not.toMatch(/pre-migration/i);
  });

  it("does NOT refuse a local ended session — absence of originDeviceId means local", async () => {
    const { ctx, sent } = makeCtx({
      id: "s-local",
      status: "ended",
      sessionFile: "/Users/robson/.pi/agent/sessions/z.jsonl",
      source: "dashboard",
      cwd: "/tmp",
    });

    await handleResumeSession(
      { type: "resume_session", sessionId: "s-local", mode: "continue" } as never,
      ctx,
    );

    // It may fail later for unrelated reasons in this stubbed context; what
    // must NOT happen is a refusal citing a remote origin.
    const result = sent.find((m) => m.type === "resume_result");
    const message = String(result?.message ?? "");
    expect(message).not.toMatch(/ran on|still running/i);
  });
});
