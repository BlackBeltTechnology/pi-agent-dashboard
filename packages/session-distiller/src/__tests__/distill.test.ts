import { describe, it, expect } from "vitest";
import { distill, computeConfidence, CONFIDENCE_FLOOR } from "../distill.js";
import type { HeldCluster } from "../cluster.js";

const cluster: HeldCluster = {
  signature: "fault:bash:enoent",
  signal: "fault",
  sessionIds: ["s1", "s2", "s3"],
  lastSeen: "",
  sample: {
    signal: "fault",
    sessionId: "s1",
    model: "claude-opus-4-8",
    signature: "fault:bash:enoent",
    verified: true,
    wrongCall: { id: "a", name: "bash", arguments: {} },
    error: "ENOENT",
    fixCall: { id: "b", name: "bash", arguments: {} },
  },
};

describe("distillation provenance (task 4.3)", () => {
  it("stamps provenance with sessionIds, model, date, confidence", () => {
    const a = distill(cluster, { n: 3 });
    expect(a.provenance.sessionIds).toEqual(["s1", "s2", "s3"]);
    expect(a.provenance.model).toBe("claude-opus-4-8");
    expect(a.provenance.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(a.provenance.confidence).toBeGreaterThan(CONFIDENCE_FLOOR);
    expect(a.stale).toBe(false);
  });
});

describe("confidence decay (task 4.3)", () => {
  it("rises with recurrence", () => {
    const low = computeConfidence({ recurrence: 3, n: 3, ageDays: 0, modelChanged: false, isModelWorkaround: false });
    const high = computeConfidence({ recurrence: 6, n: 3, ageDays: 0, modelChanged: false, isModelWorkaround: false });
    expect(high).toBeGreaterThan(low);
  });

  it("decays an aged artifact below the floor without fresh recurrence", () => {
    const aged = distill(cluster, {
      n: 3,
      now: new Date("2026-12-01T00:00:00Z"),
      lastSeen: new Date("2026-06-01T00:00:00Z"), // ~6 months stale
    });
    expect(aged.provenance.confidence).toBeLessThan(CONFIDENCE_FLOOR);
    expect(aged.stale).toBe(true);
  });

  it("model-limitation workarounds decay fastest and carry an expiry note", () => {
    const wk: HeldCluster = { ...cluster, signature: "fault:model-token-limit:overflow" };
    const a = distill(wk, { n: 3, now: new Date("2026-06-21T00:00:00Z"), lastSeen: new Date("2026-06-01T00:00:00Z") });
    const normal = distill(cluster, { n: 3, now: new Date("2026-06-21T00:00:00Z"), lastSeen: new Date("2026-06-01T00:00:00Z") });
    expect(a.provenance.confidence).toBeLessThan(normal.provenance.confidence);
    expect(a.expiryNote).toMatch(/model/i);
  });
});
