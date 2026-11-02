/**
 * `useFlowCatalog`: catalog from the session's event stream; while unknown the
 * viewed session's consumer asks the plugin server every 5 s (first ask after
 * one interval, so a replayed catalog needs none), up to 12 attempts per view,
 * and stops once a catalog arrives.
 * See change: flows-dock-chip-and-panel-actions (test-plan E12, E13, X3, X5).
 */
import { initPluginConfigs, publishSessionEvent } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFlowCatalog } from "../client/useFlowCatalog.js";
import { catalogAsks, ev, publishCatalog, tree } from "./flows-test-harness.js";

let n = 0;
const nextSid = () => `cat-S-${++n}`;
let view: ReturnType<typeof useFlowCatalog> | null = null;
function Probe({ sid, autoAsk = true }: { sid: string; autoAsk?: boolean }) {
  view = useFlowCatalog(sid, { autoAsk });
  return <span data-testid="known">{String(view.known)}</span>;
}

beforeEach(() => {
  vi.useFakeTimers();
  initPluginConfigs({ flows: {} });
  view = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useFlowCatalog re-ask", () => {
  it("E12: 12 asks at 5 s spacing over 60 s, none after the 12th", async () => {
    const send = vi.fn();
    const sid = nextSid();
    render(tree(<Probe sid={sid} />, send));
    expect(catalogAsks(send)).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(catalogAsks(send)).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(catalogAsks(send)).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(55_000);
    });
    expect(catalogAsks(send)).toHaveLength(12);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(catalogAsks(send)).toHaveLength(12);
    expect(catalogAsks(send)[0]).toEqual({ type: "plugin_action", pluginId: "flows", sessionId: sid, action: "flow.request-catalog", payload: {} });
  });

  it("E13: a catalog event stops further asks", async () => {
    const send = vi.fn();
    const sid = nextSid();
    render(tree(<Probe sid={sid} />, send));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(catalogAsks(send)).toHaveLength(3);
    act(() => publishCatalog(sid, []));
    expect(view?.known).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(catalogAsks(send)).toHaveLength(3);
  });

  it("a catalog arriving with replay before the first interval needs no ask", async () => {
    const send = vi.fn();
    const sid = nextSid();
    render(tree(<Probe sid={sid} />, send));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => publishCatalog(sid, []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(catalogAsks(send)).toHaveLength(0);
  });

  it("X3: an ask lost while the bridge reconnects is retried; the catalog then becomes known", async () => {
    const sid = nextSid();
    // The plugin server answers the SECOND ask (first emit returned false).
    let asks = 0;
    const send = vi.fn((m: unknown) => {
      if ((m as { action?: string }).action !== "flow.request-catalog") return;
      asks++;
      if (asks === 2) publishCatalog(sid, [{ name: "a", description: "", source: "", taskRequired: false }]);
    });
    render(tree(<Probe sid={sid} />, send));
    expect(view?.known).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(view?.known).toBe(true);
    expect(view?.flows.map((f) => f.name)).toEqual(["a"]);
  });

  it("X5: a catalog evicted from the history (unknown on view) is asked for and republished", async () => {
    const sid = nextSid();
    // Session history holds flow events but no catalog (trimmed / dropped).
    publishSessionEvent(sid, ev("flow_started", 1, { flowName: "f", task: "", steps: [] }));
    const send = vi.fn((m: unknown) => {
      if ((m as { action?: string }).action === "flow.request-catalog") publishCatalog(sid, []);
    });
    render(tree(<Probe sid={sid} />, send));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(catalogAsks(send)).toHaveLength(1);
    expect(view?.known).toBe(true);
  });

  it("consumers without autoAsk never ask on their own; refresh asks on demand", () => {
    const send = vi.fn();
    render(tree(<Probe sid={nextSid()} autoAsk={false} />, send));
    expect(catalogAsks(send)).toHaveLength(0);
    act(() => view?.refresh({ rediscover: true }));
    expect(catalogAsks(send)).toEqual([expect.objectContaining({ payload: { rediscover: true } })]);
  });

  it("re-ask timings follow the plugin config", async () => {
    initPluginConfigs({ flows: { catalogReaskIntervalSec: 1, catalogReaskAttempts: 3 } });
    const send = vi.fn();
    render(tree(<Probe sid={nextSid()} />, send));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(catalogAsks(send)).toHaveLength(3);
  });
});
