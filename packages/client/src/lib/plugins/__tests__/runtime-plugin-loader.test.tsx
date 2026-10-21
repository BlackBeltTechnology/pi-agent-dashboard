/**
 * Runtime plugin loader (tasks 6.14/6.15/6.17/6.18). Fake listing + fake entry modules; real slot
 * registry, i18n store, back-target store, event-type-owner store, reducer registry.
 * test-plan #E75 (a,b), #E86, #E87, #X10, #E93-adjacent registration; #E86 parity.
 * See change: decouple-plugins-from-core.
 */
import {
  createSlotRegistry,
  getSlotClaimsVersion,
  PluginContextProvider,
  SessionCardBadgeSlot,
  type SlotRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { RouteDescriptor } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/route-descriptor.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatMessage, createInitialState, type SessionState } from "../../chat/event-reducer.js";
import { t } from "../../i18n/i18n.js";
import { computeBackTarget, registerPluginRouteDescriptors } from "../../nav/back-target.js";
import { getEventTypeOwners, setEventTypeOwners } from "../event-type-owners.js";
import {
  __resetRuntimeLoaderForTests,
  getRuntimeLoaderState,
  loadRuntimePlugins,
  RUNTIME_PLUGINS_REGISTERED_EVENT,
  type RuntimeListingEntry,
  type RuntimeLoaderDeps,
  regroupAllSessionStates,
  startRuntimePluginLoader,
} from "../runtime-plugin-loader.js";

const SHA1 = "a".repeat(64);
const SHA2 = "b".repeat(64);

function listingEntry(over: Partial<RuntimeListingEntry> & { id: string }): RuntimeListingEntry {
  return {
    displayName: over.id,
    priority: 1000,
    sha256: SHA1,
    entry: `/plugin-assets/${over.id}/${SHA1}/client.js`,
    eventTypes: [],
    claims: [],
    routes: [],
    ...over,
  };
}

let registry: SlotRegistry;
let buildTimeRoutes: RouteDescriptor[];

function deps(over: Partial<RuntimeLoaderDeps> & { listing?: RuntimeListingEntry[]; modules?: Record<string, Record<string, unknown>> } = {}) {
  const { listing = [], modules = {}, ...rest } = over;
  const importModule = vi.fn(async (url: string) => {
    const mod = modules[url];
    if (!mod) throw new Error(`cannot import ${url}`);
    return mod;
  });
  const fetchListing = vi.fn(async () => listing);
  const d: RuntimeLoaderDeps = {
    registry,
    buildTimeIds: new Set(["flows"]),
    buildTimeRoutes,
    getApiBase: () => "",
    hasImportMap: () => true,
    fetchListing,
    importModule,
    ...rest,
  };
  return { d, importModule, fetchListing };
}

beforeEach(() => {
  __resetRuntimeLoaderForTests();
  registry = createSlotRegistry();
  buildTimeRoutes = [{ pattern: "/flows/run/:sid", depth: 2 }, { pattern: "/goal", depth: 1 }];
  registerPluginRouteDescriptors(buildTimeRoutes);
  setEventTypeOwners([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.head.querySelectorAll("link[data-plugin-styles]").forEach((l) => l.remove());
});

const session = (id: string) => ({ id, cwd: "/repo", source: "tui", status: "active", startedAt: 0 }) as DashboardSession;

describe("skip conditions (#E75)", () => {
  it("(a) a page without an import map: no listing fetch, no import, no <link>; notice state", async () => {
    const { d, importModule, fetchListing } = deps({ hasImportMap: () => false, listing: [listingEntry({ id: "ext", styles: "/plugin-assets/ext/x/s.css" })] });
    await loadRuntimePlugins(d);
    expect(fetchListing).not.toHaveBeenCalled();
    expect(importModule).not.toHaveBeenCalled();
    expect(document.head.querySelectorAll("link[data-plugin-styles]")).toHaveLength(0);
    expect(getRuntimeLoaderState().status).toBe("no-import-map");
    expect(registry.getAllClaims()).toHaveLength(0);
  });

  it("(b) a remote API base: 0 listing fetch, notice state", async () => {
    const { d, importModule, fetchListing } = deps({ getApiBase: () => "https://remote:8000", listing: [listingEntry({ id: "ext" })] });
    await loadRuntimePlugins(d);
    expect(fetchListing).not.toHaveBeenCalled();
    expect(importModule).not.toHaveBeenCalled();
    expect(getRuntimeLoaderState().status).toBe("remote-server");
  });
});

describe("registration parity (#E86)", () => {
  it("registers entry functions, catalog, routes, names, owners; lazy module stays lazy; same-id build-time skipped; bump called", async () => {
    const Ready = () => <span data-testid="ready">ready</span>;
    const isQuota = vi.fn((s: DashboardSession) => s.id === "s1");
    const Lazy = () => <span data-testid="lazy">lazy</span>;
    const lazyModule = vi.fn(async () => ({ Board: Lazy }));
    const reducer = { reduce: vi.fn() };
    const ext = listingEntry({
      id: "ext",
      displayName: "Ext Plugin",
      i18nCatalog: "catalog",
      eventTypes: ["ext_*"],
      claims: [
        { slot: "session-card-badge", component: "Badge", shouldRender: "isQuotaSession" },
        { slot: "session-card-flows", component: "Board", module: "/plugin-assets/ext/s/Board.js" },
        { slot: "shell-overlay-route", path: "/ext/run/:sid", depth: 2, parentPath: "/ext" },
      ],
      routes: [{ pattern: "/ext/run/:sid", depth: 2, parentPath: "/ext" }],
    });
    const flowsDup = listingEntry({ id: "flows", claims: [{ slot: "session-card-badge", component: "Nope" }] });
    const { d, importModule } = deps({
      listing: [ext, flowsDup],
      modules: {
        [ext.entry]: { Badge: Ready, isQuotaSession: isQuota, catalog: { en: { hello: "Hello" } }, sessionEventReducer: reducer },
        "/plugin-assets/ext/s/Board.js": { Board: Lazy },
      },
    });
    d.importModule = vi.fn(async (url: string) => (url === "/plugin-assets/ext/s/Board.js" ? lazyModule() : importModule(url)));
    const versionBefore = getSlotClaimsVersion();
    const registered = vi.fn();
    window.addEventListener(RUNTIME_PLUGINS_REGISTERED_EVENT, registered);

    await loadRuntimePlugins(d);
    window.removeEventListener(RUNTIME_PLUGINS_REGISTERED_EVENT, registered);

    // entry fns used; flows (build-time id) never imported
    expect(importModule).toHaveBeenCalledTimes(1);
    expect(importModule).toHaveBeenCalledWith(ext.entry);
    expect(registry.getClaims("session-card-badge").map((c) => c.pluginId)).toEqual(["ext"]);
    expect(registry.getClaims("session-card-badge")[0].shouldRender).toBe(isQuota);
    // lazy module: 0 imports until first render
    expect(lazyModule).toHaveBeenCalledTimes(0);
    render(
      <PluginContextProvider registry={registry}>
        <SessionCardBadgeSlot session={session("s1")} />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("ready")).toBeDefined(); // runtime predicate honoured (#E87)
    // catalog
    expect(t("plugin.ext.hello")).toBe("Hello");
    // routes: build-time kept, runtime added at its declared depth with parent
    expect(computeBackTarget("/flows/run/abc")).toBe("/");
    expect(computeBackTarget("/ext/run/xyz")).toBe("/ext");
    // names + owners + bump + event
    expect(getRuntimeLoaderState().names).toEqual({ ext: "Ext Plugin" });
    expect(getEventTypeOwners()).toEqual([{ ownerId: "ext", displayName: "Ext Plugin", eventTypes: ["ext_*"] }]);
    expect(getSlotClaimsVersion()).toBeGreaterThan(versionBefore);
    expect(registered).toHaveBeenCalledTimes(1);

    // the lazy claim fetches its module once at first render
    const lazyClaimEntry = registry.getClaims("session-card-flows")[0];
    const LazyC = lazyClaimEntry.Component as React.ComponentType;
    render(
      <PluginContextProvider registry={registry}>
        <React.Suspense fallback={null}>
          <LazyC />
        </React.Suspense>
      </PluginContextProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("lazy")).toBeDefined());
    expect(lazyModule).toHaveBeenCalledTimes(1);
  });

  it("a runtime predicate is honoured per session (#E87)", async () => {
    const Badge = () => <span data-testid="badge">b</span>;
    const ext = listingEntry({ id: "quota-ui", claims: [{ slot: "session-card-badge", component: "Badge", shouldRender: "isQuotaSession" }] });
    const { d } = deps({ listing: [ext], modules: { [ext.entry]: { Badge, isQuotaSession: (s: DashboardSession) => s.id === "s1" } } });
    await loadRuntimePlugins(d);
    const view = (id: string) => (
      <PluginContextProvider registry={registry}>
        <SessionCardBadgeSlot session={session(id)} />
      </PluginContextProvider>
    );
    const { container, rerender } = render(view("s1"));
    expect(container.querySelectorAll("[data-testid=badge]")).toHaveLength(1);
    rerender(view("s2"));
    expect(container.querySelectorAll("[data-testid=badge]")).toHaveLength(0);
  });

  it("a missing predicate export skips the whole plugin, leaving nothing half-registered", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const ext = listingEntry({ id: "broken", claims: [{ slot: "session-card-badge", component: "Badge", shouldRender: "gone" }] });
    const { d } = deps({ listing: [ext], modules: { [ext.entry]: { Badge: () => null } } });
    await loadRuntimePlugins(d);
    expect(registry.getAllClaims()).toHaveLength(0);
    expect(registry.getEventTypeOwners()).toHaveLength(0);
    expect(err.mock.calls.some((c) => c.join(" ").includes("broken"))).toBe(true);
  });
});

describe("failing entry import (#X10)", () => {
  it("skips ext1 (logs its id) and still registers ext2", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const ext1 = listingEntry({ id: "ext1", claims: [{ slot: "session-card-badge", component: "B" }] });
    const ext2 = listingEntry({ id: "ext2", claims: [{ slot: "session-card-badge", component: "B" }] });
    const { d } = deps({ listing: [ext1, ext2], modules: { [ext2.entry]: { B: () => null } } });
    await loadRuntimePlugins(d);
    expect(registry.getClaims("session-card-badge").map((c) => c.pluginId)).toEqual(["ext2"]);
    expect(err.mock.calls.some((c) => c.join(" ").includes("ext1"))).toBe(true);
  });
});

describe("styles on first claim render (6.15)", () => {
  it("is absent before the first render, present after, attached once", async () => {
    const href = `/plugin-assets/ext/${SHA1}/client.css`;
    const ext = listingEntry({ id: "ext", styles: href, claims: [{ slot: "session-card-badge", component: "B" }, { slot: "session-card-flows", component: "B" }] });
    const { d } = deps({ listing: [ext], modules: { [ext.entry]: { B: () => <i data-testid="b" /> } } });
    await loadRuntimePlugins(d);
    expect(document.head.querySelectorAll(`link[href="${href}"]`)).toHaveLength(0);
    const { rerender } = render(
      <PluginContextProvider registry={registry}>
        <SessionCardBadgeSlot session={session("s1")} />
      </PluginContextProvider>,
    );
    expect(document.head.querySelectorAll(`link[href="${href}"]`)).toHaveLength(1);
    rerender(
      <PluginContextProvider registry={registry}>
        <SessionCardBadgeSlot session={session("s2")} />
      </PluginContextProvider>,
    );
    expect(document.head.querySelectorAll(`link[href="${href}"]`)).toHaveLength(1);
  });
});

describe("plugins-changed state machine (#E93)", () => {
  it("adds a newly admitted plugin live; an upgraded one asks for a reload and is never re-imported", async () => {
    const reload = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", { value: { ...orig, reload }, configurable: true });
    const ext = listingEntry({ id: "ext", claims: [{ slot: "session-card-badge", component: "B" }] });
    const ext3 = listingEntry({ id: "ext3", claims: [{ slot: "session-card-flows", component: "B" }] });
    let listing = [ext];
    const { d, importModule } = deps({ modules: { [ext.entry]: { B: () => null }, [ext3.entry]: { B: () => null } } });
    d.fetchListing = async () => listing;
    const stop = startRuntimePluginLoader(d);
    await loadRuntimePlugins(d); // serialised after the boot pass
    expect(importModule).toHaveBeenCalledTimes(1);
    expect(getRuntimeLoaderState().reloadNeeded).toBe(false);

    // upgrade: same id, new hash
    listing = [{ ...ext, sha256: SHA2, entry: `/plugin-assets/ext/${SHA2}/client.js` }];
    await act(async () => {
      window.dispatchEvent(new CustomEvent("plugins-changed", { detail: { plugins: [] } }));
      await loadRuntimePlugins(d);
    });
    expect(getRuntimeLoaderState().reloadNeeded).toBe(true);
    expect(importModule).toHaveBeenCalledTimes(1); // not re-imported

    // install: ext3 appears live
    listing = [{ ...ext, sha256: SHA2 }, ext3];
    await act(async () => {
      window.dispatchEvent(new CustomEvent("plugins-changed", { detail: { plugins: [] } }));
      await loadRuntimePlugins(d);
    });
    expect(importModule).toHaveBeenCalledTimes(2);
    expect(registry.getClaims("session-card-flows").map((c) => c.pluginId)).toEqual(["ext3"]);
    expect(reload).not.toHaveBeenCalled();
    stop();
    Object.defineProperty(window, "location", { value: orig, configurable: true });
  });

  it("a loaded plugin that disappears from the listing raises the reload notice", async () => {
    const ext = listingEntry({ id: "ext", claims: [{ slot: "session-card-badge", component: "B" }] });
    let listing = [ext];
    const { d } = deps({ modules: { [ext.entry]: { B: () => null } } });
    d.fetchListing = async () => listing;
    await loadRuntimePlugins(d);
    listing = [];
    await loadRuntimePlugins(d);
    expect(getRuntimeLoaderState().reloadNeeded).toBe(true);
    expect(registry.getClaims("session-card-badge")).toHaveLength(1); // module kept until reload
  });
});

describe("late event-type owners (6.18)", () => {
  const raw = (type: string, ts: number): ChatMessage => ({ id: `raw-${type}-${ts}`, role: "rawEvent", content: JSON.stringify({ ts }), timestamp: ts, toolName: type });

  it("a runtime plugin's eventTypes + displayName become owners, and every loaded session regroups its earlier raw rows", async () => {
    const s1 = createInitialState();
    s1.messages = [{ id: "u", role: "user", content: "hi", timestamp: 0 }, raw("quota_tick", 1), { id: "a", role: "assistant", content: "x", timestamp: 2 }, raw("quota_tick", 3)];
    const s2 = createInitialState();
    s2.messages = [raw("other_evt", 1)];
    let states = new Map<string, SessionState>([["s1", s1], ["s2", s2]]);
    // App's subscriber: owners from the event detail → regroup every loaded state.
    const onRegistered = (e: Event) => {
      states = regroupAllSessionStates(states, (e as CustomEvent).detail.owners);
    };
    window.addEventListener(RUNTIME_PLUGINS_REGISTERED_EVENT, onRegistered);
    const ext = listingEntry({ id: "quota-ui", displayName: "Quota", eventTypes: ["quota_*"] });
    const { d } = deps({ listing: [ext], modules: { [ext.entry]: {} } });
    await loadRuntimePlugins(d);
    window.removeEventListener(RUNTIME_PLUGINS_REGISTERED_EVENT, onRegistered);

    expect(getEventTypeOwners()).toEqual([{ ownerId: "quota-ui", displayName: "Quota", eventTypes: ["quota_*"] }]);
    const rows = states.get("s1")!.messages;
    expect(rows.map((m) => m.role)).toEqual(["user", "rawEvent", "assistant"]);
    expect(rows[1].ownedGroup).toMatchObject({ ownerId: "quota-ui", count: 2 });
    expect(states.get("s2")).toBe(s2); // untouched session keeps its identity
  });

  it("returns the same map when nothing matches", () => {
    const st = createInitialState();
    st.messages = [raw("other_evt", 1)];
    const m = new Map([["s", st]]);
    expect(regroupAllSessionStates(m, [{ ownerId: "x", displayName: "X", eventTypes: ["quota_*"] }])).toBe(m);
  });
});
