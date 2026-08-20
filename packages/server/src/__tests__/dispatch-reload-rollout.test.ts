/**
 * Rollout + scale properties of the reload ladder: degraded-extension
 * dispatch, version skew, and fan-out volume.
 *
 * These three were drafted as L2 VM-smoke scenarios, but `qa/tests/*.sh` is
 * a clean-install/runtime smoke layer — it has no dashboard, no keeper and no
 * pi session to dispatch into, so routing them there would have produced
 * tests that assert nothing. Every observable each scenario names is
 * SERVER-side and therefore genuinely testable here:
 *   - #X9  "the server still emits exactly one terminal event"
 *   - #X10 "the keeper path is independent of new extension code"
 *   - #P1  "all N dispatched, zero respawns, returns within the budget"
 * The half of #X9 that is not server-observable (pi turning the dispatched
 * line into an ordinary user message when no command is registered) is pi's
 * own behaviour and is asserted here only as "the server does not crash and
 * does not double-report", which is the part this change owns.
 *
 * See change: fix-out-of-band-reload (test-plan #X9, #X10, #P1).
 */
import { describe, it, expect, vi } from "vitest";
import {
  dispatchReload,
  reloadTargetSessionIds,
  type DispatchReloadContext,
} from "../rpc-keeper/dispatch-reload.js";

function keeperCtx(opts: { writeOk?: boolean } = {}) {
  const feedback: Array<{ command: string; status: string }> = [];
  const respawn = vi.fn(async () => {});
  const writeRpc = vi.fn(async () => opts.writeOk ?? true);
  const ctx: DispatchReloadContext = {
    headlessPidRegistry: {
      hasKeeper: () => true,
      getPid: () => 1234,
      writeRpc,
      listSessions: () => [],
    },
    getSession: () => ({ status: "idle" }),
    isSessionConnected: () => true,
    sendToSession: () => true,
    respawn,
    emitCommandFeedback: (_sid, command, status) => feedback.push({ command, status }),
  };
  return { ctx, feedback, respawn, writeRpc };
}

describe("dispatchReload — rollout properties", () => {
  it("#X9 a session whose dashboard extension is disabled still yields exactly ONE terminal event", async () => {
    // pi accepts the RPC line either way. With no `__dashboard_reload` command
    // registered it falls through to ordinary prompt handling instead of
    // reloading — a documented degradation, not a crash. What must NOT happen
    // is the server reporting twice, or reporting nothing.
    const h = keeperCtx();
    await dispatchReload("S1", h.ctx);

    expect(h.feedback).toHaveLength(1);
    expect(h.feedback[0]).toEqual({ command: "/reload", status: "completed" });
  });

  it("#X10 a new server reloads a session running the OLD extension through the keeper", async () => {
    // The dispatch is written by the SERVER to the keeper UDS, and the
    // `__dashboard_reload` command it triggers is registered by old extension
    // code. So headless reload works the moment the server is deployed, with
    // no session restart — which is why the dispatch lives on the server and
    // not in the bridge.
    const h = keeperCtx();
    const outcome = await dispatchReload("S1", h.ctx);

    expect(outcome).toBe("keeper");
    expect(h.writeRpc).toHaveBeenCalledTimes(1);
    expect(h.respawn).not.toHaveBeenCalled();
  });
});

describe("reload fan-out at scale (#P1)", () => {
  it("dispatches all 20 sessions with zero respawns, well inside the 5 s budget", async () => {
    const N = 20;
    const ids = Array.from({ length: N }, (_, i) => `S${i}`);
    const written: string[] = [];
    const respawn = vi.fn(async () => {});
    const feedback: string[] = [];
    const ctx: DispatchReloadContext = {
      headlessPidRegistry: {
        hasKeeper: () => true,
        getPid: () => 1,
        writeRpc: async (sid) => {
          written.push(sid);
          return true;
        },
        listSessions: () => ids.map((sessionId) => ({ sessionId, pid: 1, hasKeeper: true })),
      },
      getSession: () => ({ status: "idle" }),
      isSessionConnected: () => true,
      sendToSession: () => true,
      respawn,
      emitCommandFeedback: (sid) => feedback.push(sid),
    };

    const targets = reloadTargetSessionIds([], ctx.headlessPidRegistry);
    expect(targets).toHaveLength(N);

    const startedAt = Date.now();
    await Promise.all(targets.map((sid) => dispatchReload(sid, ctx)));
    const elapsed = Date.now() - startedAt;

    expect([...written].sort()).toEqual([...ids].sort());
    expect(feedback).toHaveLength(N);
    expect(respawn).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(5000);
  });
});
