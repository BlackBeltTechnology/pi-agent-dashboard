/**
 * L1 — the shared `role: "custom"` render container (change:
 * add-custom-entry-renderer-slot).
 *
 * Covers the resolution chain (claim → fallback), the group-visibility gate,
 * the fail-closed `shouldRender` contract, the per-claim ErrorBoundary, and the
 * collapsed-first fetch contract (test-plan F1, F2, F11, P1, P2, X1, X2, X10).
 */
import { DISPLAY_PRESETS, type DisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { createSlotRegistry, bumpSlotClaimsVersion } from "@blackbelt-technology/dashboard-plugin-runtime";
import { PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../../lib/chat/event-reducer.js";
import { DisplayPrefsProvider } from "../../../lib/state/DisplayPrefsContext.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { CustomEntryRow } from "../CustomEntryRow.js";

// jsdom implements neither matchMedia nor scrollTo; shim them for the suite.
beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: { payload: { ok: true } } }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function customMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "c1",
    role: "custom",
    customType: "om.observations.recorded",
    content: '{"observations":[]}',
    timestamp: 1756300000000,
    ...overrides,
  };
}

type StubProps = {
  customType: string;
  expanded: boolean;
  onToggle: () => void;
  entryId?: string;
  payload?: unknown;
  payloadError?: string;
  payloadLoading: boolean;
};

function StubPlugin(props: StubProps) {
  return (
    <div
      data-testid="stub-plugin"
      data-expanded={String(props.expanded)}
      data-error={props.payloadError ?? ""}
      data-payload={JSON.stringify(props.payload ?? null)}
    >
      <span data-testid="stub-line">{props.customType}</span>
      {props.entryId ? (
        <button data-testid="stub-toggle" onClick={props.onToggle}>
          expand
        </button>
      ) : null}
    </div>
  );
}

function registryWith(claim: {
  customType: string;
  Component?: React.ComponentType<StubProps>;
  shouldRender?: (input?: unknown) => boolean;
}) {
  const registry = createSlotRegistry();
  registry.addClaim({
    pluginId: "test-plugin",
    priority: 100,
    slot: "custom-entry-renderer",
    customType: claim.customType,
    Component: (claim.Component ?? StubPlugin) as never,
    ...(claim.shouldRender ? { shouldRender: claim.shouldRender } : {}),
  });
  return registry;
}

function renderRow(
  msg: ChatMessage,
  opts: {
    registry?: ReturnType<typeof createSlotRegistry>;
    prefs?: DisplayPrefs;
    sessionOverride?: Partial<DisplayPrefs>;
  } = {},
) {
  const body = (
    <ThemeProvider>
      <DisplayPrefsProvider
        value={{
          global: opts.prefs ?? DISPLAY_PRESETS.standard,
          getSessionOverride: () => opts.sessionOverride,
        }}
      >
        <CustomEntryRow msg={msg} sessionId="s1" />
      </DisplayPrefsProvider>
    </ThemeProvider>
  );
  return render(
    opts.registry ? <PluginContextProvider registry={opts.registry}>{body}</PluginContextProvider> : body,
  );
}

describe("CustomEntryRow — resolution chain", () => {
  it("F1: a plugin claim wins over the fallback", () => {
    renderRow(customMsg(), { registry: registryWith({ customType: "om.observations.recorded" }) });
    expect(screen.getByTestId("stub-plugin")).toBeTruthy();
    expect(screen.queryByTestId("custom-entry-card")).toBeNull();
  });

  it("falls back to CustomEntryCard when no claim matches the customType", () => {
    renderRow(customMsg({ customType: "other.type" }), {
      registry: registryWith({ customType: "om.observations.recorded" }),
    });
    expect(screen.getByTestId("custom-entry-card")).toBeTruthy();
    expect(screen.queryByTestId("stub-plugin")).toBeNull();
  });

  it("X2: shouldRender=false falls through to the fallback", () => {
    renderRow(customMsg(), {
      registry: registryWith({ customType: "om.observations.recorded", shouldRender: () => false }),
    });
    expect(screen.getByTestId("custom-entry-card")).toBeTruthy();
    expect(screen.queryByTestId("stub-plugin")).toBeNull();
  });

  it("X2: a THROWING shouldRender is contained and falls through (fail-closed)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderRow(customMsg(), {
      registry: registryWith({
        customType: "om.observations.recorded",
        shouldRender: () => {
          throw new Error("boom");
        },
      }),
    });
    expect(screen.getByTestId("custom-entry-card")).toBeTruthy();
    expect(warn).toHaveBeenCalled();
  });

  it("X1: a THROWING renderer lands on the fallback; transcript does not unmount", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Boom(): React.ReactElement {
      throw new Error("renderer crash");
    }
    renderRow(customMsg({ id: "boom" }), {
      registry: registryWith({ customType: "om.observations.recorded", Component: Boom as never }),
    });
    expect(screen.getByTestId("custom-entry-card")).toBeTruthy();
  });

  it("re-reads claims when the plugin enabled-set resolves (disabled plugin falls back)", async () => {
    // `setEnabledSet` mutates the SAME registry object, so without the
    // slot-claims invalidation signal the memoized claim would survive and keep
    // rendering a disabled plugin. See change: add-custom-entry-renderer-slot.
    const registry = registryWith({ customType: "om.observations.recorded" });
    renderRow(customMsg(), { registry });
    expect(screen.getByTestId("stub-plugin")).toBeTruthy();
    await act(async () => {
      registry.setEnabledSet(new Set());
      bumpSlotClaimsVersion();
    });
    expect(screen.queryByTestId("stub-plugin")).toBeNull();
    expect(screen.getByTestId("custom-entry-card")).toBeTruthy();
  });
});

describe("CustomEntryRow — group-visibility gate", () => {
  it("F2: a claimed row in a hidden group renders nothing", () => {
    const prefs: DisplayPrefs = {
      ...DISPLAY_PRESETS.standard,
      customEventGroups: { ...DISPLAY_PRESETS.standard.customEventGroups, memory: false },
    };
    renderRow(customMsg({ groupId: "memory" }), {
      registry: registryWith({ customType: "om.observations.recorded" }),
      prefs,
    });
    expect(screen.queryByTestId("stub-plugin")).toBeNull();
    expect(screen.queryByTestId("custom-entry-card")).toBeNull();
  });

  it("renders a claimed row when its group is visible", () => {
    const prefs: DisplayPrefs = {
      ...DISPLAY_PRESETS.standard,
      customEventGroups: { ...DISPLAY_PRESETS.standard.customEventGroups, memory: true },
    };
    renderRow(customMsg({ groupId: "memory" }), {
      registry: registryWith({ customType: "om.observations.recorded" }),
      prefs,
    });
    expect(screen.getByTestId("stub-plugin")).toBeTruthy();
  });

  it("honours a PER-SESSION override, not just the global pref", () => {
    // Regression (add-custom-entry-renderer-slot): the container must call
    // `useDisplayPrefs(sessionId)` — the View popover writes a session override,
    // so reading the bare global pref left every toggled row hidden.
    const prefs: DisplayPrefs = {
      ...DISPLAY_PRESETS.standard,
      customEventGroups: { ...DISPLAY_PRESETS.standard.customEventGroups, memory: false },
    };
    renderRow(customMsg({ groupId: "memory" }), {
      registry: registryWith({ customType: "om.observations.recorded" }),
      prefs,
      sessionOverride: { customEventGroups: { memory: true } },
    });
    expect(screen.getByTestId("stub-plugin")).toBeTruthy();
  });
});

describe("CustomEntryRow — collapsed-first payload contract", () => {
  it("F11: a row without an entryId renders collapsed with no affordance and zero fetches", () => {
    renderRow(customMsg({ entryId: undefined }), {
      registry: registryWith({ customType: "om.observations.recorded" }),
    });
    expect(screen.getByTestId("stub-line")).toBeTruthy();
    expect(screen.queryByTestId("stub-toggle")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("P1: 100 mounted-but-collapsed claimed rows issue ZERO requests", () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      customMsg({ id: `c${i}`, entryId: `e${i}` }),
    );
    const registry = registryWith({ customType: "om.observations.recorded" });
    render(
      <ThemeProvider>
        <DisplayPrefsProvider value={{ global: DISPLAY_PRESETS.standard, getSessionOverride: () => undefined }}>
          <PluginContextProvider registry={registry}>
            <div>
              {rows.map((m) => (
                <CustomEntryRow key={m.id} msg={m} sessionId="s1" />
              ))}
            </div>
          </PluginContextProvider>
        </DisplayPrefsProvider>
      </ThemeProvider>,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("stub-line")).toHaveLength(100);
  });

  it("P2: expanding exactly one row issues exactly ONE request for that entry", async () => {
    const rows = [
      customMsg({ id: "c0", entryId: "e0" }),
      customMsg({ id: "c1", entryId: "e1" }),
    ];
    const registry = registryWith({ customType: "om.observations.recorded" });
    render(
      <ThemeProvider>
        <DisplayPrefsProvider value={{ global: DISPLAY_PRESETS.standard, getSessionOverride: () => undefined }}>
          <PluginContextProvider registry={registry}>
            <div>
              {rows.map((m) => (
                <CustomEntryRow key={m.id} msg={m} sessionId="s1" />
              ))}
            </div>
          </PluginContextProvider>
        </DisplayPrefsProvider>
      </ThemeProvider>,
    );
    const [toggle] = screen.getAllByTestId("stub-toggle");
    toggle.click();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("/api/sessions/s1/entry/e0");
  });

  it("X10: a rejected fetch degrades to the payloadError arm (no unhandled rejection)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network"))));
    renderRow(customMsg({ entryId: "e9" }), {
      registry: registryWith({ customType: "om.observations.recorded" }),
    });
    screen.getByTestId("stub-toggle").click();
    await vi.waitFor(() => {
      expect(screen.getByTestId("stub-plugin").getAttribute("data-error")).toBeTruthy();
    });
  });

  it("X3: a 404 surfaces the evicted error to the renderer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: false, error: "entry not found" }), { status: 404 })),
    );
    renderRow(customMsg({ entryId: "evicted" }), {
      registry: registryWith({ customType: "om.observations.recorded" }),
    });
    screen.getByTestId("stub-toggle").click();
    await vi.waitFor(() => {
      expect(screen.getByTestId("stub-plugin").getAttribute("data-error")).toMatch(/evicted/i);
    });
  });
});
