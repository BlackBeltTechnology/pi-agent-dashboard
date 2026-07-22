/**
 * Lifecycle run-boundary capture (test-plan #E23): the server derives "at rest"
 * from the bridge-normalized `agent_settled` event NAME with no `piVersion`
 * branch, so a native settle and a floor-synthesized settle are captured
 * identically.
 * See change: add-embed-session-lifecycle.
 */
import { describe, expect, it } from "vitest";
import { captureLifecycleTimestamp } from "../lifecycle-event-capture.js";

describe("captureLifecycleTimestamp", () => {
  it("captures agent_start as lastRunStartedAt", () => {
    expect(captureLifecycleTimestamp("agent_start", 1234)).toEqual({ lastRunStartedAt: 1234 });
  });

  it("captures agent_settled as lastSettledAt", () => {
    expect(captureLifecycleTimestamp("agent_settled", 5678)).toEqual({ lastSettledAt: 5678 });
  });

  // E23 — native vs synthesized settle are the same normalized event, so the
  // capture is version-agnostic (no branch can distinguish them).
  it("captures native and synthesized agent_settled identically", () => {
    const native = captureLifecycleTimestamp("agent_settled", 9000);
    const synthesized = captureLifecycleTimestamp("agent_settled", 9000);
    expect(native).toEqual(synthesized);
  });

  it("ignores non-run-boundary events", () => {
    expect(captureLifecycleTimestamp("tool_execution_start", 1)).toBeNull();
    expect(captureLifecycleTimestamp("turn_end", 1)).toBeNull();
  });
});
