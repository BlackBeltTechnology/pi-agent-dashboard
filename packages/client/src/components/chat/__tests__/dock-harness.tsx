/**
 * Shared harness for the composer-dock tests (`ComposerDock*.test.tsx`).
 * Not a test file. See change: add-composer-dock.
 */
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { ProcessGroupSummary } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import type { DashboardSession, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { InflightBashTool } from "../../../hooks/useInflightBashTools.js";
import { YoloStatusStore } from "../../../lib/access-grants/yolo-status.js";
import { OpenSpecMapContext } from "../../../lib/openspec/OpenSpecMapContext.js";
import { scopedSession } from "../../access-grant/__tests__/yolo-test-server.js";
import { ComposerDock, type ComposerDockProps } from "../ComposerDock.js";
import { type DockLane, type DockLaneKey, dockLaneLabel, useDockAccordion } from "../composer-dock-model.js";
import { type ComposerDockLanesInput, useComposerDockLanes } from "../useComposerDockLanes.js";

export type SlotRegistry = ReturnType<typeof createSlotRegistry>;

export function makeSession(over: Partial<DashboardSession> = {}): DashboardSession {
  return { id: "s1", name: "test", cwd: "/repo", source: "pi", status: "active", startedAt: 0, ...over } as DashboardSession;
}

export function proc(pid: number, over: Record<string, unknown> = {}) {
  return { pid, pgid: pid, command: `node script-${pid}.js`, elapsedMs: 5_000, ...over };
}

export function bash(id: string, command = `cmd-${id}`, startedAt = Date.now()): InflightBashTool {
  return { toolCallId: id, command, startedAt };
}

/** A lane adapter stand-in: header text, optional body, expandable by default. */
export function fakeLane(key: DockLaneKey, over: Partial<DockLane> = {}): DockLane {
  return {
    key,
    label: dockLaneLabel(key),
    icon: null,
    title: `${key} title`,
    summary: "1",
    summaryText: `${key} summary`,
    expandable: true,
    renderBody: () => <div data-testid={`fake-body-${key}`}>{key} body</div>,
    announce: `${key} announce`,
    ...over,
  };
}

/**
 * A `composer-dock-process-group` claim. `summary` mode reports `report`; `rows`
 * mode renders one `claim-row`. `throws` makes both modes throw.
 */
export function addFakeGroup(
  registry: SlotRegistry,
  opts: { pluginId?: string; report?: ProcessGroupSummary | null; throws?: boolean } = {},
) {
  const { pluginId = "fake-plugin", report = { count: 2, noun: "subagents" }, throws = false } = opts;
  registry.addClaim({
    pluginId,
    priority: 100,
    slot: "composer-dock-process-group",
    Component: ({ mode, reportSummary }: { mode: "summary" | "rows"; reportSummary: (s: ProcessGroupSummary | null) => void }) => {
      if (throws) throw new Error("claim boom");
      useEffect(() => {
        if (mode === "summary") reportSummary(report);
      }, [mode, reportSummary]);
      return mode === "summary" ? null : <div data-testid="claim-row">{pluginId} row</div>;
    },
  });
}

export function installFrameAndResizeObserver() {
  const observers: Array<(entries: unknown[]) => void> = [];
  const frames: Array<() => void> = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: (entries: unknown[]) => void) {
        observers.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const raf = vi.fn((cb: FrameRequestCallback) => {
    frames.push(() => cb(0));
    return frames.length;
  });
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return {
    raf,
    /** One observer callback with the column's new width. */
    resize: (width: number) => {
      for (const cb of observers) cb([{ contentRect: { width } }]);
    },
    /** Run the frame callbacks queued so far, wrapped in `act`. */
    flush: () => {
      const batch = frames.splice(0, frames.length);
      act(() => batch.forEach((f) => f()));
    },
  };
}

export function makeColumn(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

export function liveYoloStore(cwd = "/repo"): YoloStatusStore {
  const store = new YoloStatusStore(async () => null, 1e9);
  store.publish({ available: true, durationsMinutes: [15], session: scopedSession(Date.now(), cwd) });
  return store;
}

export type DockHarnessAccordion = ReturnType<typeof useDockAccordion>;

export interface HarnessProps extends Omit<ComposerDockProps, "openLane" | "onOpenLaneChange" | "cwd"> {
  cwd?: string;
  registry?: SlotRegistry;
  /** Observes the controlled accordion. */
  accordionRef?: { current: DockHarnessAccordion | null };
  children?: ReactNode;
}

/** The dock plus the App-side accordion (`useDockAccordion` keyed by the bound session). */
export function DockHarness({ registry, accordionRef, cwd = "/repo", ...props }: HarnessProps) {
  const accordion = useDockAccordion(props.session?.id ?? null);
  if (accordionRef) accordionRef.current = accordion;
  return (
    <PluginContextProvider registry={registry ?? createSlotRegistry()}>
      <ComposerDock {...props} cwd={cwd} openLane={accordion.openLane} onOpenLaneChange={accordion.setOpenLane} />
    </PluginContextProvider>
  );
}

export function renderDock(props: HarnessProps) {
  const utils = render(<DockHarness {...props} />);
  return {
    ...utils,
    rerenderDock: (next: HarnessProps) => utils.rerender(<DockHarness {...next} />),
  };
}

export interface LanesHarnessProps {
  /** Input of `useComposerDockLanes`; its `session` is also the dock's session. */
  input: ComposerDockLanesInput;
  registry?: SlotRegistry;
  /** Per-cwd OpenSpec map (attachment resolution). */
  openspecMap?: Record<string, OpenSpecData>;
  processes?: ComposerDockProps["processes"];
  accordionRef?: { current: DockHarnessAccordion | null };
}

function LanesInner({ input, processes, accordionRef }: Pick<LanesHarnessProps, "input" | "processes" | "accordionRef">) {
  const lanes = useComposerDockLanes(input);
  const accordion = useDockAccordion(input.session?.id ?? null);
  if (accordionRef) accordionRef.current = accordion;
  return (
    <ComposerDock
      session={input.session}
      cwd={input.session?.cwd}
      lanes={lanes}
      processes={processes}
      openLane={accordion.openLane}
      onOpenLaneChange={accordion.setOpenLane}
    />
  );
}

/** The real lane hooks (`useComposerDockLanes`) feeding the dock, under the providers they need. */
export function LanesDockHarness({ input, registry, openspecMap, processes, accordionRef }: LanesHarnessProps) {
  return (
    <Router hook={memoryLocation({ path: "/" }).hook}>
      <OpenSpecMapContext.Provider value={new Map(Object.entries(openspecMap ?? {}))}>
        <PluginContextProvider registry={registry ?? createSlotRegistry()}>
          <LanesInner input={input} processes={processes} accordionRef={accordionRef} />
        </PluginContextProvider>
      </OpenSpecMapContext.Provider>
    </Router>
  );
}

export function renderLanesDock(props: LanesHarnessProps) {
  const utils = render(<LanesDockHarness {...props} />);
  return { ...utils, rerenderLanes: (next: LanesHarnessProps) => utils.rerender(<LanesDockHarness {...next} />) };
}

/** Global `fetch` stub: `respond(url)` supplies `{ ok?, body }` for every request (the Changes lane fetches `/api/session-diff`). */
export function stubSessionDiffFetch(respond: (url: string) => { ok?: boolean; body: unknown } | Promise<{ ok?: boolean; body: unknown }>) {
  const fn = vi.fn(async (url: string) => {
    const { ok = true, body } = await respond(String(url));
    return { ok, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
