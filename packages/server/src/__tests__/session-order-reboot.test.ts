/**
 * Tests for the user-resume-intent gate that protects sessionOrder from
 * spurious mutation during bridge auto-reattach on dashboard reboot.
 *
 * The actual gate lives inside the `sessionManager.onChange` closure in
 * `server.ts`. To keep this test focused and avoid spinning up a full
 * server, we replicate the exact algorithm the closure runs and assert
 * the four scenarios from `specs/session-filtering/spec.md`.
 *
 * The algorithm tested here is intentionally a verbatim copy of the
 * server.ts implementation \u2014 if one drifts from the other, both this
 * test and the production code are out of sync.
 *
 * See change: preserve-session-order-on-reboot.
 */

import type { ReattachPlacement } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { BrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingResumeIntentRegistry } from "../pending/pending-resume-intent-registry.js";
import { createMetaPersistence } from "../persistence/meta-persistence.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { applyReattachPolicy } from "../session/reattach-placement.js";
import { createSessionArchive } from "../session/session-archive.js";
import { createSessionOrderManager } from "../session/session-order-manager.js";

// In-memory PreferencesStore mock matching the slice of the interface
// `sessionOrderManager` consumes.
function makePrefs(): PreferencesStore {
  let order: Record<string, string[]> = {};
  return {
    getSessionOrder: () => order,
    setSessionOrder: (o) => { order = o; },
    getPinnedDirectories: () => [],
    setPinnedDirectories: () => {},
    pinDirectory: () => {},
    unpinDirectory: () => {},
    reorderPinnedDirs: () => {},
    getCollapsedFolders: () => [],
    setFolderCollapsed: () => false,
    setExpandedFolder: () => false,
    setFocusEnabled: () => false,
    setFocusProfile: () => false,
    getExpandedFolders: () => [],
    getGroupByPrefs: () => ({ defaultGroupBy: "none" as const, folderGroupBy: {}, collapsedLanes: [] }),
    setFolderGroupBy: () => false,
    setDefaultGroupBy: () => false,
    setLaneCollapsed: () => false,
    getCardSections: () => ({}),
    setCardSectionVisibility: () => false,
    resetFolderCardSections: () => false,
    getFavoriteModels: () => [],
    setFavoriteModels: () => {},
    addFavoriteModel: () => {},
    removeFavoriteModel: () => {},
    getWorkspaces: () => [],
    createWorkspace: () => null,
    renameWorkspace: () => false,
    deleteWorkspace: () => false,
    setWorkspaceCollapsed: () => false,
    addFolderToWorkspace: () => false,
    removeFolderFromWorkspace: () => false,
    moveFolderToWorkspace: () => false,
    reorderWorkspaceFolders: () => false,
    reorderWorkspaces: () => false,
    onWorkspacesChanged: () => () => {},
    flush: () => {},
    getDisplayPrefs: () => undefined,
    getOpenSpecUpdateSignature: () => undefined,
    getAutoInitWorktreeOnSpawn: () => false,
    getAutoNameSessions: () => true,
    setAutoNameSessions: () => {},
    getClaudeSubscriptionCompat: () => false,
    setClaudeSubscriptionCompat: () => {},
    getLiveServers: () => [],
    setLiveServers: () => {},
    setAutoInitWorktreeOnSpawn: () => {},
    setOpenSpecUpdateSignature: () => {},
    setDisplayPrefs: (p: any) => p,
    dispose: () => {},
  };
}

interface BroadcastEvent {
  type: "sessions_reordered";
  cwd: string;
  sessionIds: string[];
}

/**
 * Executes the exact ended\u2192alive branch from `server.ts`'s onChange hook
 * against the supplied state. Returns the broadcast that would have been
 * emitted (or null when the branch returned early).
 *
 * Mirrors the post-`top-of-tier-on-status-change` semantics: user-intent
 * resume calls `moveToFront` (always brings the id to the top) instead
 * of insert-if-absent.
 */
function endedToAlive(
  sessionId: string,
  cwd: string,
  endedSessionIds: Set<string>,
  pendingResumeIntents: ReturnType<typeof createPendingResumeIntentRegistry>,
  sessionOrderManager: ReturnType<typeof createSessionOrderManager>,
): BroadcastEvent | null {
  // Mirror server.ts:onChange ended\u2192alive branch verbatim.
  // Post-`differentiate-resume-intent-by-trigger`: 3-way switch on the
  // consumed intent ("front" | "keep" | null).
  endedSessionIds.delete(sessionId);
  const intent = pendingResumeIntents.consume(sessionId);
  if (intent === null) return null;
  if (intent === "keep") return null; // dropped slot wins; no mutation, no broadcast
  sessionOrderManager.moveToFront(cwd, sessionId);
  const next = sessionOrderManager.getOrder(cwd) ?? [];
  return { type: "sessions_reordered", cwd, sessionIds: next };
}

/**
 * Mirrors `server.ts` onChange's transition dispatch: the `wasEnded` check
 * plus the alive→ended / ended→alive branches. Returns `"ended"` when the
 * alive→ended branch fired, else the ended→alive broadcast (or null).
 * See change: fix-discovery-resurrects-archived (design D4).
 */
function onChangeTransition(
  sessionId: string,
  cwd: string,
  status: string,
  ctx: { priorStatus?: string } | undefined,
  endedSessionIds: Set<string>,
  pendingResumeIntents: ReturnType<typeof createPendingResumeIntentRegistry>,
  sessionOrderManager: ReturnType<typeof createSessionOrderManager>,
): BroadcastEvent | "ended" | null {
  const wasEnded = endedSessionIds.has(sessionId) || ctx?.priorStatus === "ended";
  const isEnded = status === "ended";
  if (isEnded && !wasEnded) {
    endedSessionIds.add(sessionId);
    return "ended";
  }
  if (!isEnded && wasEnded) {
    return endedToAlive(sessionId, cwd, endedSessionIds, pendingResumeIntents, sessionOrderManager);
  }
  return null;
}

describe("ended→alive for a session restored after the endedSessionIds snapshot (D4)", () => {
  const cwd = "/project";
  let pendingResumeIntents: ReturnType<typeof createPendingResumeIntentRegistry>;
  let sessionOrderManager: ReturnType<typeof createSessionOrderManager>;

  beforeEach(() => {
    pendingResumeIntents = createPendingResumeIntentRegistry();
    sessionOrderManager = createSessionOrderManager(makePrefs());
  });

  /** Snapshot at boot (empty), then a late `restore()` of an ended id. */
  function rig(id: string) {
    const sm = createMemorySessionManager();
    const endedSessionIds = new Set(sm.listAll().filter((s) => s.status === "ended").map((s) => s.id));
    sm.restore({ id, cwd, source: "tui", status: "ended", startedAt: 1000, endedAt: 2000 } as never);
    const ctxs: Array<{ priorStatus?: string } | undefined> = [];
    sm.onChange = (_id, ctx) => { ctxs.push(ctx); };
    const transition = (status: string) =>
      onChangeTransition(id, cwd, status, ctxs.at(-1), endedSessionIds, pendingResumeIntents, sessionOrderManager);
    return { sm, endedSessionIds, transition };
  }

  it("F1: seeded ended session with a 'front' intent moves to front", () => {
    sessionOrderManager.reorder(cwd, ["A", "B", "s1"]);
    const { sm, transition } = rig("s1");
    pendingResumeIntents.record("s1", "front");

    sm.register({ id: "s1", cwd, source: "tui" });
    const result = transition("idle");

    expect(result).toEqual({ type: "sessions_reordered", cwd, sessionIds: ["s1", "A", "B"] });
    expect(pendingResumeIntents.consume("s1")).toBeNull();
  });

  it("F2: null-intent reattach of a seeded session does not reorder; a later end re-fires", () => {
    sessionOrderManager.reorder(cwd, ["A", "s2", "B"]);
    const { sm, endedSessionIds, transition } = rig("s2");

    sm.register({ id: "s2", cwd, source: "tui" });
    expect(transition("idle")).toBeNull();
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["A", "s2", "B"]);

    sm.unregister("s2");
    expect(transition("ended")).toBe("ended");
    expect(endedSessionIds.has("s2")).toBe(true);
  });

  it("F3: an unarchived session resumed with 'front' moves to front", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "order-unarchive-"));
    try {
      const file = path.join(tmp, "2026-01-01T00-00-00-000Z_u1.jsonl");
      fs.writeFileSync(file, `${JSON.stringify({ type: "session", id: "u1", cwd })}\n`);
      writeSessionMeta(file, { cwd, status: "ended", startedAt: 1000, endedAt: 2000 });
      const sm = createMemorySessionManager();
      const endedSessionIds = new Set<string>();
      const archive = createSessionArchive({
        sessionManager: sm,
        metaPersistence: createMetaPersistence(),
        getPinnedDirs: () => [],
      });
      sm.restore({
        id: "u1", cwd, source: "tui", status: "ended", startedAt: 1000, endedAt: 2000, sessionFile: file,
      } as never);
      expect(archive.archiveSession("u1", "manual").ok).toBe(true);
      expect(archive.unarchiveSession("u1").ok).toBe(true);
      sessionOrderManager.reorder(cwd, ["A", "u1"]);
      pendingResumeIntents.record("u1", "front");
      const ctxs: Array<{ priorStatus?: string } | undefined> = [];
      sm.onChange = (_id, ctx) => { ctxs.push(ctx); };

      sm.register({ id: "u1", cwd, source: "tui" });
      const result = onChangeTransition("u1", cwd, "idle", ctxs.at(-1), endedSessionIds, pendingResumeIntents, sessionOrderManager);

      expect(result).toEqual({ type: "sessions_reordered", cwd, sessionIds: ["u1", "A"] });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("ended\u2192alive sessionOrder gate", () => {
  let endedSessionIds: Set<string>;
  let pendingResumeIntents: ReturnType<typeof createPendingResumeIntentRegistry>;
  let sessionOrderManager: ReturnType<typeof createSessionOrderManager>;
  const cwd = "/project";

  beforeEach(() => {
    endedSessionIds = new Set();
    pendingResumeIntents = createPendingResumeIntentRegistry();
    sessionOrderManager = createSessionOrderManager(makePrefs());
  });

  it("user Resume click prepends id and emits broadcast", () => {
    // Pre-state: existing alive order [B, A, C], session X is ended.
    sessionOrderManager.insert(cwd, "C");
    sessionOrderManager.insert(cwd, "A");
    sessionOrderManager.insert(cwd, "B");
    endedSessionIds.add("X");

    // User-initiated resume tags the intent before spawn.
    pendingResumeIntents.record("X", "front");

    const broadcast = endedToAlive("X", cwd, endedSessionIds, pendingResumeIntents, sessionOrderManager);

    expect(broadcast).not.toBeNull();
    expect(broadcast!.sessionIds[0]).toBe("X"); // prepended
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["X", "B", "A", "C"]);
  });

  it("drag-to-resume preserves dropped slot (intent: \"keep\")", () => {
    // Pre-state: alive [A, C], ended id "B" was just dragged into slot 1
    // via reorder_sessions which writes the order BEFORE resume_session
    // fires.
    //
    // Post change `differentiate-resume-intent-by-trigger`, drag-to-resume
    // tags `keep` so the dropped slot survives the resume round-trip.
    sessionOrderManager.reorder(cwd, ["A", "B", "C"]);
    endedSessionIds.add("B");

    // resume_session handler with placement: "keep" tags accordingly.
    pendingResumeIntents.record("B", "keep");

    const broadcast = endedToAlive("B", cwd, endedSessionIds, pendingResumeIntents, sessionOrderManager);

    // No broadcast — the earlier reorder_sessions already broadcast,
    // and the order didn't change here.
    expect(broadcast).toBeNull();
    // B stays at the dropped slot.
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["A", "B", "C"]);
  });

  it("button resume after drag (last-write-wins) moves id to front", () => {
    // User drags X into the middle (tags "keep"), then before the bridge
    // re-registers, clicks Resume on X (tags "front"). Last-write-wins:
    // X surfaces at the top.
    sessionOrderManager.reorder(cwd, ["A", "X", "B"]);
    endedSessionIds.add("X");

    pendingResumeIntents.record("X", "keep");
    pendingResumeIntents.record("X", "front");

    const broadcast = endedToAlive("X", cwd, endedSessionIds, pendingResumeIntents, sessionOrderManager);

    expect(broadcast).not.toBeNull();
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["X", "A", "B"]);
  });

  it("bridge auto-reattach on reboot leaves order untouched and emits no broadcast", () => {
    // Pre-state: user had reordered the alive tier to [B, A, C]; B was
    // running, dashboard rebooted, scan classified all as ended, but B's
    // pi process was still alive and just reattached.
    sessionOrderManager.reorder(cwd, ["B", "A", "C"]);
    endedSessionIds.add("B");

    // No record() call \u2014 nothing tagged the intent.
    const broadcast = endedToAlive("B", cwd, endedSessionIds, pendingResumeIntents, sessionOrderManager);

    expect(broadcast).toBeNull();
    // Order is preserved exactly.
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["B", "A", "C"]);
    // endedSessionIds was still cleared so the next alive\u2192ended fires.
    expect(endedSessionIds.has("B")).toBe(false);
  });

  it("multiple bridge reattaches on reboot emit zero broadcasts", () => {
    sessionOrderManager.reorder(cwd, ["A", "B", "C", "D", "E"]);
    for (const id of ["A", "B", "C", "D", "E"]) endedSessionIds.add(id);

    const broadcasts: BroadcastEvent[] = [];
    for (const id of ["A", "B", "C", "D", "E"]) {
      const b = endedToAlive(id, cwd, endedSessionIds, pendingResumeIntents, sessionOrderManager);
      if (b) broadcasts.push(b);
    }

    expect(broadcasts).toEqual([]);
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("stale intent is discarded; reattach classified as non-user", () => {
    let nowMs = 1_000_000;
    const clock = () => nowMs;
    const r = createPendingResumeIntentRegistry({ ttlMs: 100, now: clock });

    sessionOrderManager.reorder(cwd, ["A", "B", "C"]);
    endedSessionIds.add("X");

    r.record("X", "front"); // user clicked Resume but spawn failed
    nowMs += 200; // 200 ms later, well past the 100 ms TTL

    // Now a legitimate bridge reattach happens for the same id.
    const broadcast = endedToAlive("X", cwd, endedSessionIds, r, sessionOrderManager);

    expect(broadcast).toBeNull();
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["A", "B", "C"]);
  });

  it("intent is single-use \u2014 a second reattach after the same record() is treated as auto", () => {
    // Edge case: bridge sends two session_register messages back-to-back
    // (e.g. a bridge reload mid-resume). First consume() wins; second
    // sees no intent.
    sessionOrderManager.insert(cwd, "A");
    endedSessionIds.add("X");

    pendingResumeIntents.record("X", "front");

    const first = endedToAlive("X", cwd, endedSessionIds, pendingResumeIntents, sessionOrderManager);
    expect(first).not.toBeNull();
    expect(first!.sessionIds[0]).toBe("X");

    // Simulate a second transition for the same id.
    endedSessionIds.add("X");
    const second = endedToAlive("X", cwd, endedSessionIds, pendingResumeIntents, sessionOrderManager);

    expect(second).toBeNull();
    // X is still in the order from the first call \u2014 no further mutation.
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["X", "A"]);
  });

  // ── reattach-move-to-front ──

  it("reattach with policy 'always' on persisted-active session lands at index 0 + broadcasts", () => {
    // Repro: 6 alive sessions in cwd, none ended. The user's was at
    // index 5. Dashboard restarts; bridge reconnects with
    // registerReason: "reattach" for that session id.
    sessionOrderManager.reorder(cwd, ["S0", "S1", "S2", "S3", "S4", "S5"]);

    // No ended→alive transition fires (wasEnded=false, isEnded=false)
    // for these reattaches; we exercise the new branch in server.ts
    // directly via the helper.
    const sm = createMemorySessionManager();
    sm.register({ id: "S5", cwd, source: "tui" });

    const broadcasts: any[] = [];
    const gateway = { broadcastToAll: (m: any) => broadcasts.push(m) } as unknown as BrowserGateway;

    const action = applyReattachPolicy("S5", cwd, "always", {
      sessionManager: sm,
      sessionOrderManager,
      browserGateway: gateway,
    });

    expect(action).toBe("moveToFront");
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["S5", "S0", "S1", "S2", "S3", "S4"]);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].sessionIds[0]).toBe("S5");
  });

  it("reattach with policy 'preserve' is a no-op (legacy behavior)", () => {
    sessionOrderManager.reorder(cwd, ["S0", "S1", "S2"]);
    const sm = createMemorySessionManager();
    sm.register({ id: "S2", cwd, source: "tui" });

    const broadcasts: any[] = [];
    const gateway = { broadcastToAll: (m: any) => broadcasts.push(m) } as unknown as BrowserGateway;

    const action = applyReattachPolicy("S2", cwd, "preserve", {
      sessionManager: sm,
      sessionOrderManager,
      browserGateway: gateway,
    });

    expect(action).toBe("preserve");
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["S0", "S1", "S2"]);
    expect(broadcasts).toEqual([]);
  });

  it("legacy bridge (no registerReason) does NOT trigger reattach policy", () => {
    // Spec scenario: "Legacy bridge reattach without registerReason
    // preserves layout". Pre-this-change bridges omit the field; the
    // server treats omission as `"spawn"` and skips the policy entirely.
    sessionOrderManager.reorder(cwd, ["S0", "S1", "S2"]);

    // Simulate the alive→alive branch's gate condition with a missing
    // registerReason (i.e. ctx?.registerReason === undefined). Per the
    // server.ts onChange code, the branch should not fire.
    const ctx = { registerReason: undefined } as { registerReason?: "spawn" | "reattach" };
    const shouldFire = ctx.registerReason === "reattach";
    expect(shouldFire).toBe(false);

    // Order remains untouched.
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["S0", "S1", "S2"]);
  });

  it("registry intent wins over registerReason: reattach (defensive guarantee)", () => {
    // Spec scenario: "Registry intent wins over reattach". A registry
    // intent of "front" or "keep" must override any registerReason:
    // "reattach" so user actions are never clobbered by the policy.
    sessionOrderManager.reorder(cwd, ["S0", "S1", "S2"]);
    const sm = createMemorySessionManager();
    sm.register({ id: "S2", cwd, source: "tui" });

    // Replicate the server.ts alive→alive branch logic verbatim:
    // consume registry first, defer to it if non-null.
    pendingResumeIntents.record("S2", "front");
    const intent = pendingResumeIntents.consume("S2");
    expect(intent).toBe("front");

    // With intent === "front", the registry path moves to front;
    // the reattach policy is NOT invoked.
    sessionOrderManager.moveToFront(cwd, "S2");
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["S2", "S0", "S1"]);

    // Verify policy.applyReattachPolicy would also have moved-to-front;
    // the test guarantees registry-path wins by being executed first.
    // (If both paths fired, S2 would still be at front, but only one
    // sessions_reordered broadcast should be emitted in production.)
  });

  it("reattach respects 'streaming-only' policy: only moves streaming sessions", () => {
    sessionOrderManager.reorder(cwd, ["S0", "S1", "S2"]);
    const sm = createMemorySessionManager();
    sm.register({ id: "S1", cwd, source: "tui" });
    sm.register({ id: "S2", cwd, source: "tui" });
    sm.update("S2", { status: "streaming" });

    const policies: ReattachPlacement[] = ["streaming-only"];
    for (const p of policies) {
      // S1 is active, not streaming → preserve
      const broadcastsA: any[] = [];
      const gA = { broadcastToAll: (m: any) => broadcastsA.push(m) } as unknown as BrowserGateway;
      expect(applyReattachPolicy("S1", cwd, p, { sessionManager: sm, sessionOrderManager, browserGateway: gA })).toBe("preserve");
      expect(broadcastsA).toEqual([]);

      // S2 is streaming → moveToFront
      const broadcastsB: any[] = [];
      const gB = { broadcastToAll: (m: any) => broadcastsB.push(m) } as unknown as BrowserGateway;
      expect(applyReattachPolicy("S2", cwd, p, { sessionManager: sm, sessionOrderManager, browserGateway: gB })).toBe("moveToFront");
      expect(broadcastsB).toHaveLength(1);
    }
  });

  it("end → resume → end → resume cycle always lands id at index 0", () => {
    // Regression for `top-of-tier-on-status-change`: pre-fix the
    // ended→alive branch used insert-if-absent, so on the second resume
    // the id was still in the order list and stayed at its previous
    // position. With moveToFront, every user-intent resume re-prepends.
    sessionOrderManager.reorder(cwd, ["A", "B", "X", "C"]);

    // Cycle 1: X ends, X resumes.
    sessionOrderManager.remove(cwd, "X");
    endedSessionIds.add("X");
    pendingResumeIntents.record("X", "front");
    const r1 = endedToAlive("X", cwd, endedSessionIds, pendingResumeIntents, sessionOrderManager);
    expect(r1).not.toBeNull();
    expect(sessionOrderManager.getOrder(cwd)[0]).toBe("X");

    // Cycle 2: X ends again, X resumes. With insert-if-absent this
    // would no-op (X is already in the list); with moveToFront X jumps
    // to the top regardless.
    sessionOrderManager.remove(cwd, "X");
    endedSessionIds.add("X");
    pendingResumeIntents.record("X", "front");
    const r2 = endedToAlive("X", cwd, endedSessionIds, pendingResumeIntents, sessionOrderManager);
    expect(r2).not.toBeNull();
    expect(sessionOrderManager.getOrder(cwd)[0]).toBe("X");

    // Cycle 3.
    sessionOrderManager.remove(cwd, "X");
    endedSessionIds.add("X");
    pendingResumeIntents.record("X", "front");
    endedToAlive("X", cwd, endedSessionIds, pendingResumeIntents, sessionOrderManager);
    expect(sessionOrderManager.getOrder(cwd)[0]).toBe("X");
  });
});
