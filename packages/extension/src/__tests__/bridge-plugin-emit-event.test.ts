/**
 * Bridge `plugin_emit_event` relay (shape contract).
 *
 * Mirrors the bridge onMessage branch: a server-side plugin action emits a
 * configured event into this session; the bridge re-emits it on pi.events.
 * A missing/non-string eventType is ignored. See change:
 * automation-emit-configured-event.
 */
import { describe, it, expect, vi } from "vitest";

// Mirrors the bridge onMessage `plugin_emit_event` branch.
function onPluginEmitEvent(
  events: { emit: (t: string, d: unknown) => void } | undefined,
  msg: { eventType?: unknown; data?: unknown },
): void {
  if (!events) return;
  const eventType = msg.eventType;
  if (typeof eventType === "string" && eventType.length > 0) {
    const data = msg.data;
    events.emit(eventType, data && typeof data === "object" ? (data as Record<string, unknown>) : {});
  }
}

describe("bridge plugin_emit_event relay", () => {
  it("re-emits the configured event with its data", () => {
    const emit = vi.fn();
    onPluginEmitEvent({ emit }, { eventType: "flow:run", data: { flowName: "test:x", task: "go" } });
    expect(emit).toHaveBeenCalledWith("flow:run", { flowName: "test:x", task: "go" });
  });

  it("defaults data to {} when absent", () => {
    const emit = vi.fn();
    onPluginEmitEvent({ emit }, { eventType: "flow:abort" });
    expect(emit).toHaveBeenCalledWith("flow:abort", {});
  });

  it("ignores a missing/non-string eventType", () => {
    const emit = vi.fn();
    onPluginEmitEvent({ emit }, {});
    onPluginEmitEvent({ emit }, { eventType: "" });
    onPluginEmitEvent({ emit }, { eventType: 42 as unknown as string });
    expect(emit).not.toHaveBeenCalled();
  });
});
