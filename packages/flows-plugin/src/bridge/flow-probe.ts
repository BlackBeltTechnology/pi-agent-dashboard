/**
 * Synchronous `flow:list-flows` probe shared by the flow-files reporter and
 * the catalog publisher. Returns `undefined` when no listener answered
 * (pi-flows absent or not loaded yet) and the raw flow array otherwise — an
 * answered empty list is `[]`. Never throws.
 * See change: flows-dock-chip-and-panel-actions (D2).
 */
export interface ProbeEvents {
  emit(name: string, data: unknown): unknown;
}

export function probeFlows(events: ProbeEvents): unknown[] | undefined {
  try {
    const probe: { flows?: unknown } = {};
    events.emit("flow:list-flows", probe);
    return Array.isArray(probe.flows) ? probe.flows : undefined;
  } catch {
    return undefined;
  }
}
