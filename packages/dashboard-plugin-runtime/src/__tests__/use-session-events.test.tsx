/**
 * Tests for `useSessionEvents` plugin-runtime hook + the underlying
 * module-level event store. See change: pluginize-flows-via-registry.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { PluginContextProvider, useSessionEvents, publishSessionEvent, publishSessionEvents } from "../index.js";
import { __resetSessionEventsStoreForTests, getSessionEvents, subscribeSessionEvents } from "../session-events-store.js";

function makeEvent(seq: number, eventType = "tool_start"): DashboardEvent {
  return {
    seq,
    timestamp: new Date(seq * 1000).toISOString(),
    eventType,
    data: { ts: seq },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function Probe({ sessionId, onSnapshot }: {
  sessionId: string;
  onSnapshot: (events: readonly DashboardEvent[]) => void;
}) {
  const events = useSessionEvents(sessionId);
  onSnapshot(events);
  return <div data-testid="count">{events.length}</div>;
}

function renderProbe(sessionId: string, onSnapshot: (e: readonly DashboardEvent[]) => void) {
  return render(
    <PluginContextProvider>
      <Probe sessionId={sessionId} onSnapshot={onSnapshot} />
    </PluginContextProvider>,
  );
}

describe("useSessionEvents", () => {
  beforeEach(() => __resetSessionEventsStoreForTests());
  afterEach(() => {
    cleanup();
    __resetSessionEventsStoreForTests();
  });

  it("returns empty array for unknown session", () => {
    const snaps: Array<readonly DashboardEvent[]> = [];
    renderProbe("S", (s) => snaps.push(s));
    expect(snaps[0]).toEqual([]);
  });

  it("re-renders when a new event is published for the subscribed session", () => {
    const snaps: Array<readonly DashboardEvent[]> = [];
    const { getByTestId } = renderProbe("S", (s) => snaps.push(s));
    expect(getByTestId("count").textContent).toBe("0");

    act(() => publishSessionEvent("S", makeEvent(1)));
    expect(getByTestId("count").textContent).toBe("1");

    act(() => publishSessionEvent("S", makeEvent(2)));
    expect(getByTestId("count").textContent).toBe("2");

    // Snapshot growth: 0 → 1 → 2
    const lengths = snaps.map((s) => s.length);
    expect(lengths).toContain(0);
    expect(lengths).toContain(1);
    expect(lengths).toContain(2);
  });

  it("preserves arrival order", () => {
    const snaps: Array<readonly DashboardEvent[]> = [];
    renderProbe("S", (s) => snaps.push(s));

    act(() => {
      publishSessionEvent("S", makeEvent(1));
      publishSessionEvent("S", makeEvent(2));
      publishSessionEvent("S", makeEvent(3));
    });

    const last = snaps[snaps.length - 1];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(last.map((e) => (e as any).seq)).toEqual([1, 2, 3]);
  });

  it("scopes events per session", () => {
    const snapsA: Array<readonly DashboardEvent[]> = [];
    const snapsB: Array<readonly DashboardEvent[]> = [];
    render(
      <PluginContextProvider>
        <Probe sessionId="A" onSnapshot={(s) => snapsA.push(s)} />
        <Probe sessionId="B" onSnapshot={(s) => snapsB.push(s)} />
      </PluginContextProvider>,
    );

    act(() => publishSessionEvent("A", makeEvent(1)));
    act(() => publishSessionEvent("B", makeEvent(99)));
    act(() => publishSessionEvent("A", makeEvent(2)));

    const lastA = snapsA[snapsA.length - 1];
    const lastB = snapsB[snapsB.length - 1];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(lastA.map((e) => (e as any).seq)).toEqual([1, 2]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(lastB.map((e) => (e as any).seq)).toEqual([99]);
  });

  it("returns a stable reference between publishes", () => {
    const snaps: Array<readonly DashboardEvent[]> = [];
    const { rerender } = renderProbe("S", (s) => snaps.push(s));

    act(() => publishSessionEvent("S", makeEvent(1)));
    const refAfterFirst = snaps[snaps.length - 1];

    // Force a re-render without publishing.
    rerender(
      <PluginContextProvider>
        <Probe sessionId="S" onSnapshot={(s) => snaps.push(s)} />
      </PluginContextProvider>,
    );
    const refAfterRerender = snaps[snaps.length - 1];

    expect(refAfterRerender).toBe(refAfterFirst);
  });

  it("publishSessionEvents appends a batch with exactly one notification", () => {
    let notifyCount = 0;
    const unsub = subscribeSessionEvents("B", () => { notifyCount++; });
    publishSessionEvents("B", [makeEvent(1), makeEvent(2), makeEvent(3)]);
    expect(getSessionEvents("B").map((e) => (e as { seq: number }).seq)).toEqual([1, 2, 3]);
    expect(notifyCount).toBe(1);
    // empty batch is a no-op: no extra notification, stable reference
    const ref = getSessionEvents("B");
    publishSessionEvents("B", []);
    expect(notifyCount).toBe(1);
    expect(getSessionEvents("B")).toBe(ref);
    unsub();
  });

  it("publishSessionEvents appends onto events already published singly", () => {
    publishSessionEvent("C", makeEvent(1));
    publishSessionEvents("C", [makeEvent(2), makeEvent(3)]);
    expect(getSessionEvents("C").map((e) => (e as { seq: number }).seq)).toEqual([1, 2, 3]);
  });

  it("throws when called outside PluginContextProvider", () => {
    // Suppress React error logging for this assertion.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(<Probe sessionId="S" onSnapshot={() => {}} />),
    ).toThrow(/PluginContextProvider/);
    errSpy.mockRestore();
  });
});

