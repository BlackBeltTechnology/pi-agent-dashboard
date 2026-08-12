/**
 * When a process outlives SIGTERM → SIGKILL, clients are TOLD.
 *
 * The record is still released: retaining it would wedge the session in the UI
 * with no way to clear it but force-kill, and stall the E2E reap, which awaits
 * `session_removed` per session (design D3 — a failed termination must be
 * non-blocking). But "removed" alone is exactly the signal that hid this bug for
 * weeks: a kill that never happened was indistinguishable from one that
 * succeeded. So `session_orphaned` goes out ALONGSIDE `session_removed`, never
 * instead of it.
 *
 * A process that genuinely survives SIGKILL cannot be manufactured in a test
 * (that needs uninterruptible sleep), so `shutdownSession` is driven directly
 * with a stubbed liveness view: a PID the server believes is alive and that no
 * kill can clear. This exercises the branch itself rather than a mock of it.
 *
 * See change: fix-tmux-session-shutdown-leak (requirement C2).
 */
import { describe, expect, it, vi } from "vitest";

// The OS boundary is stubbed, NOT the unit under test: a process that genuinely
// survives SIGKILL needs an uninterruptible-sleep kernel state no test can
// arrange, and pid 1 is unusable as a stand-in because a non-root
// `process.kill(1, 0)` throws EPERM, which `isProcessAlive` reports as "gone" —
// the opposite of the condition under test. So the two primitives the branch
// reads are pinned directly, and `shutdownSession` runs for real.
const killProcess = vi.fn(async () => ({ ok: true, forced: true }));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    isProcessAlive: (pid: number) => pid === SURVIVING_PID,
    killProcess: (...args: unknown[]) => killProcess(...(args as [])),
  };
});

/** A pid the stub reports as resident no matter how often it is killed. */
const SURVIVING_PID = 424_242;

import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { type ShutdownSessionDeps, shutdownSession } from "../browser-handlers/session-action-handler.js";

const unregister = vi.fn();

function makeDeps(broadcast: (m: ServerToBrowserMessage) => void): ShutdownSessionDeps {
  return {
    sessionManager: {
      get: () => ({ id: "orphan-session", pid: SURVIVING_PID, sessionFile: undefined }),
      unregister,
    } as unknown as ShutdownSessionDeps["sessionManager"],
    piGateway: {
      sendToSession: vi.fn(),
    } as unknown as ShutdownSessionDeps["piGateway"],
    headlessPidRegistry: {
      killBySessionId: vi.fn(async () => false),
    } as unknown as ShutdownSessionDeps["headlessPidRegistry"],
    broadcast,
  };
}

describe("a process that outlives the ladder is announced, not just logged (C2)", () => {
  it("broadcasts session_orphaned with the surviving pid, alongside session_removed", async () => {
    const sent: ServerToBrowserMessage[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    killProcess.mockClear();
    unregister.mockClear();

    await shutdownSession("orphan-session", makeDeps((m) => sent.push(m)));
    errors.mockRestore();

    // The escalation really ran: same ladder force-kill uses. Without this the
    // test would pass on a shutdown that never tried to kill anything.
    expect(killProcess).toHaveBeenCalledWith(SURVIVING_PID, { timeoutMs: 2000 });
    // And the record really was released — `session_removed` on the wire is the
    // announcement, `unregister` is the act.
    expect(unregister).toHaveBeenCalledWith("orphan-session");

    const orphaned = sent.find((m) => m.type === "session_orphaned");
    expect(
      orphaned,
      "a process survived SIGTERM→SIGKILL and clients were told only that the session was removed",
    ).toBeDefined();
    expect(orphaned).toMatchObject({ sessionId: "orphan-session", pid: SURVIVING_PID });

    // ALONGSIDE, not instead of: the record must still be released or the
    // session wedges in the UI and the E2E reap stalls waiting for it.
    expect(sent.map((m) => m.type)).toContain("session_removed");
    expect(sent.findIndex((m) => m.type === "session_orphaned")).toBeLessThan(
      sent.findIndex((m) => m.type === "session_removed"),
    );
  }, 20_000);

  it("stays silent about orphans when the process is gone", async () => {
    const sent: ServerToBrowserMessage[] = [];
    const deps = makeDeps((m) => sent.push(m));
    // Any pid but the surviving one reads as gone through the stub.
    deps.sessionManager = {
      get: () => ({ id: "clean-session", pid: 999, sessionFile: undefined }),
      unregister: vi.fn(),
    } as unknown as ShutdownSessionDeps["sessionManager"];

    await shutdownSession("clean-session", deps);

    expect(sent.map((m) => m.type)).toContain("session_removed");
    expect(sent.some((m) => m.type === "session_orphaned")).toBe(false);
  }, 20_000);
});
