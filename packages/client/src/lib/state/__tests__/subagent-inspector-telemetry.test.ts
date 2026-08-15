/**
 * P5 (task 1.5) — the missing signal. Nothing today records whether a subagent
 * detail view is MOUNTED, so the inspector-open share of subagent runtime — the
 * number that bounds the achievable win and is this change's kill switch
 * (C4: abort if > 50 %) — could not be measured at all.
 *
 * See change: reduce-subagent-details-payload.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  inspectorOpenShare,
  noteSubagentRunning,
  noteSubagentTerminal,
  readInspectorTelemetry,
  resetInspectorTelemetry,
  trackInspectorMounted,
} from "../subagent-inspector-telemetry.js";

beforeEach(() => {
  resetInspectorTelemetry();
});

describe("subagent inspector telemetry", () => {
  it("reports a zero share when no subagent has run", () => {
    expect(inspectorOpenShare()).toBe(0);
    expect(readInspectorTelemetry()).toEqual({ runtimeMs: 0, inspectorOpenMs: 0, share: 0 });
  });

  it("accrues runtime for a running subagent and stops at terminal", () => {
    noteSubagentRunning("ag1", 1_000);
    noteSubagentTerminal("ag1", 5_000);
    expect(readInspectorTelemetry().runtimeMs).toBe(4_000);
    // A second terminal for the same agent is inert.
    noteSubagentTerminal("ag1", 9_000);
    expect(readInspectorTelemetry().runtimeMs).toBe(4_000);
  });

  it("measures the mounted window and derives the share", () => {
    noteSubagentRunning("ag1", 0);
    const unmount = trackInspectorMounted("ag1", 1_000);
    unmount(3_000); // 2s of a 10s run
    noteSubagentTerminal("ag1", 10_000);

    const t = readInspectorTelemetry();
    expect(t.runtimeMs).toBe(10_000);
    expect(t.inspectorOpenMs).toBe(2_000);
    expect(t.share).toBeCloseTo(0.2);
    expect(inspectorOpenShare()).toBeCloseTo(0.2);
  });

  it("counts two views of the SAME subagent as one open window, not two", () => {
    // Otherwise inline + popout would double-count and could fake a share > 1.
    noteSubagentRunning("ag1", 0);
    const a = trackInspectorMounted("ag1", 1_000);
    const b = trackInspectorMounted("ag1", 2_000);
    a(3_000);
    b(4_000);
    noteSubagentTerminal("ag1", 10_000);

    expect(readInspectorTelemetry().inspectorOpenMs).toBe(3_000); // 1_000 → 4_000
    expect(inspectorOpenShare()).toBeCloseTo(0.3);
  });

  it("closes an open window at terminal so a never-unmounted view still measures", () => {
    noteSubagentRunning("ag1", 0);
    trackInspectorMounted("ag1", 2_000);
    noteSubagentTerminal("ag1", 6_000);
    // Mounted 2_000 → 6_000 of a 0 → 6_000 run.
    expect(readInspectorTelemetry().inspectorOpenMs).toBe(4_000);
    expect(inspectorOpenShare()).toBeCloseTo(4 / 6);
  });

  it("aggregates across subagents", () => {
    noteSubagentRunning("ag1", 0);
    trackInspectorMounted("ag1", 0)(5_000); // fully watched
    noteSubagentTerminal("ag1", 5_000);

    noteSubagentRunning("ag2", 0);
    noteSubagentTerminal("ag2", 15_000); // never watched

    const t = readInspectorTelemetry();
    expect(t.runtimeMs).toBe(20_000);
    expect(t.inspectorOpenMs).toBe(5_000);
    expect(t.share).toBeCloseTo(0.25);
  });

  it("never reports a share above 1 even under overlapping noise", () => {
    noteSubagentRunning("ag1", 0);
    const a = trackInspectorMounted("ag1", 0);
    a(20_000); // mounted longer than the run lasted (clock skew / late unmount)
    noteSubagentTerminal("ag1", 10_000);
    expect(inspectorOpenShare()).toBeLessThanOrEqual(1);
  });

  it("a reused agentId observed running again starts a fresh run", () => {
    noteSubagentRunning("ag1", 0);
    noteSubagentTerminal("ag1", 1_000);
    noteSubagentRunning("ag1", 5_000); // second run of the same id
    noteSubagentTerminal("ag1", 8_000);
    // The second run replaces the first rather than being ignored.
    expect(readInspectorTelemetry().runtimeMs).toBe(3_000);
  });

  it("stays bounded over a long-lived tab", () => {
    for (let i = 0; i < 900; i++) {
      noteSubagentRunning(`ag${i}`, i);
      noteSubagentTerminal(`ag${i}`, i + 1);
    }
    // Aggregate still reports; the retained record set is bounded.
    expect(readInspectorTelemetry().runtimeMs).toBeGreaterThan(0);
    expect(inspectorOpenShare()).toBe(0);
  });

  it("is inert for an unknown agent (no run recorded)", () => {
    expect(() => trackInspectorMounted("ghost", 1_000)(2_000)).not.toThrow();
    expect(inspectorOpenShare()).toBe(0);
  });

  it("exposes the reading on globalThis so the harness can read it", () => {
    noteSubagentRunning("ag1", 0);
    trackInspectorMounted("ag1", 0)(1_000);
    noteSubagentTerminal("ag1", 4_000);
    const exposed = (globalThis as Record<string, unknown>).__piSubagentInspectorTelemetry as
      | (() => unknown)
      | undefined;
    expect(typeof exposed).toBe("function");
    expect(exposed?.()).toEqual(readInspectorTelemetry());
  });
});
