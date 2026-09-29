/**
 * flows-plugin bridge reports the files its session's pi-flows uses
 * (`flow:list-flows` + `flow:get-agents`) to the plugin server over the private
 * request lane. See change: attach-flow-before-run.
 */
import { PLUGIN_REQUEST_SYMBOL } from "@blackbelt-technology/dashboard-plugin-runtime/bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectFlowFiles, startFlowFilesReporter } from "../bridge/flow-files-reporter.js";
import { FLOW_FILES_REPORT, FLOW_FILES_REQUEST_EVENT } from "../flow-files-contract.js";

type Listener = (data: unknown) => void;

function fakePi() {
  const listeners = new Map<string, Listener[]>();
  const piListeners = new Map<string, Array<() => void>>();
  const events = {
    on: (name: string, fn: Listener) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
    emit: (name: string, data: unknown) => {
      if (name === "flow:list-flows") (data as { flows?: unknown }).flows = [{ name: "ns:a", source: "/p/flows/ns/a/flow.yaml" }];
      if (name === "flow:get-agents") {
        (data as { agents?: unknown }).agents = new Map([
          ["filler", { name: "filler", source: "/p/agents/filler.md" }],
          ["nosrc", { name: "nosrc" }],
        ]);
      }
      for (const fn of listeners.get(name) ?? []) fn(data);
    },
  };
  return {
    events,
    on: (name: string, fn: () => void) => piListeners.set(name, [...(piListeners.get(name) ?? []), fn]),
    fire: (name: string) => {
      for (const fn of piListeners.get(name) ?? []) fn();
    },
  };
}

const g = globalThis as Record<symbol, unknown>;
let lane: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  lane = vi.fn(async () => ({ ok: true, result: { ok: true } }));
  g[PLUGIN_REQUEST_SYMBOL] = lane;
});
afterEach(() => {
  vi.useRealTimers();
  delete g[PLUGIN_REQUEST_SYMBOL];
});

describe("collectFlowFiles", () => {
  it("reads flows and agents with sources from pi-flows", () => {
    expect(collectFlowFiles(fakePi().events)).toEqual({
      flows: [{ name: "ns:a", source: "/p/flows/ns/a/flow.yaml" }],
      agents: [{ name: "filler", source: "/p/agents/filler.md" }],
    });
  });
});

describe("startFlowFilesReporter", () => {
  it("reports after session_start, on registration events, and when the server asks", async () => {
    const pi = fakePi();
    startFlowFilesReporter(pi);
    pi.fire("session_start");
    await vi.advanceTimersByTimeAsync(500);
    expect(lane).toHaveBeenCalledTimes(1);
    expect(lane).toHaveBeenCalledWith("flows", FLOW_FILES_REPORT, expect.objectContaining({ agents: [{ name: "filler", source: "/p/agents/filler.md" }] }));

    pi.events.emit("flow:register-flows-dir", { dir: "/x" });
    pi.events.emit("flow:register-agents-dir", { dir: "/y" });
    await vi.advanceTimersByTimeAsync(500);
    expect(lane).toHaveBeenCalledTimes(2); // debounced into one

    pi.events.emit(FLOW_FILES_REQUEST_EVENT, {});
    await vi.advanceTimersByTimeAsync(500);
    expect(lane).toHaveBeenCalledTimes(3);
  });

  it("retries while the dashboard lane is unavailable", async () => {
    lane.mockResolvedValueOnce({ ok: false, error: "unavailable" }).mockResolvedValueOnce({ ok: false, error: "disconnected" });
    const pi = fakePi();
    startFlowFilesReporter(pi);
    pi.fire("session_start");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lane).toHaveBeenCalledTimes(3);
  });

  it("never throws when pi-flows is absent", async () => {
    const pi = { events: { on: () => {}, emit: () => {} }, on: (_n: string, fn: () => void) => fn() };
    expect(() => startFlowFilesReporter(pi)).not.toThrow();
    await vi.advanceTimersByTimeAsync(500);
    expect(lane).toHaveBeenCalledWith("flows", FLOW_FILES_REPORT, { flows: [], agents: [] });
  });
});
