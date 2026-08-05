/**
 * Controller integration (test-plan #E21, #E22, #E1): the wired reaper reclaims
 * an idle ephemeral session end-to-end through the controller, the diagnostics
 * snapshot reports active/idle + reaped-by-reason (the /api/health surface), and
 * the whole thing is dormant when disabled.
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

function ephemeral(over: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "e1",
    cwd: "/work",
    source: "embed",
    lifecyclePolicy: "ephemeral",
    status: "idle",
    startedAt: NOW - 10_000_000,
    pid: 100,
    lastRunStartedAt: NOW - 9_000_000,
    lastSettledAt: NOW - 8_000_000,
    currentTool: null,
    lastActivityAt: NOW - 8_000_000,
    ...over,
  } as DashboardSession;
}

function makeController(
  sessions: DashboardSession[],
  enabled: boolean,
  kills: string[],
): ReturnType<typeof createEmbedLifecycleController> {
  const deps: EmbedLifecycleControllerDeps = {
    config: () => ({ ...DEFAULT_EMBED_LIFECYCLE, enabled, idleTimeoutSeconds: 1 }),
    listSessions: () => sessions,
    getSubscriberCount: () => 0,
    listTerminalCwds: () => [],
    hasPendingUiRequest: () => false,
    killBySessionId: async (id) => {
      kills.push(id);
      return true;
    },
    sendStopAfterTurn: vi.fn(),
    probe: async () => ({ ok: true, childCount: 0, cpuPercent: 0 }),
  };
  return createEmbedLifecycleController(deps);
}

describe("embed lifecycle controller", () => {
  // E1 / E12 / E21 — enabled: sweep reaps the idle ephemeral session and the
  // snapshot records it under reaped.idle.
  it("reaps an idle ephemeral session and records it in the snapshot", async () => {
    const kills: string[] = [];
    const ctrl = makeController([ephemeral()], true, kills);
    expect(ctrl.snapshot().activeEphemeral).toBe(1);
    expect(ctrl.snapshot().idleEphemeral).toBe(1);

    await ctrl.reaper.sweepOnce();
    expect(kills).toEqual(["e1"]);
    expect(ctrl.snapshot().reaped.idle).toBe(1);
  });

  // E22 — disabled: dormant, nothing reaped, but the snapshot still resolves.
  it("is dormant when disabled and still exposes a snapshot", async () => {
    const kills: string[] = [];
    const ctrl = makeController([ephemeral()], false, kills);
    await ctrl.reaper.sweepOnce();
    expect(kills).toEqual([]);
    expect(ctrl.snapshot().reaped).toEqual({ idle: 0, "stop-after-turn": 0, phantom: 0 });
  });

  // A durable session is never counted as ephemeral in the diagnostics.
  it("excludes durable sessions from the active-ephemeral count", () => {
    const ctrl = makeController([ephemeral({ lifecyclePolicy: "durable" })], true, []);
    expect(ctrl.snapshot().activeEphemeral).toBe(0);
  });
});

/**
 * Pending-ask union (test-plan #X9–#X12): the reaper's `hasPendingAsk` is the
 * union of the extension-UI registry and the PromptBus registry. Without the
 * union a PromptBus-blocked session is invisible to the reaper and can be
 * phantom-reaped, violating embed-session-lifecycle's existing
 * "ask_user-blocked session is never phantom-reaped".
 *
 * See change: restore-ask-user-tool-state-on-reconnect (D5).
 */
describe("embed lifecycle controller — pending-ask union", () => {
  function makeUnionController(opts: {
    sessions: DashboardSession[];
    kills: string[];
    hasPendingUiRequest?: boolean;
    hasPendingPromptRequests?: (id: string) => boolean;
  }) {
    const deps: EmbedLifecycleControllerDeps = {
      config: () => ({ ...DEFAULT_EMBED_LIFECYCLE, enabled: true, idleTimeoutSeconds: 1 }),
      listSessions: () => opts.sessions,
      getSubscriberCount: () => 0,
      listTerminalCwds: () => [],
      hasPendingUiRequest: () => opts.hasPendingUiRequest ?? false,
      ...(opts.hasPendingPromptRequests
        ? { hasPendingPromptRequests: opts.hasPendingPromptRequests }
        : {}),
      killBySessionId: async (id) => {
        opts.kills.push(id);
        return true;
      },
      sendStopAfterTurn: vi.fn(),
      probe: async () => ({ ok: true, childCount: 0, cpuPercent: 0 }),
    };
    return createEmbedLifecycleController(deps);
  }

  // #X9 — an at-rest ephemeral session past the idle timeout with a PromptBus
  // prompt tracked is vetoed even though `currentTool` is null, proving the
  // veto does not ride on the derivation.
  it("#X9 does not reap an idle session held only by a PromptBus prompt", async () => {
    const kills: string[] = [];
    const ctrl = makeUnionController({
      sessions: [ephemeral({ currentTool: null })],
      kills,
      hasPendingUiRequest: false,
      hasPendingPromptRequests: () => true,
    });
    await ctrl.reaper.sweepOnce();
    expect(kills).toEqual([]);
  });

  // #X10 — the streaming gear reads `hasPendingAsk` and never `currentTool`,
  // so the phantom-reap path is only closed by the union itself.
  it("#X10 does not phantom-reap a streaming session held by a PromptBus prompt", async () => {
    const kills: string[] = [];
    const ctrl = makeUnionController({
      sessions: [
        ephemeral({
          status: "streaming",
          currentTool: null,
          lastRunStartedAt: NOW - 9_000_000,
          lastActivityAt: NOW - 9_000_000,
        }),
      ],
      kills,
      hasPendingUiRequest: false,
      hasPendingPromptRequests: () => true,
    });
    await ctrl.reaper.sweepOnce();
    expect(kills).toEqual([]);
  });

  // #X11 — a session held only by an extension-UI request behaves exactly as
  // it did before the union.
  it("#X11 still vetoes on an extension-UI request alone", async () => {
    const kills: string[] = [];
    const ctrl = makeUnionController({
      sessions: [ephemeral()],
      kills,
      hasPendingUiRequest: true,
      hasPendingPromptRequests: () => false,
    });
    await ctrl.reaper.sweepOnce();
    expect(kills).toEqual([]);
  });

  // #X12 — neither registry populated: verdicts identical to pre-change, i.e.
  // the idle session is still reclaimed. This is the guard that the union did
  // not turn into a blanket veto.
  it("#X12 reaps normally when neither registry is populated", async () => {
    const kills: string[] = [];
    const ctrl = makeUnionController({
      sessions: [ephemeral()],
      kills,
      hasPendingUiRequest: false,
      hasPendingPromptRequests: () => false,
    });
    await ctrl.reaper.sweepOnce();
    expect(kills).toEqual(["e1"]);
  });

  // The dep is optional for callers that predate the union; omitting it must
  // fall back to the extension-UI registry alone rather than throwing.
  it("#X12 treats an absent hasPendingPromptRequests dep as false", async () => {
    const kills: string[] = [];
    const ctrl = makeUnionController({ sessions: [ephemeral()], kills });
    await ctrl.reaper.sweepOnce();
    expect(kills).toEqual(["e1"]);
  });
});
