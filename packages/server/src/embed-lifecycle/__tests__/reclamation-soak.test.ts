/**
 * Reclamation soak — the #383 goal (test-plan #P1).
 *
 * The real L2 soak (qa VM matrix) spawns N ephemeral `pi` sessions, leaves them
 * quiescent past the idle timeout, and asserts the aggregate `pi` process count
 * → 0 and aggregate RSS drops below a floor after one sweep. That real-RSS
 * measurement needs a live multi-pi runtime; here we prove the deterministic
 * INVARIANT that drives it: given N quiescent ephemeral sessions, one reaper
 * sweep reclaims ALL of them (terminate fired N times), so the live pi
 * process count collapses to zero — which is what makes the aggregate RSS fall.
 * See change: add-embed-session-lifecycle.
 */
import { DEFAULT_EMBED_LIFECYCLE } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import {
  createEmbedLifecycleController,
  type EmbedLifecycleControllerDeps,
} from "../embed-lifecycle-controller.js";

const NOW = Date.now();
const N = 35; // the reported regression: 35 accumulated sessions

function quiescentEphemeral(i: number): DashboardSession {
  return {
    id: `embed-${i}`,
    cwd: `/work/${i}`,
    source: "embed",
    lifecyclePolicy: "ephemeral",
    status: "idle",
    startedAt: NOW - 10_000_000,
    pid: 1000 + i,
    lastRunStartedAt: NOW - 9_000_000,
    lastSettledAt: NOW - 8_000_000, // settled ⇒ at rest
    currentTool: null,
    lastActivityAt: NOW - 8_000_000, // far past idle timeout
  } as DashboardSession;
}

describe("reclamation soak (P1 invariant)", () => {
  it("reaps ALL quiescent ephemeral sessions in one sweep → live count collapses to 0", async () => {
    // N ephemeral sessions + a few durable coding sessions that must survive.
    const sessions: DashboardSession[] = [
      ...Array.from({ length: N }, (_, i) => quiescentEphemeral(i)),
      { ...quiescentEphemeral(999), id: "human", lifecyclePolicy: "durable" } as DashboardSession,
    ];
    const killed = new Set<string>();

    const deps: EmbedLifecycleControllerDeps = {
      config: () => ({ ...DEFAULT_EMBED_LIFECYCLE, enabled: true, idleTimeoutSeconds: 1 }),
      // Live view: a killed session drops out of the active list (its runtime
      // ended), mirroring the real process exiting.
      listSessions: () => sessions.filter((s) => !killed.has(s.id)),
      getSubscriberCount: () => 0,
      listTerminalCwds: () => [],
      hasPendingUiRequest: () => false,
      terminate: async (id) => {
        killed.add(id);
        return { outcome: "confirmed-dead", terminated: true };
      },
      sendStopAfterTurn: () => true,
      probe: async () => ({ ok: true, childCount: 0, cpuPercent: 0 }),
    };
    const ctrl = createEmbedLifecycleController(deps);

    expect(ctrl.snapshot().activeEphemeral).toBe(N);

    await ctrl.reaper.sweepOnce();

    // Every ephemeral session reclaimed; the durable coding session survives.
    expect(killed.size).toBe(N);
    expect(killed.has("human")).toBe(false);
    // Live ephemeral process count collapses to zero (the RSS-drop driver).
    expect(ctrl.snapshot().activeEphemeral).toBe(0);
    expect(ctrl.snapshot().reaped.idle).toBe(N);
  });

  // P2 — a given-up session gets no further kill attempts (no latency assertion).
  it("stops attempting unconfirmed sessions after 3 sweeps (bounded retry)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sessions = Array.from({ length: 10 }, (_, i) => quiescentEphemeral(i));
    const terminate = vi.fn(async (): Promise<import("../../spawn-process/session-terminator.js").TerminateResult> => ({
      outcome: "unconfirmed",
      terminated: false,
      pid: 1,
    }));
    const ctrl = createEmbedLifecycleController({
      config: () => ({ ...DEFAULT_EMBED_LIFECYCLE, enabled: true, idleTimeoutSeconds: 1 }),
      listSessions: () => sessions,
      getSubscriberCount: () => 0,
      listTerminalCwds: () => [],
      hasPendingUiRequest: () => false,
      terminate,
      sendStopAfterTurn: () => true,
      probe: async () => ({ ok: true, childCount: 0, cpuPercent: 0 }),
    });
    const perSweep: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = terminate.mock.calls.length;
      await ctrl.reaper.sweepOnce();
      perSweep.push(terminate.mock.calls.length - before);
    }
    expect(perSweep).toEqual([10, 10, 10, 0, 0]);
    expect(ctrl.snapshot().failedReclaims).toBe(30);
    expect(ctrl.snapshot().reaped.idle).toBe(0);
    vi.restoreAllMocks();
  });
});
