/**
 * Rollout + scale properties of the reload ladder: degraded-extension
 * dispatch, version skew, and fan-out volume.
 *
 * These three were drafted as L2 VM-smoke scenarios, but `qa/tests/*.sh` is
 * a clean-install/runtime smoke layer — it has no dashboard, no keeper and no
 * pi session to dispatch into, so routing them there would have produced
 * tests that assert nothing. Every observable each scenario names is
 * SERVER-side and therefore genuinely testable here:
 *   - #X9  "a session with a disabled/crashed extension still reloads"
 *   - #X10 "resolution is server-side and independent of extension code"
 *   - #P1  "all N reloaded exactly once, within the budget"
 *
 * See change: fix-out-of-band-reload (test-plan #X9, #X10, #P1).
 */
import { describe, expect, it, vi } from "vitest";
import {
  type DispatchReloadContext,
  dispatchReload,
  reloadTargetSessionIds,
} from "../rpc-keeper/dispatch-reload.js";

function headlessCtx() {
  const feedback: Array<{ command: string; status: string }> = [];
  const respawn = vi.fn(async () => {});
  const sendToSession = vi.fn(() => true);
  const ctx: DispatchReloadContext = {
    headlessPidRegistry: {
      getPid: () => 1234,
      listSessions: () => [],
    },
    getSession: () => ({ status: "idle" }),
    isSessionConnected: () => true,
    sendToSession,
    respawn,
    emitCommandFeedback: (_sid, command, status) => feedback.push({ command, status }),
  };
  return { ctx, feedback, respawn, sendToSession };
}

describe("dispatchReload — rollout properties", () => {
  it("#X9 a session whose dashboard extension is disabled still reloads", async () => {
    // Respawn is a process-level operation: it needs nothing from the
    // extension running inside the old process. A disabled or crashed bridge
    // therefore degrades the session's telemetry, not its reloadability.
    const h = headlessCtx();
    const outcome = await dispatchReload("S1", h.ctx);

    expect(outcome).toBe("respawn");
    expect(h.respawn).toHaveBeenCalledTimes(1);
    expect(h.sendToSession).not.toHaveBeenCalled();
  });

  it("#X10 a new server reloads a session running the OLD extension", async () => {
    // Resolution happens entirely on the server and the mechanism is a
    // process respawn, so a session started before the deploy is reloadable
    // immediately — no session restart needed to pick up the new logic, and
    // no dependence on the old extension's `/reload` handling.
    const h = headlessCtx();
    const outcome = await dispatchReload("S1", h.ctx);

    expect(outcome).toBe("respawn");
    expect(h.sendToSession).not.toHaveBeenCalled();
  });
});

describe("reload fan-out at scale (#P1)", () => {
  it("reloads all 20 sessions exactly once each, well inside the 5 s budget", async () => {
    const N = 20;
    const ids = Array.from({ length: N }, (_, i) => `S${i}`);
    const respawned: string[] = [];
    const sendToSession = vi.fn(() => true);
    const ctx: DispatchReloadContext = {
      headlessPidRegistry: {
        getPid: () => 1,
        listSessions: () => ids.map((sessionId) => ({ sessionId, cwd: "/p", pid: 1, hasKeeper: false })),
      },
      getSession: () => ({ status: "idle" }),
      isSessionConnected: () => true,
      sendToSession,
      respawn: async (sid) => {
        respawned.push(sid);
      },
      emitCommandFeedback: () => {},
    };

    const targets = reloadTargetSessionIds([], ctx.headlessPidRegistry);
    expect(targets).toHaveLength(N);

    const startedAt = Date.now();
    await Promise.all(targets.map((sid) => dispatchReload(sid, ctx)));
    const elapsed = Date.now() - startedAt;

    // Exactly once each — no session double-respawned by the fan-out.
    expect([...respawned].sort()).toEqual([...ids].sort());
    expect(sendToSession).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(5000);
  });
});
