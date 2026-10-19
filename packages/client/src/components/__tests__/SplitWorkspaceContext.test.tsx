import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import type React from "react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SplitWorkspaceProvider,
  useOptionalSplitWorkspace,
  useSplitWorkspace,
} from "../split/SplitWorkspaceContext.js";

function wrapper(sessionId = "s1", cwd = "/proj") {
  return ({ children }: { children: React.ReactNode }) => (
    <SplitWorkspaceProvider sessionId={sessionId} cwd={cwd} orientation="h">
      {children}
    </SplitWorkspaceProvider>
  );
}

describe("SplitWorkspaceProvider / openInSplit", () => {
  beforeEach(() => localStorage.clear());

  it("openInSplit opens the split when closed and opens the file as active tab", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper() });
    expect(result.current.split.mode).toBe("closed");

    act(() => result.current.openInSplit("src/foo.ts"));

    expect(result.current.split.mode).toBe("split");
    expect(result.current.paneState.openFiles.map((f) => f.path)).toEqual(["src/foo.ts"]);
    expect(result.current.paneState.activeIndex).toBe(0);
  });

  it("openInSplit with a line records a pending scroll target", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper() });
    act(() => result.current.openInSplit("src/foo.ts", 42));
    expect(result.current.pendingScroll).toEqual({ path: "src/foo.ts", line: 42 });

    act(() => result.current.consumePendingScroll());
    expect(result.current.pendingScroll).toBeNull();
  });

  it("setMode sets the layout mode and persists it", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sMode") });
    act(() => result.current.setMode("split"));
    expect(result.current.split.mode).toBe("split");
    act(() => result.current.setMode("full"));
    expect(result.current.split.mode).toBe("full");
    act(() => result.current.setMode("closed"));
    expect(result.current.split.mode).toBe("closed");
  });

  it("E8 direct closed↔full: select Chat from full lands in closed (never split between)", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sE8") });
    const seen: string[] = [];
    act(() => result.current.setMode("full"));
    seen.push(result.current.split.mode);
    // From `full`, the header Chat segment sets `closed` directly.
    act(() => result.current.setMode("closed"));
    seen.push(result.current.split.mode);
    expect(seen).toEqual(["full", "closed"]);
    expect(seen).not.toContain("split");
  });

  // F4 (rewrites the old F9): full is now STICKY — openers from full stay full.
  it("F4 openers from full stay full (openChanges + openInSplit) — rewrites F9", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sF9") });
    act(() => result.current.setMode("full"));
    expect(result.current.split.mode).toBe("full");
    // The Changed-Files chip drives openChanges(); from full it now STAYS full.
    act(() => result.current.openChanges());
    expect(result.current.split.mode).toBe("full");

    // A file opener from full likewise keeps full (chat stays hidden), tab active.
    act(() => result.current.openInSplit("src/foo.ts"));
    expect(result.current.split.mode).toBe("full");
    expect(result.current.paneState.openFiles.map((f) => f.path)).toEqual(["src/foo.ts"]);
    expect(result.current.paneState.activeIndex).toBe(0);
  });

  it("F1 closed + openInSplit reveals split, target active", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sF1") });
    expect(result.current.split.mode).toBe("closed");
    act(() => result.current.openInSplit("a.ts"));
    expect(result.current.split.mode).toBe("split");
    expect(result.current.paneState.openFiles.map((f) => f.path)).toEqual(["a.ts"]);
    expect(result.current.paneState.activeIndex).toBe(0);
  });

  it("F3 split + openInSplit stays split", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sF3") });
    act(() => result.current.setMode("split"));
    act(() => result.current.openInSplit("a.ts"));
    expect(result.current.split.mode).toBe("split");
    expect(result.current.paneState.activeIndex).toBe(0);
  });

  it("F5 user click always activates (foreground), not unread", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sF5") });
    act(() => result.current.openInSplit("a.ts")); // split, a.ts active
    act(() => result.current.openInSplit("b.ts")); // foreground click
    const files = result.current.paneState.openFiles;
    expect(files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(result.current.paneState.activeIndex).toBe(1);
    expect(files[1].unread).toBeUndefined();
  });

  it("F6 background open while reading a.ts — a.ts stays active, b.ts unread, mode unchanged", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sF6") });
    act(() => result.current.openInSplit("a.ts")); // split, a.ts active
    act(() => result.current.openInSplit("b.ts", undefined, undefined, { background: true }));
    const files = result.current.paneState.openFiles;
    expect(files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(result.current.paneState.activeIndex).toBe(0); // a.ts stays active
    expect(files[1].unread).toBe(true);
    expect(result.current.split.mode).toBe("split");
  });

  it("F6-full background open while full — stays full, a.ts active, b.ts unread", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sF6full") });
    act(() => result.current.openInSplit("a.ts"));
    act(() => result.current.setMode("full"));
    act(() => result.current.openInSplit("b.ts", undefined, undefined, { background: true }));
    expect(result.current.split.mode).toBe("full");
    expect(result.current.paneState.activeIndex).toBe(0);
    expect(result.current.paneState.openFiles[1].unread).toBe(true);
  });

  it("F7 background open from closed reveals split + activates (NOT unread)", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sF7") });
    expect(result.current.split.mode).toBe("closed");
    act(() => result.current.openInSplit("b.ts", undefined, undefined, { background: true }));
    expect(result.current.split.mode).toBe("split");
    expect(result.current.paneState.activeIndex).toBe(0);
    expect(result.current.paneState.openFiles[0].unread).toBeUndefined();
  });

  it("F8 background openLiveTarget — live tab unread, a.ts stays active", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sF8") });
    act(() => result.current.openInSplit("a.ts"));
    act(() => result.current.openLiveTarget("http://localhost:5000/x.html", { background: true }));
    const files = result.current.paneState.openFiles;
    expect(files.map((f) => f.path)).toEqual(["a.ts", "live:http://localhost:5000/x.html"]);
    expect(result.current.paneState.activeIndex).toBe(0);
    expect(files[1].unread).toBe(true);
  });

  it("F9 background openUrlTarget — url tab unread, a.ts stays active", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sF9url") });
    act(() => result.current.openInSplit("a.ts"));
    act(() => result.current.openUrlTarget("https://youtu.be/x", { background: true }));
    const files = result.current.paneState.openFiles;
    expect(files.map((f) => f.path)).toEqual(["a.ts", "url:https://youtu.be/x"]);
    expect(result.current.paneState.activeIndex).toBe(0);
    expect(files[1].unread).toBe(true);
  });

  it("F10 background open with a line stashes NO pendingScroll", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sF10") });
    act(() => result.current.openInSplit("a.ts"));
    act(() => result.current.openInSplit("b.ts", 20, undefined, { background: true }));
    expect(result.current.pendingScroll).toBeNull();
    expect(result.current.paneState.activeIndex).toBe(0);
  });

  it("openLiveTarget opens a live-server tab with the encoded path, idempotent on repeat", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sLive") });
    expect(result.current.split.mode).toBe("closed");

    act(() => result.current.openLiveTarget("http://localhost:50452/report.html"));
    expect(result.current.split.mode).toBe("split");
    expect(result.current.paneState.openFiles.map((f) => f.path)).toEqual([
      "live:http://localhost:50452/report.html",
    ]);
    expect(result.current.paneState.openFiles[0].viewer).toBe("live-server");

    // Idempotent: re-opening the same URL reuses the tab (no duplicate).
    act(() => result.current.openLiveTarget("http://localhost:50452/report.html"));
    expect(result.current.paneState.openFiles).toHaveLength(1);

    // A distinct URL opens a distinct tab.
    act(() => result.current.openLiveTarget("http://localhost:50452/other.html"));
    expect(result.current.paneState.openFiles).toHaveLength(2);
  });

  it("useOptionalSplitWorkspace returns null outside a provider", () => {
    const { result } = renderHook(() => useOptionalSplitWorkspace());
    expect(result.current).toBeNull();
  });

  it("X1: malformed persisted split state falls back to closed, does not throw", () => {
    localStorage.setItem("pi-dashboard:split:sX1", "{not-valid-json");
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sX1") });
    // Corrupt JSON → the loader swallows the parse error and returns the
    // default; the caption / restore-tab code renders against `closed`.
    expect(result.current.split.mode).toBe("closed");
  });
});

describe("SplitWorkspaceProvider — open-files watch + changed-on-disk", () => {
  beforeEach(() => localStorage.clear());

  it("declares open files to the watch when the split is open", () => {
    const onWatchFiles = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SplitWorkspaceProvider sessionId="sW" cwd="/proj" orientation="h" onWatchFiles={onWatchFiles}>
        {children}
      </SplitWorkspaceProvider>
    );
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper });
    // Closed on mount → declares an empty set.
    expect(onWatchFiles).toHaveBeenLastCalledWith("sW", "/proj", []);
    act(() => result.current.openInSplit("src/foo.ts"));
    expect(onWatchFiles).toHaveBeenLastCalledWith("sW", "/proj", ["src/foo.ts"]);
  });

  it("exposes changedFiles and forwards clearChanged to the prop", () => {
    const onClearChanged = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SplitWorkspaceProvider
        sessionId="sC"
        cwd="/proj"
        orientation="h"
        changedFiles={new Map([["src/foo.ts", 3]])}
        onClearChanged={onClearChanged}
      >
        {children}
      </SplitWorkspaceProvider>
    );
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper });
    expect(result.current.changedFiles?.get("src/foo.ts")).toBe(3);
    // Detection off (default): the banner set mirrors the raw candidates.
    expect(result.current.verifiedChanged.has("src/foo.ts")).toBe(true);
    act(() => result.current.clearChanged("src/foo.ts", 3));
    expect(onClearChanged).toHaveBeenCalledWith("src/foo.ts", 3);
  });
});

// change: add-browser-editor-pane-tab (D3, #E8, watch exclusion)
describe("SplitWorkspaceProvider — openPluginTab", () => {
  beforeEach(() => localStorage.clear());

  function pluginWrapper(onWatchFiles?: (...a: unknown[]) => void) {
    const registry = createSlotRegistry();
    registry.addClaim({ pluginId: "browser", priority: 1, slot: "editor-pane-tab", pathPrefix: "browser" });
    return ({ children }: { children: React.ReactNode }) => (
      <PluginContextProvider registry={registry}>
        <SplitWorkspaceProvider sessionId="sP" cwd="/proj" orientation="h" onWatchFiles={onWatchFiles}>
          {children}
        </SplitWorkspaceProvider>
      </PluginContextProvider>
    );
  }

  it("opens a claimed tab (reveals the split), focuses instead of duplicating, never watches it", () => {
    const onWatch = vi.fn();
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: pluginWrapper(onWatch) });
    let ok = false;
    act(() => {
      ok = result.current.openPluginTab("browser:i:1");
    });
    expect(ok).toBe(true);
    expect(result.current.split.mode).toBe("split");
    act(() => result.current.openInSplit("src/foo.ts"));
    act(() => {
      result.current.openPluginTab("browser:i:1");
    });
    expect(result.current.paneState.openFiles.map((f) => f.path)).toEqual(["browser:i:1", "src/foo.ts"]);
    expect(result.current.paneState.openFiles[result.current.paneState.activeIndex].path).toBe("browser:i:1");
    expect(result.current.paneState.openFiles[0].viewer).toBe("plugin");
    // virtual path never reaches the watcher
    expect(onWatch).toHaveBeenLastCalledWith("sP", "/proj", ["src/foo.ts"]);
  });

  it("ignores unclaimed and built-in prefixes without changing state", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: pluginWrapper() });
    let a = true;
    let b = true;
    act(() => {
      a = result.current.openPluginTab("unknown:x");
      b = result.current.openPluginTab("term:1");
    });
    expect([a, b]).toEqual([false, false]);
    expect(result.current.paneState.openFiles).toEqual([]);
    expect(result.current.split.mode).toBe("closed");
  });
});

// change: gate-changed-on-disk-by-content (tasks 5.2–5.16; test-plan E11–E16, F2–F6, F8, F11–F13)
describe("SplitWorkspaceProvider — content-gated changed-on-disk", () => {
  type Digest = { sha1?: string; status?: number; throws?: boolean; hold?: Promise<void> };
  const resp = (d: Digest) => {
    if (d.throws) return Promise.reject(new Error("network"));
    const status = d.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ success: status < 300, data: { size: 1, mtime: 1, ...(d.sha1 ? { sha1: d.sha1 } : {}) } }),
    });
  };

  const requests: Array<{ url: string; path: string; headers: string | null }> = [];
  /** path → what the next digest(s) return; the last entry repeats. */
  let disk: Record<string, Digest[]>;
  const setDisk = (path: string, ...d: Digest[]) => {
    disk[path] = d;
  };

  type Ctx = ReturnType<typeof useSplitWorkspace>;
  interface Harness {
    ctx: () => Ctx;
    fire: (path: string) => void;
    changed: () => Map<string, number>;
    watch: ReturnType<typeof vi.fn>;
    setConn: (n: number) => void;
    rerender: (sessionId: string, cwd: string) => void;
  }

  function mount(opts: { changeDetection?: boolean; sessionId?: string; cwd?: string } = {}): Harness {
    let gen = 0;
    let changedNow = new Map<string, number>();
    let ctx!: Ctx;
    const watch = vi.fn();
    const api = { setChanged: (_f: (p: Map<string, number>) => Map<string, number>) => {}, setConn: (_n: number) => {}, setScope: (_s: string, _c: string) => {} };
    function Probe() {
      ctx = useSplitWorkspace();
      return null;
    }
    function H() {
      const [changed, setChanged] = useState(new Map<string, number>());
      const [conn, setConn] = useState(1);
      const [scope, setScope] = useState({ s: opts.sessionId ?? "s1", c: opts.cwd ?? "/proj" });
      changedNow = changed;
      api.setChanged = setChanged;
      api.setConn = setConn;
      api.setScope = (s, c) => setScope({ s, c });
      return (
        <SplitWorkspaceProvider
          sessionId={scope.s}
          cwd={scope.c}
          orientation="h"
          changeDetection={opts.changeDetection ?? true}
          connectionGeneration={conn}
          changedFiles={changed}
          onWatchFiles={watch}
          onClearChanged={(path, g) =>
            setChanged((prev) => {
              if (!prev.has(path) || (g !== undefined && prev.get(path) !== g)) return prev;
              const n = new Map(prev);
              n.delete(path);
              return n;
            })
          }
        >
          <Probe />
        </SplitWorkspaceProvider>
      );
    }
    render(<H />);
    return {
      ctx: () => ctx,
      fire: (path) => act(() => api.setChanged((p) => new Map(p).set(path, ++gen))),
      changed: () => changedNow,
      watch,
      setConn: (n) => act(() => api.setConn(n)),
      rerender: (s, c) => act(() => api.setScope(s, c)),
    };
  }

  const tick = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const digestCalls = (path?: string) => requests.filter((r) => !path || r.path === path).length;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    requests.length = 0;
    disk = {};
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = decodeURIComponent(new URL(url, "http://x").searchParams.get("path") ?? "");
      requests.push({ url, path, headers: new Headers(init?.headers).get("X-Pi-Grant-Channel") });
      const q = disk[path] ?? [{ sha1: "S" }];
      const d = q.length > 1 ? (q.shift() as Digest) : q[0];
      return d.hold ? d.hold.then(() => resp(d)) : resp(d);
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /** Open `foo.ts`, capture its baseline `S`. */
  async function opened(h: Harness, path = "foo.ts"): Promise<void> {
    act(() => h.ctx().openInSplit(path));
    await act(async () => { await h.ctx().captureBaseline(path); });
  }

  it("E11 identical rewrite: digest == baseline → no banner, candidate cleared", async () => {
    const h = mount();
    await opened(h);
    h.fire("foo.ts");
    await tick(200);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(false);
    expect(h.changed().has("foo.ts")).toBe(false);
    // digest requests never prompt for access
    expect(requests.every((r) => r.headers === "")).toBe(true);
  });

  it("settles 150 ms before the first digest", async () => {
    const h = mount();
    await opened(h);
    const before = digestCalls();
    h.fire("foo.ts");
    await tick(100);
    expect(digestCalls()).toBe(before);
    await tick(100);
    expect(digestCalls()).toBe(before + 1);
  });

  it("E12 real change: digest differs → banner", async () => {
    const h = mount();
    await opened(h);
    setDisk("foo.ts", { sha1: "S2" });
    h.fire("foo.ts");
    await tick(200);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(true);
  });

  it.each<[string, Digest]>([
    ["404", { status: 404 }],
    ["403", { status: 403 }],
    ["network error", { throws: true }],
    ["no sha1", {}],
  ])("E13 failure is never silent: %s → banner", async (_n, d) => {
    const h = mount();
    await opened(h);
    setDisk("foo.ts", d);
    h.fire("foo.ts");
    await tick(200);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(true);
  });

  it("E14 revert to baseline clears the banner", async () => {
    const h = mount();
    await opened(h);
    setDisk("foo.ts", { sha1: "S2" });
    h.fire("foo.ts");
    await tick(200);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(true);
    setDisk("foo.ts", { sha1: "S" });
    h.fire("foo.ts");
    await tick(200);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(false);
    expect(h.changed().has("foo.ts")).toBe(false);
  });

  it("E15 baselines are per session: a switch clears them", async () => {
    const h = mount({ sessionId: "A", cwd: "/a" });
    await opened(h, "X");
    h.rerender("B", "/b");
    act(() => h.ctx().openInSplit("X"));
    setDisk("X", { sha1: "S" }); // would equal A's baseline
    h.fire("X");
    await tick(200);
    // B never captured a baseline → cannot match A's → banner (not silently compared with A's)
    expect(h.ctx().verifiedChanged.has("X")).toBe(true);
  });

  it("F2 second change during verification: the older result is discarded", async () => {
    const h = mount();
    await opened(h);
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    setDisk("foo.ts", { sha1: "S", hold }, { sha1: "S2" });
    h.fire("foo.ts"); // g1 → digest pending (returns S when released)
    await tick(200);
    h.fire("foo.ts"); // g2
    release();
    await tick(400);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(true);
  });

  it("F3 own save during verification: result discarded, re-verified against the new baseline", async () => {
    const h = mount();
    await opened(h);
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    setDisk("foo.ts", { sha1: "T", hold });
    h.fire("foo.ts");
    await tick(200); // digest pending
    await act(async () => { await h.ctx().trackedFileWrite("foo.ts", Promise.resolve({ sha1: "T" })); });
    release();
    await tick(400);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(false);
    expect(h.changed().has("foo.ts")).toBe(false);
  });

  it("F4 own save suppresses its own event: the candidate waits for the save", async () => {
    const h = mount();
    await opened(h);
    setDisk("foo.ts", { sha1: "T" });
    let resolveSave!: (v: { sha1: string }) => void;
    const save = new Promise<{ sha1: string }>((r) => { resolveSave = r; });
    let done: Promise<unknown>;
    act(() => { done = h.ctx().trackedFileWrite("foo.ts", save); });
    const before = digestCalls();
    h.fire("foo.ts"); // arrives before the save response
    await tick(500);
    expect(digestCalls()).toBe(before); // waiting
    await act(async () => { resolveSave({ sha1: "T" }); await done; });
    await tick(400);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(false);
  });

  it("F5 failed save: 409 keeps the baseline; unknown outcome nulls it", async () => {
    const h = mount();
    await opened(h);
    await act(async () => { await h.ctx().trackedFileWrite("foo.ts", Promise.resolve({ ok: false })); });
    setDisk("foo.ts", { sha1: "S" });
    h.fire("foo.ts");
    await tick(200);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(false); // baseline still S
    setDisk("foo.ts", { sha1: "S2" });
    h.fire("foo.ts");
    await tick(200);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(true);

    // network failure → baseline null → even S banners
    const h2 = mount();
    await opened(h2, "bar.ts");
    await act(async () => { await h2.ctx().trackedFileWrite("bar.ts", Promise.reject(new Error("net"))).catch(() => {}); });
    setDisk("bar.ts", { sha1: "S" });
    h2.fire("bar.ts");
    await tick(200);
    expect(h2.ctx().verifiedChanged.has("bar.ts")).toBe(true);
  });

  it("F5 a rejection carrying a numeric status is a refusal (baseline kept)", async () => {
    const h = mount();
    await opened(h);
    await act(async () => {
      await h.ctx().trackedFileWrite("foo.ts", Promise.reject(Object.assign(new Error("conflict"), { status: 409 }))).catch(() => {});
    });
    h.fire("foo.ts");
    await tick(200);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(false);
  });

  it("F6 save-wait bound: after 60 s the request is aborted and verification proceeds", async () => {
    const h = mount();
    await opened(h);
    let signal!: AbortSignal;
    act(() => {
      void h.ctx().trackedFileWrite("foo.ts", (s) => {
        signal = s;
        return new Promise<{ sha1?: string }>(() => {}); // never responds
      });
    });
    setDisk("foo.ts", { sha1: "S" });
    h.fire("foo.ts");
    const before = digestCalls();
    await tick(59_000);
    expect(digestCalls()).toBe(before);
    expect(signal.aborted).toBe(false);
    await tick(1_500);
    expect(signal.aborted).toBe(true);
    expect(digestCalls()).toBe(before + 1);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(false); // against the current baseline S
  });

  it("F8 Dismiss vs in-flight: stays dismissed, baseline unchanged, next change banners", async () => {
    const h = mount();
    await opened(h);
    setDisk("foo.ts", { sha1: "S2" });
    h.fire("foo.ts");
    await tick(200);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(true);
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    setDisk("foo.ts", { sha1: "S3", hold });
    h.fire("foo.ts");
    await tick(200); // in flight
    act(() => h.ctx().dismissChanged("foo.ts"));
    release();
    await tick(400);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(false);
    // baseline still S: a revert to S stays silent, a different change banners
    setDisk("foo.ts", { sha1: "S" });
    h.fire("foo.ts");
    await tick(200);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(false);
    setDisk("foo.ts", { sha1: "S4" });
    h.fire("foo.ts");
    await tick(200);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(true);
  });

  it("Refresh clears the banner and re-sends watch_files", async () => {
    const h = mount();
    await opened(h);
    setDisk("foo.ts", { sha1: "S2" });
    h.fire("foo.ts");
    await tick(200);
    const sends = h.watch.mock.calls.length;
    act(() => h.ctx().refreshChanged("foo.ts"));
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(false);
    expect(h.watch.mock.calls.length).toBe(sends + 1);
    expect(h.watch).toHaveBeenLastCalledWith("s1", "/proj", ["foo.ts"]);
  });

  it("F11 mount catch-up: a change with no file_changed banners 1 s after the baseline", async () => {
    const h = mount();
    await opened(h);
    setDisk("foo.ts", { sha1: "S2" });
    const before = digestCalls();
    await tick(900);
    expect(digestCalls()).toBe(before);
    await tick(200);
    expect(digestCalls()).toBe(before + 1);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(true);
  });

  it("F11 closing the tab first cancels the catch-up", async () => {
    const h = mount();
    await opened(h);
    const before = digestCalls();
    act(() => h.ctx().dispatch({ type: "closeTab", index: 0 }));
    await tick(2000);
    expect(digestCalls()).toBe(before);
  });

  it("F12 null baseline: no catch-up request, no banner; a real candidate still banners", async () => {
    const h = mount();
    setDisk("foo.ts", { status: 403 });
    let sha: string | null = "x";
    act(() => h.ctx().openInSplit("foo.ts"));
    await act(async () => { sha = await h.ctx().captureBaseline("foo.ts"); });
    expect(sha).toBeNull();
    const before = digestCalls();
    await tick(2000);
    expect(digestCalls()).toBe(before);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(false);
    h.fire("foo.ts");
    await tick(200);
    expect(h.ctx().verifiedChanged.has("foo.ts")).toBe(true);
  });

  it("F13 reconnect: watch_files re-sent with both paths; one verification per non-null baseline", async () => {
    const h = mount();
    await opened(h, "a.ts");
    await opened(h, "b.ts");
    setDisk("b.ts", { status: 403 });
    await act(async () => { await h.ctx().captureBaseline("b.ts"); }); // null baseline
    await tick(1500); // let mount catch-ups pass
    const sends = h.watch.mock.calls.length;
    const before = digestCalls();
    h.setConn(0);
    h.setConn(2);
    await tick(50);
    expect(h.watch.mock.calls.length).toBe(sends + 1);
    expect(h.watch).toHaveBeenLastCalledWith("s1", "/proj", ["a.ts", "b.ts"]);
    expect(digestCalls("a.ts")).toBeGreaterThan(0);
    expect(digestCalls() - before).toBe(1); // only a.ts
  });

  it("E16 folder scope off: zero digest requests, no banner, trackedFileWrite is a passthrough", async () => {
    const h = mount({ changeDetection: false });
    act(() => h.ctx().openInSplit("foo.ts"));
    let sha: string | null = "x";
    await act(async () => { sha = await h.ctx().captureBaseline("foo.ts"); });
    expect(sha).toBeNull();
    h.fire("foo.ts");
    await tick(3000);
    expect(digestCalls()).toBe(0);
    const r = await h.ctx().trackedFileWrite("foo.ts", Promise.resolve({ sha1: "T" }));
    expect(r).toEqual({ sha1: "T" });
  });
});
