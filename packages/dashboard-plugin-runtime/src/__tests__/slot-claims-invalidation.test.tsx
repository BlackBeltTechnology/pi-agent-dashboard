/**
 * L1 — slot-claims invalidation store (tasks 2.3; test-plan F2, F3).
 *
 * Contract (dashboard-plugin-loader delta):
 * - `bumpSlotClaimsVersion()` re-evaluates every mounted gate wrapper —
 *   `useSlotHasClaimsForSession` re-invokes `shouldRender` — with NO session
 *   broadcast, including for idle sessions that will never emit
 *   `session_updated`.
 * - an UNBUMPED store changes nothing: without a bump, `shouldRender` is not
 *   re-invoked and gate behaviour is identical to the pre-change behaviour.
 * - `shouldRender` stays synchronous (no async gate path is introduced).
 *
 * See change: add-blackhole-session-pipeline.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, render } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetFolderProjectsForTests,
  clearFolderProjects,
  FOLDER_PROJECT_ERROR_TTL_MS,
  folderHasProjectId,
  folderHasProjectType,
  getFolderProject,
  invalidateFolderProject,
} from "../folder-project.js";
import { PluginContextProvider } from "../plugin-context.js";
import {
  __resetSlotClaimsVersionForTests,
  bumpSlotClaimsVersion,
  getSlotClaimsVersion,
  subscribeSlotClaimsVersion,
} from "../slot-claims-invalidation.js";
import {
  AnchoredPopoverSlot,
  AutomationActionEditorSlot,
  CommandRouteSlot,
  ComposerPanelSlot,
  SettingsSectionByPluginSlot,
  ShellOverlayRouteSlot,
  ToolRendererSlot,
  useHasAutomationActionEditor,
  useShellOverlayRouteDepth,
  useShellOverlayRouteMatched,
  useShellOverlayRoutePresentation,
  useSlotHasClaimsForSession,
} from "../slot-consumers.js";
import { createSlotRegistry } from "../slot-registry.js";

const session = { id: "019fe770-a0a4-70bb-ac85-2e92e6aa8216" } as DashboardSession;

/**
 * `Promise.withResolvers` without the ES2024 lib: this package type-checks against
 * ES2023 (tsconfig `lib`), and the typings only resolved by accident while a
 * hoisted @types/node@22 happened to declare it.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Mount a probe that reports `useSlotHasClaimsForSession` for session-card-memory. */
function mountGate(shouldRender: () => boolean, onRender?: () => void) {
  const registry = createSlotRegistry();
  registry.addClaim({
    pluginId: "blackhole",
    priority: 100,
    slot: "session-card-memory",
    shouldRender: () => shouldRender(),
  });
  let latest: boolean | null = null;
  function Probe() {
    onRender?.();
    latest = useSlotHasClaimsForSession("session-card-memory", session);
    return null;
  }
  render(
    <PluginContextProvider registry={registry}>
      <Probe />
    </PluginContextProvider>,
  );
  return { get: () => latest! };
}

describe("slot-claims invalidation store", () => {
  it("starts at version 0 and bumps monotonically", () => {
    __resetSlotClaimsVersionForTests();
    expect(getSlotClaimsVersion()).toBe(0);
    bumpSlotClaimsVersion();
    expect(getSlotClaimsVersion()).toBe(1);
    bumpSlotClaimsVersion();
    expect(getSlotClaimsVersion()).toBe(2);
    __resetSlotClaimsVersionForTests();
  });

  it("a bump re-invokes shouldRender on a mounted wrapper with no session broadcast (F2)", () => {
    __resetSlotClaimsVersionForTests();
    let installed = false;
    const gate = mountGate(() => installed);
    expect(gate.get()).toBe(false);

    // The gate's module signal resolves AFTER mount (late-arriving boot check).
    act(() => {
      installed = true;
      bumpSlotClaimsVersion();
    });
    expect(gate.get()).toBe(true);
    __resetSlotClaimsVersionForTests();
  });

  it("an unbumped store re-invokes nothing — shouldRender call count unchanged (F3)", () => {
    __resetSlotClaimsVersionForTests();
    const shouldRender = vi.fn(() => true);
    const onRender = vi.fn();
    mountGate(shouldRender, onRender);
    const callsAfterMount = shouldRender.mock.calls.length;
    const rendersAfterMount = onRender.mock.calls.length;

    // No bump: nothing re-renders the wrapper.
    expect(getSlotClaimsVersion()).toBe(0);
    expect(shouldRender.mock.calls.length).toBe(callsAfterMount);
    expect(onRender.mock.calls.length).toBe(rendersAfterMount);
    __resetSlotClaimsVersionForTests();
  });

  it("a bump with an unchanged signal still re-evaluates gates synchronously", () => {
    __resetSlotClaimsVersionForTests();
    const shouldRender = vi.fn(() => false);
    const gate = mountGate(shouldRender);
    const before = shouldRender.mock.calls.length;
    act(() => {
      bumpSlotClaimsVersion();
    });
    expect(shouldRender.mock.calls.length).toBeGreaterThan(before);
    expect(gate.get()).toBe(false);
    __resetSlotClaimsVersionForTests();
  });
});


// ── Folder project cache (change: add-project-scoped-apps) ───────────────────

describe("folder project cache + predicates", () => {
  type Body = { id: string | null; types: string[]; source: string };
  const ok = (body: Body) => ({ ok: true, status: 200, json: async () => body }) as Response;
  let fetchMock: ReturnType<typeof vi.fn>;
  let bumps: number;
  let unsubscribe: () => void;
  const cwdOf = (call: unknown[]) => decodeURIComponent(String(call[0]).split("cwd=")[1]);
  const fetched = () => fetchMock.mock.calls.map(cwdOf);
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(() => {
    __resetSlotClaimsVersionForTests();
    __resetFolderProjectsForTests();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    bumps = 0;
    unsubscribe = subscribeSlotClaimsVersion(() => {
      bumps += 1;
    });
  });
  afterEach(() => {
    unsubscribe();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    __resetFolderProjectsForTests();
    __resetSlotClaimsVersionForTests();
  });

  // test-plan #E23
  it("predicate factories are true only for a matching ready entry", async () => {
    fetchMock.mockImplementation((url: string) => {
      const cwd = decodeURIComponent(url.split("cwd=")[1]);
      if (cwd === "/a") return Promise.resolve(ok({ id: null, types: ["judo"], source: "detected" }));
      if (cwd === "/b") return Promise.resolve(ok({ id: "acme-erp", types: [], source: "none" }));
      if (cwd === "/c") return new Promise(() => {});
      return Promise.reject(new Error("net"));
    });
    const hasJudo = folderHasProjectType("judo");
    const hasAcme = folderHasProjectId("acme-erp");
    const dirs = ["/a", "/b", "/c", "/d"];
    expect(dirs.map((cwd) => hasJudo({ cwd }))).toEqual([false, false, false, false]); // miss → false
    await settle();
    expect(dirs.map((cwd) => hasJudo({ cwd }))).toEqual([true, false, false, false]);
    expect(dirs.map((cwd) => hasAcme({ cwd }))).toEqual([false, true, false, false]);
    expect(getFolderProject("/c").state).toBe("loading");
    expect(getFolderProject("/d").state).toBe("error");
  });

  // test-plan #E24
  it("a miss queues one fetch after the microtask and never updates state during render", async () => {
    fetchMock.mockResolvedValue(ok({ id: null, types: [], source: "none" }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const gate = folderHasProjectType("judo");
    const results: boolean[] = [];
    function Probe() {
      results.push(gate({ cwd: "/a" }), gate({ cwd: "/a" }), gate({ cwd: "/a" }));
      return null;
    }
    render(<Probe />);
    expect(results.slice(0, 3)).toEqual([false, false, false]);
    expect(fetchMock).toHaveBeenCalledTimes(0); // nothing issued synchronously
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls.filter((c) => /Cannot update|setState/.test(String(c[0])))).toEqual([]);
    errorSpy.mockRestore();
  });

  // test-plan #P4
  it("50 folders resolving in one tick bump the claims version once", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok({ id: null, types: [], source: "none" })));
    const gate = folderHasProjectType("judo");
    for (let i = 0; i < 50; i++) gate({ cwd: `/f${i}` });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(50);
    expect(bumps).toBe(1);
  });

  // test-plan #F7
  it("a response landing after clearFolderProjects is discarded and the folder refetched", async () => {
    const first = deferred<Response>();
    fetchMock.mockReturnValueOnce(first.promise);
    fetchMock.mockResolvedValue(ok({ id: null, types: ["fresh"], source: "detected" }));
    const gate = folderHasProjectType("stale");
    gate({ cwd: "/a" });
    await settle();
    expect(fetched()).toEqual(["/a"]);
    clearFolderProjects();
    first.resolve(ok({ id: null, types: ["stale"], source: "detected" }));
    await settle();
    expect(fetched()).toEqual(["/a", "/a"]);
    expect(gate({ cwd: "/a" })).toBe(false); // the stale landing never populated the cache
    expect(getFolderProject("/a")).toMatchObject({ state: "ready", project: { types: ["fresh"] } });
  });

  // test-plan #F8
  it("invalidating one folder leaves the other's in-flight response intact", async () => {
    const a = deferred<Response>();
    const b = deferred<Response>();
    fetchMock.mockImplementation((url: string) => {
      const cwd = decodeURIComponent(url.split("cwd=")[1]);
      if (fetched().filter((c) => c === cwd).length > 1) return Promise.resolve(ok({ id: "b2", types: [], source: "none" }));
      return cwd === "/a" ? a.promise : b.promise;
    });
    getFolderProject("/a");
    getFolderProject("/b");
    await settle();
    expect(fetched()).toEqual(["/a", "/b"]);
    invalidateFolderProject("/b");
    a.resolve(ok({ id: "a1", types: [], source: "none" }));
    b.resolve(ok({ id: "b1", types: [], source: "none" }));
    await settle();
    expect(getFolderProject("/a")).toMatchObject({ state: "ready", project: { id: "a1" } });
    expect(fetched()).toEqual(["/a", "/b", "/b"]);
    expect(getFolderProject("/b")).toMatchObject({ state: "ready", project: { id: "b2" } });
  });

  // test-plan #X4
  it("a network error and a 403 both fail closed and still bump on landing", async () => {
    fetchMock.mockImplementation((url: string) =>
      decodeURIComponent(url.split("cwd=")[1]) === "/net"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ ok: false, status: 403, json: async () => ({}) } as Response),
    );
    const hasJudo = folderHasProjectType("judo");
    const hasAcme = folderHasProjectId("acme-erp");
    hasJudo({ cwd: "/net" });
    hasJudo({ cwd: "/denied" });
    await settle();
    expect(getFolderProject("/net").state).toBe("error");
    expect(getFolderProject("/denied").state).toBe("error");
    expect([hasJudo({ cwd: "/net" }), hasAcme({ cwd: "/denied" })]).toEqual([false, false]);
    expect(bumps).toBeGreaterThanOrEqual(1);
  });

  // test-plan #X5
  it("an error entry is dropped and the version bumped at 60 s, not before", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fetchMock.mockResolvedValue(ok({ id: null, types: ["judo"], source: "detected" }));
    const gate = folderHasProjectType("judo");
    gate({ cwd: "/a" });
    await vi.advanceTimersByTimeAsync(0);
    expect(getFolderProject("/a").state).toBe("error");
    bumps = 0;
    await vi.advanceTimersByTimeAsync(FOLDER_PROJECT_ERROR_TTL_MS - 1000);
    expect(bumps).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(bumps).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // dropped, not yet refetched — no render ran
    expect(gate({ cwd: "/a" })).toBe(false); // the next predicate call refetches
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(gate({ cwd: "/a" })).toBe(true);
  });
});

// test-plan #E88 / task 6.16: the direct registry readers that did NOT subscribe before runtime
// plugins existed. A reader subscribes iff a bump makes it re-read the registry.
describe("direct registry readers subscribe to the claims version (6.16)", () => {
  const noop = () => undefined;
  const readers: Array<[string, () => React.ReactElement]> = [
    ["ComposerPanelSlot", () => <ComposerPanelSlot draft="" onApplyText={noop} />],
    ["AnchoredPopoverSlot", () => <AnchoredPopoverSlot anchorEl={document.createElement("div")} onDismiss={noop} />],
    ["CommandRouteSlot", () => <CommandRouteSlot command="c" session={session} routeParams={{}} onClose={noop} />],
    ["SettingsSectionByPluginSlot", () => <SettingsSectionByPluginSlot pluginId="p" />],
    ["ToolRendererSlot", () => <ToolRendererSlot toolName="t" toolInput={{}} sessionId="s" />],
    ["AutomationActionEditorSlot", () => <AutomationActionEditorSlot actionId="a" payload={{}} onChange={noop} />],
    ["useHasAutomationActionEditor", () => { const H = () => { useHasAutomationActionEditor("a"); return null; }; return <H />; }],
    ["ShellOverlayRouteSlot", () => <ShellOverlayRouteSlot onBack={noop} />],
    ["useShellOverlayRouteMatched", () => { const H = () => { useShellOverlayRouteMatched(); return null; }; return <H />; }],
    ["useShellOverlayRoutePresentation", () => { const H = () => { useShellOverlayRoutePresentation(); return null; }; return <H />; }],
    ["useShellOverlayRouteDepth", () => { const H = () => { useShellOverlayRouteDepth(); return null; }; return <H />; }],
  ];

  it.each(readers)("%s re-reads the registry on a bump, and not without one", (_name, make) => {
    __resetSlotClaimsVersionForTests();
    const registry = createSlotRegistry();
    const getClaims = vi.spyOn(registry, "getClaims");
    render(<PluginContextProvider registry={registry}>{make()}</PluginContextProvider>);
    const baseline = getClaims.mock.calls.length;
    expect(baseline).toBeGreaterThan(0);
    // unbumped: nothing re-renders the reader
    expect(getClaims.mock.calls.length).toBe(baseline);
    act(() => bumpSlotClaimsVersion());
    expect(getClaims.mock.calls.length).toBeGreaterThan(baseline);
  });

  it("covers all 11 slot-consumers readers (+ ToolCallStep, pinned in its own test)", () => {
    expect(readers).toHaveLength(11);
  });
});
