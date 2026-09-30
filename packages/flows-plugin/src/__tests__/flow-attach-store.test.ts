/**
 * Per-session flow attachment store (localStorage + useSyncExternalStore).
 * Round-trips under `dashboard:flow-attached:<sessionId>`, isolates sessions,
 * and clears conditionally on the per-attach id. See change:
 * attach-flow-before-run (D5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowAttachment } from "../client/flow-idle-state.js";

async function freshStore() {
  vi.resetModules();
  return import("../client/flow-attach-store.js");
}

const a1: FlowAttachment = { id: "a1", name: "A", source: "/a/flow.yaml", baselineStartedAt: 10 };
const b: FlowAttachment = { id: "b", name: "B", source: "/b/flow.yaml", baselineStartedAt: null };

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("flow-attach-store (E11)", () => {
  it("persists per session as JSON and survives a fresh module load", async () => {
    const s = await freshStore();
    s.setAttachment("S1", a1);
    s.setAttachment("S2", b);
    expect(JSON.parse(localStorage.getItem("dashboard:flow-attached:S1")!)).toEqual(a1);

    const fresh = await freshStore();
    expect(fresh.getAttachment("S1")).toEqual(a1);
    expect(fresh.getAttachment("S2")).toEqual(b);
  });

  it("clears conditionally on id and keeps other sessions", async () => {
    const s = await freshStore();
    s.setAttachment("S1", a1);
    s.setAttachment("S2", b);
    s.clearAttachment("S1", "stale-id");
    expect(s.getAttachment("S1")).toEqual(a1);
    s.clearAttachment("S1", a1.id);
    expect(s.getAttachment("S1")).toBeNull();
    expect(localStorage.getItem("dashboard:flow-attached:S1")).toBeNull();
    expect(s.getAttachment("S2")).toEqual(b);
  });

  it("returns a stable snapshot reference until written", async () => {
    const s = await freshStore();
    s.setAttachment("S1", a1);
    expect(s.getAttachment("S1")).toBe(s.getAttachment("S1"));
  });

  it("coerces a legacy entry missing baselineStartedAt to null", async () => {
    localStorage.setItem("dashboard:flow-attached:L", JSON.stringify({ id: "l", name: "A", source: 7 }));
    const s = await freshStore();
    expect(s.getAttachment("L")).toEqual({ id: "l", name: "A", source: undefined, baselineStartedAt: null });
  });

  it("resolveBaseline sets a null baseline only for the matching id", async () => {
    const s = await freshStore();
    s.setAttachment("S2", b);
    s.resolveBaseline("S2", "other", 500);
    expect(s.getAttachment("S2")?.baselineStartedAt).toBeNull();
    s.resolveBaseline("S2", b.id, 500);
    expect(s.getAttachment("S2")?.baselineStartedAt).toBe(500);
    s.resolveBaseline("S2", b.id, 900);
    expect(s.getAttachment("S2")?.baselineStartedAt).toBe(500);
  });
});
