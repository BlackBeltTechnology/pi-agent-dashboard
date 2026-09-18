/**
 * Test-plan #X1 — a shed host-pressure frame is a DEBT, not a loss.
 * See change: fix-false-unresponsive-badge (task 6.2).
 *
 * `hostPressure` is pushed on a state TRANSITION only, which is what makes a
 * healthy session cost zero frames — and also what makes a shed frame
 * unrecoverable on its own: there is no successor frame to correct it. A
 * recovery (`hostPressure: null`) shed by a saturated socket would therefore
 * leave the badge lit until the browser reconnects.
 *
 * The status-reconcile debt register already rebuilds a shed `session_updated`
 * from `sessionManager.get(id)`; these tests pin that the rebuild CARRIES
 * `hostPressure`, with the same load-bearing `?? null` clearing semantics as
 * `currentTool` (an omitted key is dropped by `JSON.stringify` and the client
 * merges with `{ ...existing, ...updates }`, so it would PRESERVE the stale
 * verdict).
 *
 * Harness glue copied from `browser-gateway-dropped-frames.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { asWs, attachCapturedWs, buildDebtGateway, TEST_MAX_WS_BUFFER } from "./helpers/status-debt-fixtures.js";

describe("host-pressure survives a shed frame via the status-reconcile debt (X1)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rebuilds a shed RECOVERY as hostPressure: null, so the badge clears without a reconnect", () => {
    const { gateway, manager } = buildDebtGateway(["s1"]);
    // The session was pressured, then recovered: the live row carries no verdict.
    manager.update("s1", { status: "streaming", hostPressure: { state: "unresponsive", since: 1 } });
    const client = attachCapturedWs(gateway);
    client.saturate();

    manager.update("s1", { status: "streaming", hostPressure: null });
    gateway.broadcastSessionUpdated("s1", { hostPressure: null });
    expect(client.statusFrames()).toHaveLength(0); // shed

    client.drain();
    vi.advanceTimersByTime(250);

    const delivered = client.statusFrames();
    expect(delivered).toHaveLength(1);
    // Present as an EXPLICIT null: an omitted key would preserve the stale pill.
    expect("hostPressure" in delivered[0].updates).toBe(true);
    expect(delivered[0].updates.hostPressure).toBeNull();
  });

  it("rebuilds from the LIVE row, so a still-pressured session reconciles to its current verdict", () => {
    const { gateway, manager } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.saturate();

    // Shed the degraded raise; the server escalates while the socket is stuck.
    manager.update("s1", { hostPressure: { state: "degraded", since: 1_000 } });
    gateway.broadcastSessionUpdated("s1", { hostPressure: { state: "degraded", since: 1_000 } });
    manager.update("s1", { hostPressure: { state: "unresponsive", since: 1_000 } });

    client.drain();
    vi.advanceTimersByTime(250);

    const delivered = client.statusFrames();
    expect(delivered).toHaveLength(1);
    // Current state, not the shed payload.
    expect(delivered[0].updates.hostPressure).toEqual({ state: "unresponsive", since: 1_000 });
  });

  it("reconciles a never-pressured session to null rather than omitting the key", () => {
    const { gateway } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.saturate();

    gateway.broadcastSessionUpdated("s1", { status: "idle" });
    client.drain();
    vi.advanceTimersByTime(250);

    const delivered = client.statusFrames();
    expect(delivered).toHaveLength(1);
    expect(delivered[0].updates.hostPressure).toBeNull();
  });
});

// ── `sessions_reordered` defers as state-class: latest-wins per cwd ──────
// See change: close-registry-frame-shed-gaps (D1, test-plan #E3).

describe("deferred sessions_reordered is state-class, latest-wins per cwd (E3)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a saturated socket receives exactly ONE reorder per cwd, carrying the last ordering (E3)", () => {
    const { gateway } = buildDebtGateway(["a", "b", "c"]);
    const client = attachCapturedWs(gateway);
    client.saturate();

    gateway.broadcastToAll({ type: "sessions_reordered", cwd: "/repoA", sessionIds: ["a", "b"] });
    gateway.broadcastToAll({ type: "sessions_reordered", cwd: "/repoA", sessionIds: ["b", "a"] });
    gateway.broadcastToAll({ type: "sessions_reordered", cwd: "/repoA", sessionIds: ["a", "b"] });
    gateway.broadcastToAll({ type: "sessions_reordered", cwd: "/repoB", sessionIds: ["c"] });

    // Reorders are STATE-class: retained, never shed.
    expect(gateway.getDroppedFrameStats().total).toBe(0);

    client.drain();
    vi.advanceTimersByTime(250);

    const reorders = client.framesOfType<{ type: string; cwd: string; sessionIds: string[] }>("sessions_reordered");
    expect(reorders).toHaveLength(2);
    expect(reorders.find((r) => r.cwd === "/repoA")?.sessionIds).toEqual(["a", "b"]);
    expect(reorders.find((r) => r.cwd === "/repoB")?.sessionIds).toEqual(["c"]);
  });
});

// ── Debt register: LWW kind precedence, `sawAdd`, ordered flush dispatch ──
// See change: close-registry-frame-shed-gaps (D2, test-plan #E4–#E15).

describe("registry debt register — kinds + flush dispatch (D2)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Record one kind for `id` by shedding its real registry frame. */
  function shedKind(gateway: ReturnType<typeof buildDebtGateway>["gateway"], kind: "updated" | "added" | "removed", id = "s1") {
    if (kind === "updated") gateway.broadcastSessionUpdated(id, { status: "streaming" });
    else if (kind === "added") gateway.broadcastSessionAdded({ id, cwd: "/repo/a" });
    else gateway.broadcastSessionRemoved(id);
  }

  it("kind precedence is LWW, and `updated` never downgrades a lifecycle kind (E4)", () => {
    const kinds = ["updated", "added", "removed"] as const;
    const expected: Record<(typeof kinds)[number], Record<(typeof kinds)[number], string>> = {
      updated: { updated: "updated", added: "added", removed: "removed" },
      added: { updated: "added", added: "added", removed: "removed" },
      removed: { updated: "removed", added: "added", removed: "removed" },
    };

    for (const pre of kinds) {
      for (const next of kinds) {
        const { gateway } = buildDebtGateway(["s1"]);
        const client = attachCapturedWs(gateway);
        client.saturate();
        shedKind(gateway, pre);
        shedKind(gateway, next);

        const entry = gateway.getStatusReconcileInfo(asWs(client.ws))!.entries.find((e) => e.id === "s1");
        expect(entry?.kind, `${pre} then ${next}`).toBe(expected[pre][next]);
      }
    }
  });

  it("`sawAdd` survives a kind supersede (E11)", () => {
    const { gateway } = buildDebtGateway(["s7"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    shedKind(gateway, "added", "s7");
    shedKind(gateway, "removed", "s7");

    const entry = gateway.getStatusReconcileInfo(asWs(client.ws))!.entries.find((e) => e.id === "s7");
    expect(entry?.kind).toBe("removed");
    expect(entry?.sawAdd).toBe(true);
  });

  it("a shed `session_added`'s spawnRequestId survives a kind supersede and rides the reconciled add", () => {
    // Regression: the add's correlation id was dropped when a shed `removed`
    // superseded it, so the sawAdd-branch reconcile emitted a reconciled add
    // with NO correlation id — the client's exact-match cleanup could not fire
    // and the spawning placeholder had to wait out the generic timeout.
    const { gateway, manager } = buildDebtGateway(["s7"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    // Both frames shed before any DELIVERED lifecycle frame could clear the debt.
    gateway.broadcastSessionAdded({ id: "s7", cwd: "/repo/a" }, { spawnRequestId: "r1" });
    manager.unregister("s7");
    gateway.broadcastSessionRemoved("s7");

    const entry = gateway.getStatusReconcileInfo(asWs(client.ws))!.entries.find((e) => e.id === "s7");
    expect(entry?.kind).toBe("removed");
    expect(entry?.sawAdd).toBe(true);
    expect(entry?.spawnRequestId).toBe("r1");

    client.drain();
    vi.advanceTimersByTime(250);

    const added = client.framesOfType<{
      type: string;
      reconciled?: boolean;
      spawnRequestId?: string;
    }>("session_added");
    expect(added).toHaveLength(1);
    expect(added[0].reconciled).toBe(true);
    expect(added[0].spawnRequestId).toBe("r1");
  });

  it("flush: owed `removed`, no record → session_removed (E5)", () => {
    const { gateway, manager } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    shedKind(gateway, "removed");
    manager.remove("s1");

    client.drain();
    vi.advanceTimersByTime(250);

    const removed = client.framesOfType<{ type: string; sessionId: string }>("session_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].sessionId).toBe("s1");
    expect(client.framesOfType("session_added")).toHaveLength(0);
  });

  it("flush: owed `removed` whose record is live again → reconciled add, no removal (E6)", () => {
    const { gateway, manager } = buildDebtGateway(["s2"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    manager.unregister("s2");
    shedKind(gateway, "removed", "s2");
    // Re-registered while the removal is owed: `register()` sets status active.
    manager.register({ id: "s2", cwd: "/repo/a", source: "tui" });

    client.drain();
    vi.advanceTimersByTime(250);

    const added = client.framesOfType<{ type: string; session: { id: string; status: string }; reconciled?: boolean }>("session_added");
    expect(added).toHaveLength(1);
    expect(added[0].session.id).toBe("s2");
    expect(added[0].session.status).not.toBe("ended");
    expect(added[0].reconciled).toBe(true);
    expect(client.framesOfType("session_removed")).toHaveLength(0);
  });

  it("flush: owed `removed`, record ended, `sawAdd` true → reconciled ended add (E7)", () => {
    const { gateway, manager } = buildDebtGateway(["s3"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    shedKind(gateway, "added", "s3");
    manager.unregister("s3");
    shedKind(gateway, "removed", "s3");

    client.drain();
    vi.advanceTimersByTime(250);

    const added = client.framesOfType<{ type: string; session: { id: string; status: string }; reconciled?: boolean }>("session_added");
    expect(added).toHaveLength(1);
    expect(added[0].session.id).toBe("s3");
    expect(added[0].session.status).toBe("ended");
    expect(added[0].reconciled).toBe(true);
    expect(client.framesOfType("session_removed")).toHaveLength(0);
  });

  it("flush: owed `removed`, record ended, no shed add → session_removed (E8)", () => {
    const { gateway, manager } = buildDebtGateway(["s4"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    manager.unregister("s4");
    shedKind(gateway, "removed", "s4");

    client.drain();
    vi.advanceTimersByTime(250);

    const removed = client.framesOfType<{ type: string; sessionId: string }>("session_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].sessionId).toBe("s4");
    expect(client.statusFrames()).toHaveLength(0);
    expect(client.framesOfType("session_added")).toHaveLength(0);
  });

  it("flush: owed `added` → reconciled current record + spawnRequestId (E9)", () => {
    const { gateway, manager } = buildDebtGateway(["s5"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    gateway.broadcastSessionAdded({ id: "s5", cwd: "/repo/a", model: "m1" }, { spawnRequestId: "r1" });
    // Move the record on so the rebuild is provably CURRENT, not the shed payload.
    manager.update("s5", { status: "streaming", model: "m2" });

    client.drain();
    vi.advanceTimersByTime(250);

    const added = client.framesOfType<{ type: string; session: { id: string; model?: string }; spawnRequestId?: string; reconciled?: boolean }>("session_added");
    expect(added).toHaveLength(1);
    expect(added[0].session.id).toBe("s5");
    expect(added[0].session.model).toBe("m2");
    expect(added[0].spawnRequestId).toBe("r1");
    expect(added[0].reconciled).toBe(true);
  });

  it("flush: owed `updated` carries currentTool:null and hostPressure:null, not undefined (E10)", () => {
    const { gateway, manager } = buildDebtGateway(["s6"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    manager.update("s6", { status: "idle", currentTool: "Agent" });
    gateway.broadcastSessionUpdated("s6", { status: "streaming", currentTool: "Agent" });
    // The tool finished and the pressure cleared while the socket was stuck.
    manager.update("s6", { status: "streaming", currentTool: undefined, hostPressure: undefined });

    client.drain();
    vi.advanceTimersByTime(250);

    const delivered = client.statusFrames();
    expect(delivered).toHaveLength(1);
    expect(delivered[0].updates.status).toBe("streaming");
    expect("currentTool" in delivered[0].updates).toBe(true);
    expect(delivered[0].updates.currentTool).toBeNull();
    expect("hostPressure" in delivered[0].updates).toBe(true);
    expect(delivered[0].updates.hostPressure).toBeNull();
  });

  it("flush: an archived (record-gone) session reconciles as removed (E15)", () => {
    const { gateway, manager } = buildDebtGateway(["s8"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    gateway.broadcastSessionUpdated("s8", { status: "streaming" });
    // Archive evicts the record entirely (`remove`), so the reconcile has nothing
    // to rebuild from — the spec treats that as a removal, not a silent no-op.
    manager.remove("s8");

    client.drain();
    vi.advanceTimersByTime(250);

    const removed = client.framesOfType<{ type: string; sessionId: string }>("session_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].sessionId).toBe("s8");
  });

  it("a shed reconcile re-records for EVERY kind and retries on a later drain (X1)", () => {
    const { gateway, manager } = buildDebtGateway(["sA", "sB"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    // Owe `added` for sA; owe `removed` for sB (ended, no shed add).
    shedKind(gateway, "added", "sA");
    manager.unregister("sB");
    shedKind(gateway, "removed", "sB");

    // The threshold re-crosses between the flush loop's under-threshold check
    // and `sendTo`'s own check — the exact race the reconcile must survive.
    // Read pattern per attempted-but-shed entry: pre-check (under), sendTo (over),
    // recordDroppedFrame (under). So every 3rd read starting at index 1 is over.
    let reads = 0;
    Object.defineProperty(client.ws, "bufferedAmount", {
      configurable: true,
      get: () => (reads++ % 3 === 1 ? TEST_MAX_WS_BUFFER + 1 : 0),
      set: () => {},
    });
    vi.advanceTimersByTime(250);

    // Both reconciles were themselves shed: both ids remain owed, kind intact.
    const info = gateway.getStatusReconcileInfo(asWs(client.ws))!;
    expect(Object.fromEntries(info.entries.map((e) => [e.id, e.kind]))).toEqual({ sA: "added", sB: "removed" });
    expect(gateway.getDroppedFrameStats().statusReconcileSent).toBe(0);

    // A later drain retries both — self-healing, not attempted-once.
    Object.defineProperty(client.ws, "bufferedAmount", { configurable: true, writable: true, value: 0 });
    vi.advanceTimersByTime(250);
    expect(client.framesOfType("session_added").length).toBeGreaterThanOrEqual(1);
    expect(client.framesOfType("session_removed").length).toBeGreaterThanOrEqual(1);
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))).toBeUndefined();
  });

  it("a partial drain delivers the head and leaves the remainder owed (X3)", () => {
    const ids = ["s0", "s1", "s2", "s3", "s4"];
    const { gateway } = buildDebtGateway(ids);
    const client = attachCapturedWs(gateway);
    client.saturate();
    for (const id of ids) gateway.broadcastSessionUpdated(id, { status: "streaming" });
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))?.owed.length).toBe(5);

    // After the 2nd reconcile send the socket re-crosses the threshold, so the
    // loop's next pre-check breaks and the remaining ids stay owed. A send
    // counter (not a read counter) keeps this independent of how many times
    // `bufferedAmount` happens to be read per frame.
    const attachSend = client.ws.send;
    let sends = 0;
    client.ws.send = (frame) => {
      sends++;
      if (sends >= 2) client.ws.bufferedAmount = TEST_MAX_WS_BUFFER + 1;
      attachSend(frame);
    };
    client.drain();
    vi.advanceTimersByTime(250);

    expect(client.statusFrames()).toHaveLength(2);
    expect(gateway.getDroppedFrameStats().statusReconcileSent).toBe(2);
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))?.owed).toEqual(["s2", "s3", "s4"]);
  });

  it("a delivered lifecycle frame clears older debt, so an ended row is not resurrected (E21)", () => {
    const { gateway, manager } = buildDebtGateway(["s10"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    // Shed the add: the debt records `added` with `sawAdd`.
    gateway.broadcastSessionAdded({ id: "s10", cwd: "/repo/a" });
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))!.entries[0]).toMatchObject({
      id: "s10",
      kind: "added",
      sawAdd: true,
    });

    // Drain, then DELIVER a real removal for the now-ended record.
    client.drain();
    manager.unregister("s10");
    gateway.broadcastSessionRemoved("s10");
    expect(client.framesOfType("session_removed")).toHaveLength(1);
    // The delivered removal is this socket's current truth: debt gone.
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))).toBeUndefined();

    // Flush must NOT resurrect an ended row via a reconciled `session_added`.
    vi.advanceTimersByTime(1_000);
    expect(client.framesOfType("session_added")).toHaveLength(0);
    expect(gateway.getDroppedFrameStats().statusReconcileSent).toBe(0);
  });
});

// ── Teardown releases the register and its timer (E12/X2) ────────────────
// See change: close-registry-frame-shed-gaps (test-plan #X2).

describe("registry debt teardown releases entries AND the timer (X2)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("releases on socket close", () => {
    const { gateway } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    gateway.broadcastSessionUpdated("s1", { status: "streaming" });
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))?.timerActive).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    client.ws.close();

    expect(gateway.getStatusReconcileInfo(asWs(client.ws))).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases on socket error", () => {
    const { gateway } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    gateway.broadcastSessionUpdated("s1", { status: "streaming" });
    expect(vi.getTimerCount()).toBe(1);

    client.ws.emit("error", new Error("socket boom"));

    expect(gateway.getStatusReconcileInfo(asWs(client.ws))).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases on the stalled-socket terminate path", () => {
    const { gateway } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    gateway.broadcastSessionAdded({ id: "s1", cwd: "/repo/a" });
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))?.timerActive).toBe(true);

    // A state frame larger than the threshold, deferred onto a saturated socket,
    // pushes the pending-state map past its byte ceiling → terminate.
    gateway.sendToClient(asWs(client.ws), {
      type: "openspec_update",
      cwd: "/repo/a",
      data: { initialized: true, changes: [{ name: "x".repeat(TEST_MAX_WS_BUFFER), status: "in-progress", completedTasks: 0, totalTasks: 1, artifacts: [] }] },
    } as unknown as ServerToBrowserMessage);

    expect(gateway.getDroppedFrameStats().stalledSocketsTerminated).toBe(1);
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
