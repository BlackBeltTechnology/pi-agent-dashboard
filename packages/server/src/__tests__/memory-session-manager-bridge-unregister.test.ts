/**
 * Manager-private "ended by an explicit bridge unregister" tag — the only
 * ending that may carry shutdown-window evidence.
 * See change: fix-recovery-pi-signal-unregister (D2).
 */
import { describe, expect, it } from "vitest";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

function registered(id = "s1") {
  const sm = createMemorySessionManager();
  sm.register({ id, cwd: "/w", source: "tui", sessionFile: `/w/${id}.jsonl` } as Parameters<typeof sm.register>[0]);
  return sm;
}

describe("wasEndedByBridgeUnregister", () => {
  it("is set only for an unregister that declares endSource bridge_unregister, before onEnded fires", () => {
    const sm = registered();
    let seenInOnEnded: boolean | undefined;
    sm.onEnded = (id) => { seenInOnEnded = sm.wasEndedByBridgeUnregister(id); };
    sm.unregister("s1", { endSource: "bridge_unregister" });
    expect(seenInOnEnded).toBe(true);
    expect(sm.wasEndedByBridgeUnregister("s1")).toBe(true);
  });

  it("is not set for any other unregister", () => {
    for (const opts of [undefined, { witnessed: false }, { closedReason: "manual" as const }]) {
      const sm = registered();
      sm.unregister("s1", opts);
      expect(sm.wasEndedByBridgeUnregister("s1")).toBe(false);
    }
  });

  // test-plan #E17 — a re-register (e.g. after /reload) clears the tag, so a
  // later heartbeat-expiry ending in the same boot carries no evidence.
  it("is cleared by register, and a later non-bridge end leaves it false", () => {
    const sm = registered();
    sm.unregister("s1", { endSource: "bridge_unregister" });
    sm.register({ id: "s1", cwd: "/w", source: "tui", sessionFile: "/w/s1.jsonl" } as Parameters<typeof sm.register>[0]);
    expect(sm.wasEndedByBridgeUnregister("s1")).toBe(false);
    sm.unregister("s1", { witnessed: false, closedReason: "unknown" });
    expect(sm.wasEndedByBridgeUnregister("s1")).toBe(false);
  });

  it("is cleared when the session is removed from the registry", () => {
    const sm = registered();
    sm.unregister("s1", { endSource: "bridge_unregister" });
    sm.remove("s1");
    expect(sm.wasEndedByBridgeUnregister("s1")).toBe(false);
  });

  // test-plan #E19 — the tag never leaks onto the shared session shape.
  it("never appears on the DashboardSession record", () => {
    const sm = registered();
    sm.unregister("s1", { endSource: "bridge_unregister" });
    const s = sm.get("s1");
    expect(s).toBeDefined();
    expect(Object.keys(s as object)).not.toContain("endSource");
    expect(JSON.stringify(s)).not.toContain("bridge_unregister");
  });
});
