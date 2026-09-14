import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, render } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  applyPluginConfigUpdate,
  CurrentPluginLayer,
  initPluginConfigs,
  PluginContextProvider,
  useAllSessions,
  usePluginConfig,
  usePluginConfigOf,
  usePluginLogger,
  usePluginMessage,
} from "../plugin-context.js";
import { createSlotRegistry } from "../slot-registry.js";

// Helper: render a component that calls a hook, capture the result
function _renderHook<T>(hookFn: () => T, wrapper: React.FC<{ children: React.ReactNode }>) {
  let result: T;
  function TestComponent() {
    result = hookFn();
    return null;
  }
  render(
    React.createElement(wrapper, { children: React.createElement(TestComponent) }),
  );
  return { get: () => result! };
}

describe("usePluginConfig", () => {
  it("throws when called outside any plugin context", () => {
    // Render without PluginContextProvider
    let error: Error | null = null;
    function Comp() {
      try {
        usePluginConfig();
      } catch (e) {
        error = e as Error;
      }
      return null;
    }
    // We need PluginContextProvider but NOT CurrentPluginContext layer
    render(
      <PluginContextProvider registry={createSlotRegistry()}>
        <Comp />
      </PluginContextProvider>,
    );
    expect(error).not.toBeNull();
    expect(error!.message).toContain("usePluginConfig must be called from a plugin slot contribution");
  });

  it("throws when rendered outside PluginContextProvider", () => {
    let error: Error | null = null;
    function Comp() {
      try {
        usePluginConfig();
      } catch (e) {
        error = e as Error;
      }
      return null;
    }
    render(
      <CurrentPluginLayer pluginId="demo">
        <Comp />
      </CurrentPluginLayer>,
    );
    expect(error).not.toBeNull();
    expect(error!.message).toContain("PluginContextProvider");
  });

  it("returns plugin's own config from CurrentPluginContext", () => {
    const registry = createSlotRegistry();
    let config: Record<string, unknown> | null = null;

    function Comp() {
      config = usePluginConfig<Record<string, unknown>>() as Record<string, unknown>;
      return null;
    }

    // Initialize config before render
    act(() => {
      applyPluginConfigUpdate({ type: "plugin_config_update", id: "demo", config: { foo: 42 } });
    });

    render(
      <PluginContextProvider registry={registry}>
        <CurrentPluginLayer pluginId="demo">
          <Comp />
        </CurrentPluginLayer>
      </PluginContextProvider>,
    );

    expect(config).toBeTruthy();
    expect((config as unknown as Record<string, unknown>).foo).toBe(42);
  });

  it("re-renders on plugin_config_update", async () => {
    const registry = createSlotRegistry();
    let renderCount = 0;
    let lastConfig: Record<string, unknown> = {};

    function Comp() {
      renderCount++;
      lastConfig = usePluginConfig<Record<string, unknown>>();
      return null;
    }

    render(
      <PluginContextProvider registry={registry}>
        <CurrentPluginLayer pluginId="live-plugin">
          <Comp />
        </CurrentPluginLayer>
      </PluginContextProvider>,
    );

    const countBefore = renderCount;

    await act(async () => {
      applyPluginConfigUpdate({
        type: "plugin_config_update",
        id: "live-plugin",
        config: { bar: 99 },
      });
    });

    expect(renderCount).toBeGreaterThan(countBefore);
    expect(lastConfig.bar).toBe(99);
  });

  it("hydrates from initPluginConfigs and notifies already-mounted subscribers (reload path)", async () => {
    const registry = createSlotRegistry();
    let lastConfig: Record<string, unknown> = {};

    function Comp() {
      lastConfig = usePluginConfig<Record<string, unknown>>();
      return null;
    }

    // Component mounts BEFORE the /api/config seed arrives (post-render effect).
    render(
      <PluginContextProvider registry={registry}>
        <CurrentPluginLayer pluginId="hydrate-plugin">
          <Comp />
        </CurrentPluginLayer>
      </PluginContextProvider>,
    );
    expect(lastConfig.editFlow).toBeUndefined();

    // Simulate the boot /api/config fetch seeding the persisted plugins block.
    await act(async () => {
      initPluginConfigs({ "hydrate-plugin": { enabled: true, editFlow: true } });
    });

    expect(lastConfig.editFlow).toBe(true);
    expect(lastConfig.enabled).toBe(true);
  });
});

describe("usePluginLogger", () => {
  it("emits log with [plugin:<id>] prefix", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    function Comp() {
      const logger = usePluginLogger();
      logger.warn("test-message");
      return null;
    }
    render(
      <PluginContextProvider registry={createSlotRegistry()}>
        <CurrentPluginLayer pluginId="my-plugin">
          <Comp />
        </CurrentPluginLayer>
      </PluginContextProvider>,
    );
    expect(warnSpy).toHaveBeenCalledWith("[plugin:my-plugin]", "test-message");
    warnSpy.mockRestore();
  });
});

describe("useAllSessions", () => {
  it("returns the sessions array passed to the provider", () => {
    const sessions: DashboardSession[] = [
      { id: "s1", cwd: "/", source: "tui", status: "active", startedAt: 0 },
    ];
    let result: DashboardSession[] = [];
    function Comp() {
      result = useAllSessions();
      return null;
    }
    render(
      <PluginContextProvider registry={createSlotRegistry()} sessions={sessions}>
        <Comp />
      </PluginContextProvider>,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("s1");
  });
});

// Reactive read of ANOTHER plugin's config (module store, no provider, never
// throws) — needed because the roles catalogue lives in the roles plugin's
// config and only a non-reactive getPluginConfig is public.
// See change: model-picker-everywhere-favorites (design D3, test-plan E13/E14).
describe("usePluginConfigOf", () => {
  it("E13: a never-set plugin id yields one stable frozen empty object across re-renders", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const snapshots: unknown[] = [];
      let forceRender: (() => void) | undefined;
      function Comp() {
        const [, setTick] = React.useState(0);
        forceRender = () => setTick((t) => t + 1);
        snapshots.push(usePluginConfigOf("nope-never-set"));
        return null;
      }
      render(<Comp />);
      act(() => { forceRender?.(); });
      act(() => { forceRender?.(); });
      expect(snapshots.length).toBeGreaterThanOrEqual(3);
      // Same identity every render — a fresh `{}` would loop/​warn.
      expect(Object.is(snapshots[0], snapshots[1])).toBe(true);
      expect(Object.is(snapshots[1], snapshots[2])).toBe(true);
      expect(snapshots[0]).toEqual({});
      expect(
        errorSpy.mock.calls.some((c) => String(c[0]).includes("getSnapshot")),
      ).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("E14: updates when the plugin's config arrives after mount", async () => {
    const snapshots: Record<string, unknown>[] = [];
    let forceRender: (() => void) | undefined;
    function Comp() {
      const [, setTick] = React.useState(0);
      forceRender = () => setTick((t) => t + 1);
      snapshots.push(usePluginConfigOf("reactive-hook-plugin"));
      return null;
    }
    // No PluginContextProvider here — the hook reads the module store directly.
    render(<Comp />);
    expect(snapshots.at(-1)).toEqual({});
    void forceRender;

    await act(async () => {
      applyPluginConfigUpdate({
        type: "plugin_config_update",
        id: "reactive-hook-plugin",
        config: { models: [{ provider: "anthropic", id: "x" }] },
      });
    });

    expect(snapshots.at(-1)).toEqual({ models: [{ provider: "anthropic", id: "x" }] });
  });
});

// ── usePluginMessage — the read half of the shell socket for global frames ──
describe("usePluginMessage", () => {
  /** Minimal EventTarget-ish shell socket. */
  class FakeWs {
    private listeners = new Set<(e: MessageEvent) => void>();
    addEventListener(type: string, fn: (e: MessageEvent) => void): void {
      if (type === "message") this.listeners.add(fn);
    }
    removeEventListener(type: string, fn: (e: MessageEvent) => void): void {
      if (type === "message") this.listeners.delete(fn);
    }
    emit(payload: unknown): void {
      for (const fn of this.listeners) fn({ data: JSON.stringify(payload) } as MessageEvent);
    }
    emitRaw(data: unknown): void {
      for (const fn of this.listeners) fn({ data } as MessageEvent);
    }
  }

  it("delivers only the matching type and detaches on unmount", () => {
    const ws = new FakeWs();
    const seen: unknown[] = [];
    function Comp() {
      usePluginMessage("browser_relay_status", (m) => seen.push(m));
      return null;
    }
    const { unmount } = render(
      <PluginContextProvider registry={createSlotRegistry()} ws={ws as unknown as WebSocket}>
        <Comp />
      </PluginContextProvider>,
    );
    act(() => ws.emit({ type: "other", n: 1 }));
    act(() => ws.emit({ type: "browser_relay_status", auditSeq: 3 }));
    expect(seen).toEqual([{ type: "browser_relay_status", auditSeq: 3 }]);
    unmount();
    // Detached: a later matching frame is not delivered.
    act(() => ws.emit({ type: "browser_relay_status", auditSeq: 4 }));
    expect(seen).toEqual([{ type: "browser_relay_status", auditSeq: 3 }]);
  });

  it("ignores a malformed frame without throwing", () => {
    const ws = new FakeWs();
    const seen: unknown[] = [];
    function Comp() {
      usePluginMessage("browser_relay_status", (m) => seen.push(m));
      return null;
    }
    render(
      <PluginContextProvider registry={createSlotRegistry()} ws={ws as unknown as WebSocket}>
        <Comp />
      </PluginContextProvider>,
    );
    expect(() => act(() => ws.emitRaw("{not json"))).not.toThrow();
    expect(seen).toEqual([]);
  });
});
