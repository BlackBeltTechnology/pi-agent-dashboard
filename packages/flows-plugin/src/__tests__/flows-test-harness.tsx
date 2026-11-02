/**
 * Shared render harness for flows-plugin client tests that mount the shared
 * flow actions (dock chip, menu claim, panel headers): a primitive registry with
 * stub dialogs / picker / popover, catalog + event publishers, and an edit-mode
 * fetch mock. See change: flows-dock-chip-and-panel-actions.
 */
import { createUiPrimitiveRegistry, registerUiPrimitive, UiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import { CurrentPluginLayer, PluginContextProvider, publishSessionEvent } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { vi } from "vitest";
import type { FlowCatalogEntry } from "../flow-catalog-contract.js";

export const registry = createUiPrimitiveRegistry();
const Dialog = (({ children, testId }: { children?: React.ReactNode; testId?: string }) => (
  <div data-testid={testId ?? "dialog"}>{children}</div>
)) as unknown as { Footer: React.FC<{ children?: React.ReactNode }>; Cancel: React.FC<{ onClick: () => void; children?: React.ReactNode }> };
Dialog.Footer = ({ children }) => <div>{children}</div>;
Dialog.Cancel = ({ onClick, children }) => (
  <button type="button" onClick={onClick}>
    {children ?? "Cancel"}
  </button>
);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.dialog, Dialog as never);
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.confirmDialog,
  (({ message, onConfirm }: { message: string; onConfirm: () => void }) => (
    <div data-testid="confirm">
      {message}
      <button type="button" onClick={onConfirm}>
        confirm
      </button>
    </div>
  )) as never,
);
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.searchableSelectDialog,
  (({ title, options, onSelect }: { title: string; options: Array<{ value: string; label: string; description?: string }>; onSelect: (v: string) => void }) => (
    <div data-testid="picker" data-title={title}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onSelect(o.value)}>
          {o.label}|{o.description}
        </button>
      ))}
    </div>
  )) as never,
);
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.popover,
  (({ children }: { children?: React.ReactNode }) => <div data-testid="popover">{children}</div>) as never,
);

let seq = 0;
export function ev(eventType: string, timestamp: number, data: Record<string, unknown>): DashboardEvent {
  return { seq: ++seq, timestamp, eventType, data } as unknown as DashboardEvent;
}
export const started = (flowName: string, ts: number, steps = 1) =>
  ev("flow_started", ts, {
    flowName,
    task: "",
    steps: Array.from({ length: steps }, (_, i) => ({ id: `s${i}`, stepType: "agent", agent: `a${i}`, blockedBy: [] })),
  });
export const completed = (flowName: string, ts: number, status = "success") => ev("flow_complete", ts, { flowName, status });

export function entry(name: string, over: Partial<FlowCatalogEntry> = {}): FlowCatalogEntry {
  return { name, description: `${name} desc`, source: `/p/${name}/flow.yaml`, taskRequired: false, ...over };
}
/** Publish a `flow_catalog` event for `sid`. */
export function publishCatalog(sid: string, flows: FlowCatalogEntry[]) {
  publishSessionEvent(sid, ev("flow_catalog", 1, { catalogKey: "catalog", flows }));
}

export function tree(node: React.ReactNode, send: (m: unknown) => void = () => {}, ws?: WebSocket) {
  return (
    <PluginContextProvider send={send} ws={ws}>
      <UiPrimitiveProvider value={registry}>
        <CurrentPluginLayer pluginId="flows">{node}</CurrentPluginLayer>
      </UiPrimitiveProvider>
    </PluginContextProvider>
  );
}

/** What `GET /api/plugins/flows/edit-mode-state` answers. */
export type Served = boolean | "reject" | 500 | 404 | "pending";
export const editMode = { served: false as Served };
export const fetchMock = vi.fn(async (_url?: string) => {
  const s = editMode.served;
  if (s === "pending") return new Promise<Response>(() => {});
  if (s === "reject") throw new TypeError("network");
  if (typeof s === "number") return new Response("{}", { status: s });
  return new Response(JSON.stringify({ enabled: s }), { status: 200 });
});

/** `plugin_action` / `flow_management` / `send_prompt` messages a send mock saw. */
export const sentOf = (send: ReturnType<typeof vi.fn>, pred: (m: Record<string, unknown>) => boolean) =>
  send.mock.calls.map(([m]) => m as Record<string, unknown>).filter(pred);
export const catalogAsks = (send: ReturnType<typeof vi.fn>) => sentOf(send, (m) => m.action === "flow.request-catalog");

/**
 * Per-file in-memory `localStorage`. The test runner's Node webstorage file is
 * shared by parallel workers, so another file's `localStorage.clear()` can wipe
 * a seeded collapse / attach key mid-test. Call at module top level.
 */
export function useIsolatedLocalStorage(): void {
  const mem = new Map<string, string>();
  const storage = {
    get length() {
      return mem.size;
    },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  if (typeof window !== "undefined") Object.defineProperty(window, "localStorage", { value: storage, configurable: true, writable: true });
}
