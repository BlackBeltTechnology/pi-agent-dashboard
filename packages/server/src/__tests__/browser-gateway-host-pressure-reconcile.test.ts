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
import { asWs, attachCapturedWs, buildDebtGateway } from "./helpers/status-debt-fixtures.js";

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
