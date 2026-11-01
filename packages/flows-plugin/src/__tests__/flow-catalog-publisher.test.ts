/**
 * flows-plugin bridge publishes the session's flow catalog through declared
 * event forwarding (`dashboard-flows:catalog` → `flow_catalog`, `latest`).
 * See change: flows-dock-chip-and-panel-actions (test-plan E1–E7, X4).
 */
import {
  BRIDGE_READY_CHANNEL,
  REGISTER_EVENT_FORWARD_CHANNEL,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFlowCatalogPublisher } from "../bridge/flow-catalog-publisher.js";
import { FLOW_CATALOG_CHANNEL } from "../flow-catalog-contract.js";
import { FLOW_FILES_REQUEST_EVENT } from "../flow-files-contract.js";

type Listener = (data: unknown) => void;

/** Fake pi whose `flow:list-flows` answer is controlled by `answer` (undefined = no listener). */
function fakePi(initial?: unknown[]) {
  const state = { answer: initial as unknown[] | undefined };
  const listeners = new Map<string, Listener[]>();
  const piListeners = new Map<string, Array<() => void>>();
  const emitted: Array<{ name: string; data: unknown }> = [];
  const events = {
    on: (name: string, fn: Listener) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
    emit: (name: string, data: unknown) => {
      if (name === "flow:list-flows" && state.answer !== undefined) (data as { flows?: unknown }).flows = state.answer;
      emitted.push({ name, data });
      for (const fn of listeners.get(name) ?? []) fn(data);
    },
  };
  return {
    state,
    events,
    emitted,
    catalogs: () => emitted.filter((e) => e.name === FLOW_CATALOG_CHANNEL).map((e) => e.data as { catalogKey: string; flows: unknown[] }),
    declarations: () => emitted.filter((e) => e.name === REGISTER_EVENT_FORWARD_CHANNEL),
    on: (name: string, fn: () => void) => piListeners.set(name, [...(piListeners.get(name) ?? []), fn]),
    fire: (name: string) => {
      for (const fn of piListeners.get(name) ?? []) fn();
    },
  };
}

const BATCH = { name: "batch:apply", description: "Apply a batch", source: "/p/.pi/flows/flows/batch/apply/flow.yaml", taskRequired: true };
const SHIP = { name: "ship-it", description: "", source: "/pkg/flows/ship-it/flow.yaml", taskRequired: false };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Start and let the attach-time publish settle, then clear the log. */
async function started(pi: ReturnType<typeof fakePi>) {
  startFlowCatalogPublisher(pi);
  await vi.advanceTimersByTimeAsync(1_000);
  pi.emitted.length = 0;
}

describe("flow catalog publisher", () => {
  it("E1: an unanswered probe publishes nothing (previous catalog stays latest)", async () => {
    const pi = fakePi([BATCH]);
    startFlowCatalogPublisher(pi);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pi.catalogs()).toHaveLength(1);
    pi.state.answer = undefined;
    pi.events.emit("flow:rediscover", {});
    pi.fire("session_start");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pi.catalogs()).toHaveLength(1);
  });

  it("E2: an answered empty probe publishes an empty catalog", async () => {
    const pi = fakePi([{ name: "old-flow" }]);
    await started(pi);
    pi.state.answer = [];
    pi.events.emit("flow:rediscover", {});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pi.catalogs()).toEqual([{ catalogKey: "catalog", flows: [] }]);
  });

  it("E3: session_start publishes the full entries under the fixed key", async () => {
    const pi = fakePi([BATCH, SHIP]);
    await started(pi);
    pi.fire("session_start");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pi.catalogs()).toEqual([{ catalogKey: "catalog", flows: [BATCH, SHIP] }]);
  });

  it("E4: triggers 299 ms apart coalesce into one publish at t=599 ms", async () => {
    const pi = fakePi([BATCH]);
    await started(pi);
    pi.events.emit("flow:rediscover", {});
    await vi.advanceTimersByTimeAsync(299);
    pi.events.emit("flow:complete", {});
    await vi.advanceTimersByTimeAsync(299);
    expect(pi.catalogs()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(pi.catalogs()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pi.catalogs()).toHaveLength(1);
  });

  it("E5: triggers 301 ms apart publish twice", async () => {
    const pi = fakePi([BATCH]);
    await started(pi);
    pi.events.emit("flow:rediscover", {});
    await vi.advanceTimersByTimeAsync(301);
    pi.events.emit("flow:complete", {});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pi.catalogs()).toHaveLength(2);
  });

  it.each([
    ["session_start", (pi: ReturnType<typeof fakePi>) => pi.fire("session_start")],
    ["flow:rediscover", (pi: ReturnType<typeof fakePi>) => pi.events.emit("flow:rediscover", {})],
    ["flow:complete", (pi: ReturnType<typeof fakePi>) => pi.events.emit("flow:complete", {})],
    ["flow:register-flows-dir", (pi: ReturnType<typeof fakePi>) => pi.events.emit("flow:register-flows-dir", { dir: "/x" })],
    ["flow:unregister-agents-dir", (pi: ReturnType<typeof fakePi>) => pi.events.emit("flow:unregister-agents-dir", { dir: "/x" })],
    [FLOW_FILES_REQUEST_EVENT, (pi: ReturnType<typeof fakePi>) => pi.events.emit(FLOW_FILES_REQUEST_EVENT, {})],
  ])("E6: %s publishes once", async (_name, fire) => {
    const pi = fakePi([BATCH]);
    await started(pi);
    fire(pi);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pi.catalogs()).toHaveLength(1);
  });

  it("E6: attach publishes once", async () => {
    const pi = fakePi([BATCH]);
    startFlowCatalogPublisher(pi);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pi.catalogs()).toHaveLength(1);
  });

  it("a rediscover ask makes pi-flows re-read before publishing", async () => {
    const pi = fakePi([BATCH]);
    await started(pi);
    pi.events.emit(FLOW_FILES_REQUEST_EVENT, { rediscover: true });
    expect(pi.emitted.some((e) => e.name === "flow:rediscover")).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pi.catalogs()).toHaveLength(1);
  });

  it("E7: declares on start and re-declares on every bridge-ready", async () => {
    const pi = fakePi([BATCH]);
    startFlowCatalogPublisher(pi);
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    const decls = pi.declarations();
    expect(decls).toHaveLength(3);
    for (const d of decls) {
      expect(d.data).toEqual({
        pluginId: "flows",
        channels: { "dashboard-flows:catalog": { as: "flow_catalog", delivery: "latest", key: "catalogKey" } },
      });
    }
  });

  it("X4: pi-flows absent at attach, present at a later session_start → only the second publishes", async () => {
    const pi = fakePi(undefined);
    startFlowCatalogPublisher(pi);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pi.catalogs()).toHaveLength(0);
    pi.state.answer = [BATCH];
    pi.fire("session_start");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pi.catalogs()).toEqual([{ catalogKey: "catalog", flows: [BATCH] }]);
  });

  it("never throws without an events bus", () => {
    expect(() => startFlowCatalogPublisher({})).not.toThrow();
  });
});
