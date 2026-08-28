/**
 * Change: restore-assistant-greeting-stream
 *
 * The reducer folds greeting `ib_domain_event` frames (delivered as synthetic
 * `ib_greeting` events) into chronological chat rows: one assistant-side row per
 * greeting id, positioned by the ordering key, idempotent across live+replay,
 * carrying the structured `state` as a field (never scraped from content). The
 * `display:false` transcript copy still renders nowhere and never double-renders.
 */
import { describe, it, expect } from "vitest";
import { createInitialState, reduceEvent } from "../event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function greeting(id: string, state: string, content: string, ts: number): DashboardEvent {
  return { eventType: "ib_greeting", timestamp: ts, data: { id, state, content } };
}
function assistantEnd(text: string, ts: number): DashboardEvent {
  return {
    eventType: "message_end",
    timestamp: ts,
    data: { message: { role: "assistant", content: [{ type: "text", text }] } },
  };
}
function greetingCustomEnd(content: string, display: boolean, entryId: string, ts: number): DashboardEvent {
  return {
    eventType: "message_end",
    timestamp: ts,
    data: { message: { role: "custom", customType: "ib-greeting", content, display }, entryId },
  };
}

describe("greeting-stream reducer fold", () => {
  it("folds a greeting frame into one assistant row carrying the structured state", () => {
    let s = createInitialState();
    s = reduceEvent(s, greeting("g1", "exported", "Kész **exported** <svg><path/></svg>", 1000));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe("assistant");
    expect(s.messages[0].id).toBe("greeting-g1");
    expect(s.messages[0].state).toBe("exported");
    // State is a field, not scraped from content: content carries no state token.
    expect(s.messages[0].content).toBe("Kész **exported** <svg><path/></svg>");
    expect(s.messages[0].content).not.toContain("ib-state");
  });

  it("replays the full stream in order, not collapsed to newest", () => {
    let s = createInitialState();
    s = reduceEvent(s, greeting("g1", "partner_pending", "A", 1000));
    s = reduceEvent(s, greeting("g2", "pending_approval", "B", 2000));
    s = reduceEvent(s, greeting("g3", "exported", "C", 3000));
    expect(s.messages.map((m) => m.state)).toEqual(["partner_pending", "pending_approval", "exported"]);
  });

  it("positions greeting rows chronologically relative to assistant rows by ordering key", () => {
    let s = createInitialState();
    s = reduceEvent(s, assistantEnd("first", 1000));
    s = reduceEvent(s, assistantEnd("third", 3000));
    // A greeting emitted at t=2000 lands BETWEEN the two assistant rows.
    s = reduceEvent(s, greeting("g1", "exported", "middle", 2000));
    expect(s.messages.map((m) => m.content)).toEqual(["first", "middle", "third"]);
  });

  it("is idempotent across live + replay delivery of the same greeting (one row)", () => {
    let s = createInitialState();
    s = reduceEvent(s, greeting("g1", "exported", "replayed", 1000)); // replay
    s = reduceEvent(s, greeting("g1", "exported", "live", 5000)); // live re-delivery, same id
    const rows = s.messages.filter((m) => m.id === "greeting-g1");
    expect(rows).toHaveLength(1);
    expect(s.messages).toHaveLength(1);
  });

  it("preserves the structured state across an idempotent re-fold", () => {
    let s = createInitialState();
    s = reduceEvent(s, greeting("g1", "pending_approval", "one", 1000));
    s = reduceEvent(s, greeting("g1", "pending_approval", "two", 1000));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].state).toBe("pending_approval");
  });

  it("skips a greeting frame without a stable id (cannot dedupe)", () => {
    let s = createInitialState();
    s = reduceEvent(s, { eventType: "ib_greeting", timestamp: 1000, data: { state: "exported", content: "x" } });
    expect(s.messages).toHaveLength(0);
  });

  it("does not render the display:false transcript copy and never double-renders", () => {
    let s = createInitialState();
    // The transcript copy is display:false → no row.
    s = reduceEvent(s, greetingCustomEnd("hidden copy", false, "e1", 1000));
    expect(s.messages).toHaveLength(0);
    // The domain-event frame renders exactly one row.
    s = reduceEvent(s, greeting("g1", "exported", "the greeting", 1000));
    const greetingRows = s.messages.filter((m) => m.state !== undefined);
    expect(greetingRows).toHaveLength(1);
    expect(s.messages).toHaveLength(1);
  });

  it("a non-greeting assistant row carries no state field", () => {
    let s = createInitialState();
    s = reduceEvent(s, assistantEnd("plain", 1000));
    expect(s.messages[0].state).toBeUndefined();
  });
});
