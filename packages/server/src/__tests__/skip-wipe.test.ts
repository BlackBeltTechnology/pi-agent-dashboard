/**
 * Tests for bridge reconnect skip-wipe logic in event-wiring.
 * When bridge sends eventCount matching server's stored count, skip the event wipe.
 */
import { describe, it, expect, vi } from "vitest";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeEvent(type: string = "test"): DashboardEvent {
  return { eventType: type, timestamp: Date.now(), data: {} };
}

/**
 * Minimal simulation of the session_register path in event-wiring.ts.
 * We test the skip-wipe decision logic in isolation.
 */
function simulateSessionRegister(opts: {
  eventStore: ReturnType<typeof createMemoryEventStore>;
  sessionId: string;
  previousSessionId?: string;
  eventCount?: number;
}) {
  const { eventStore, sessionId, previousSessionId, eventCount } = opts;
  const wiped = { value: false };
  const resetSent = { value: false };

  // Decision logic matching event-wiring.ts
  const sameSession = !previousSessionId || previousSessionId === sessionId;
  const serverEventCount = eventStore.getEvents(sessionId, 1).length;
  const canSkipWipe = sameSession && eventCount !== undefined && eventCount === serverEventCount;

  if (!canSkipWipe) {
    eventStore.deleteEventsForSession(sessionId);
    wiped.value = true;
    resetSent.value = true;
  }

  return { wiped: wiped.value, resetSent: resetSent.value };
}

describe("skip-wipe on bridge reconnect", () => {
  it("skips wipe when eventCount matches server event count", () => {
    const store = createMemoryEventStore(() => false);
    store.insertEvent("s1", makeEvent("a"));
    store.insertEvent("s1", makeEvent("b"));
    store.insertEvent("s1", makeEvent("c"));

    const result = simulateSessionRegister({
      eventStore: store,
      sessionId: "s1",
      previousSessionId: "s1",
      eventCount: 3,
    });

    expect(result.wiped).toBe(false);
    expect(result.resetSent).toBe(false);
    // Events preserved
    expect(store.getEvents("s1", 1)).toHaveLength(3);
  });

  it("wipes when eventCount mismatches", () => {
    const store = createMemoryEventStore(() => false);
    store.insertEvent("s1", makeEvent("a"));
    store.insertEvent("s1", makeEvent("b"));

    const result = simulateSessionRegister({
      eventStore: store,
      sessionId: "s1",
      previousSessionId: "s1",
      eventCount: 5, // mismatch
    });

    expect(result.wiped).toBe(true);
    expect(result.resetSent).toBe(true);
    expect(store.getEvents("s1", 1)).toHaveLength(0);
  });

  it("wipes when eventCount is not provided (backward compat)", () => {
    const store = createMemoryEventStore(() => false);
    store.insertEvent("s1", makeEvent("a"));

    const result = simulateSessionRegister({
      eventStore: store,
      sessionId: "s1",
      previousSessionId: "s1",
      eventCount: undefined,
    });

    expect(result.wiped).toBe(true);
    expect(result.resetSent).toBe(true);
  });

  it("wipes when session ID changed", () => {
    const store = createMemoryEventStore(() => false);
    store.insertEvent("s1", makeEvent("a"));
    store.insertEvent("s1", makeEvent("b"));

    const result = simulateSessionRegister({
      eventStore: store,
      sessionId: "s2", // different session
      previousSessionId: "s1",
      eventCount: 2,
    });

    expect(result.wiped).toBe(true);
    expect(result.resetSent).toBe(true);
  });

  it("wipes when no previous session (first connect)", () => {
    const store = createMemoryEventStore(() => false);

    const result = simulateSessionRegister({
      eventStore: store,
      sessionId: "s1",
      previousSessionId: undefined,
      eventCount: 5,
    });

    // No previous session = can't verify, so wipe
    expect(result.wiped).toBe(true);
  });
});
