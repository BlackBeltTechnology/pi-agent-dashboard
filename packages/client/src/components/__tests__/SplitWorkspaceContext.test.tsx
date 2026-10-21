import {
  createSlotRegistry,
  PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { useCallback, useState } from "react";
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
        changedFiles={new Map([["src/foo.ts", 1]])}
        onClearChanged={onClearChanged}
      >
        {children}
      </SplitWorkspaceProvider>
    );
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper });
    expect(result.current.changedFiles?.has("src/foo.ts")).toBe(true);
    act(() => result.current.clearChanged("src/foo.ts"));
    expect(onClearChanged).toHaveBeenCalledWith("src/foo.ts");
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

// ── Changed-on-disk verification (candidate → digest → banner) ───────────────
// See change: gate-changed-on-disk-by-content (test-plan #E11–#E16, #F2–#F13).

type DigestAnswer =
  | { kind: "sha"; sha1: string }
  | { kind: "status"; status: number }
  | { kind: "nosha" }
  | { kind: "throw" };

interface Pending {
  url: string;
  purpose: string;
  cwd: string;
  path: string;
  resolve: (a: DigestAnswer) => void;
}

/**
 * A controllable `fetch`: digest requests answer from `disk[cwd|path]` unless
 * `hold` is set, in which case they queue in `pending` for the test to settle.
 * Writes answer from `writeAnswer` (or hang until `writeGate` resolves).
 */
function installFetch() {
  const disk = new Map<string, string>();
  const digestCalls: Array<{ cwd: string; path: string; purpose: string }> = [];
  const pending: Pending[] = [];
  const state = {
    hold: false,
    override: null as null | ((cwd: string, path: string) => DigestAnswer | undefined),
    write: { status: 200, sha1: "T" as string | undefined, reject: false, hang: false },
    writeCalls: 0,
  };
  const key = (cwd: string, path: string) => `${cwd}|${path}`;
  const respond = (a: DigestAnswer): Response | Promise<never> => {
    if (a.kind === "throw") return Promise.reject(new TypeError("network"));
    if (a.kind === "status") return new Response("{}", { status: a.status });
    if (a.kind === "nosha") return new Response(JSON.stringify({ success: true, data: { size: 9, mtime: 1 } }), { status: 200 });
    return new Response(JSON.stringify({ success: true, data: { sha1: a.sha1, size: 1, mtime: 1 } }), { status: 200 });
  };
  const onAbort = (signal: AbortSignal | undefined, reject: (e: unknown) => void): void => {
    signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  };
  const digest = (url: string, signal: AbortSignal | undefined): Promise<Response> => {
    const u = new URL(url, "http://x");
    const cwd = u.searchParams.get("cwd") ?? "";
    const path = u.searchParams.get("path") ?? "";
    const purpose = u.searchParams.get("purpose") ?? "";
    digestCalls.push({ cwd, path, purpose });
    const answerNow = (): DigestAnswer =>
      state.override?.(cwd, path) ?? { kind: "sha", sha1: disk.get(key(cwd, path)) ?? "none" };
    if (!state.hold) return Promise.resolve(respond(answerNow()));
    return new Promise<Response>((resolve, reject) => {
      pending.push({
        url, purpose, cwd, path,
        resolve: (a) => {
          const r = respond(a);
          if (r instanceof Promise) r.then(resolve, reject);
          else resolve(r);
        },
      });
      onAbort(signal, reject);
    });
  };
  const write = (signal: AbortSignal | undefined): Promise<Response> => {
    state.writeCalls++;
    if (state.write.hang) return new Promise<Response>((_res, reject) => onAbort(signal, reject));
    if (state.write.reject) return Promise.reject(new TypeError("network"));
    const ok = state.write.status === 200;
    const sha = state.write.sha1 ? { sha1: state.write.sha1 } : {};
    const body = ok ? { success: true, data: { mtime: 5, size: 3, ...sha } } : { success: false };
    return Promise.resolve(new Response(JSON.stringify(body), { status: state.write.status }));
  };
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const signal = init?.signal ?? undefined;
    if (url.includes("/api/file/digest")) return digest(url, signal);
    if (url.includes("/api/file/write")) return write(signal);
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return { disk, digestCalls, pending, state, key, fn };
}

/** Provider wrapper with a controllable candidate map + connection generation. */
function mountDetect(opts: { changeDetection?: boolean; sessionId?: string; cwd?: string } = {}) {
  const onWatchFiles = vi.fn();
  let setCand!: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  let setConn!: React.Dispatch<React.SetStateAction<number>>;
  let gen = 0;
  const scope = { sessionId: opts.sessionId ?? "sD", cwd: opts.cwd ?? "/proj" };
  let candSnapshot = new Map<string, number>();
  function Host({ children }: { children: React.ReactNode }) {
    const [cand, setC] = useState<Map<string, number>>(new Map());
    const [conn, setN] = useState(0);
    setCand = setC;
    setConn = setN;
    candSnapshot = cand;
    const onClear = useCallback((p: string, g?: number) => {
      setC((prev) => {
        if (!prev.has(p) || (g !== undefined && prev.get(p) !== g)) return prev;
        const n = new Map(prev);
        n.delete(p);
        return n;
      });
    }, []);
    return (
      <SplitWorkspaceProvider
        sessionId={scope.sessionId}
        cwd={scope.cwd}
        orientation="h"
        changeDetection={opts.changeDetection ?? true}
        changedFiles={opts.changeDetection === false ? undefined : cand}
        onClearChanged={onClear}
        onWatchFiles={onWatchFiles}
        connectionGeneration={conn}
      >
        {children}
      </SplitWorkspaceProvider>
    );
  }
  const hook = renderHook(() => useSplitWorkspace(), { wrapper: Host });
  return {
    ...hook,
    onWatchFiles,
    scope,
    candidates: () => candSnapshot,
    fire: (path: string) => act(() => setCand((prev) => new Map(prev).set(path, ++gen))),
    bumpConnection: () => act(() => setConn((n) => n + 1)),
    banner: () => [...(hook.result.current.changedFiles ?? [])],
  };
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const flushMicro = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });

describe("SplitWorkspaceProvider — changed-on-disk verification", () => {
  let f: ReturnType<typeof installFetch>;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    f = installFetch();
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = realFetch;
  });

  async function openWithBaseline(h: ReturnType<typeof mountDetect>, path = "foo.ts", sha = "S", cwd = h.scope.cwd) {
    f.disk.set(f.key(cwd, path), sha);
    act(() => h.result.current.openInSplit(path));
    await act(async () => {
      await h.result.current.captureBaseline(path);
    });
  }

  it("E11: an identical rewrite never banners and its candidate is cleared", async () => {
    const h = mountDetect();
    await openWithBaseline(h);
    h.fire("foo.ts");
    await advance(200);
    expect(h.banner()).toEqual([]);
    expect(h.candidates().has("foo.ts")).toBe(false);
    expect(f.digestCalls.at(-1)).toMatchObject({ path: "foo.ts", purpose: "verify" });
  });

  it("E12: a real content change banners", async () => {
    const h = mountDetect();
    await openWithBaseline(h);
    f.disk.set(f.key("/proj", "foo.ts"), "S2");
    h.fire("foo.ts");
    await advance(200);
    expect(h.banner()).toEqual(["foo.ts"]);
  });

  it("E13: 404 / 403 / network error / missing sha1 each banner (failure is never silent)", async () => {
    const answers: DigestAnswer[] = [
      { kind: "status", status: 404 },
      { kind: "status", status: 403 },
      { kind: "throw" },
      { kind: "nosha" },
    ];
    for (const a of answers) {
      const h = mountDetect({ sessionId: `sE13-${a.kind}`, cwd: `/p-${a.kind}` });
      await openWithBaseline(h);
      f.state.override = () => a;
      h.fire("foo.ts");
      await advance(200);
      expect(h.banner(), JSON.stringify(a)).toEqual(["foo.ts"]);
      f.state.override = null;
      h.unmount();
    }
  });

  it("E14: reverting to the baseline bytes clears the banner", async () => {
    const h = mountDetect();
    await openWithBaseline(h);
    f.disk.set(f.key("/proj", "foo.ts"), "S2");
    h.fire("foo.ts");
    await advance(200);
    expect(h.banner()).toEqual(["foo.ts"]);
    f.disk.set(f.key("/proj", "foo.ts"), "S");
    h.fire("foo.ts");
    await advance(200);
    expect(h.banner()).toEqual([]);
  });

  it("E15: a session switch drops baselines and in-flight verification; maps never leak across sessions", async () => {
    const h = mountDetect({ sessionId: "sA", cwd: "/a" });
    f.disk.set(f.key("/b", "X"), "SB");
    await openWithBaseline(h, "X", "SA", "/a");
    f.state.hold = true;
    h.fire("X"); // A's candidate: digest in flight
    await advance(200);
    expect(f.pending).toHaveLength(1);
    expect(f.pending[0].cwd).toBe("/a");

    // Switch to B (same tab path X, different baseline).
    h.scope.sessionId = "sB";
    h.scope.cwd = "/b";
    h.rerender();
    f.state.hold = false;
    act(() => h.result.current.openInSplit("X"));
    await act(async () => {
      await h.result.current.captureBaseline("X");
    });
    expect(h.banner()).toEqual([]);
    // A's late answer (a different digest) lands: it must NOT be compared with B's baseline.
    await act(async () => {
      f.pending[0].resolve({ kind: "sha", sha1: "SA" });
    });
    await advance(200);
    expect(h.banner()).toEqual([]);
    expect(f.digestCalls.filter((c) => c.cwd === "/b").every((c) => c.purpose === "baseline")).toBe(true);
  });

  it("F2: a second change during verification discards the first result", async () => {
    const h = mountDetect();
    await openWithBaseline(h);
    f.state.hold = true;
    h.fire("foo.ts"); // g1
    await advance(200);
    expect(f.pending).toHaveLength(1);
    const first = f.pending[0];
    h.fire("foo.ts"); // g2 supersedes g1
    await advance(200);
    expect(f.pending.length).toBeGreaterThanOrEqual(2);
    const second = f.pending[f.pending.length - 1];
    await act(async () => first.resolve({ kind: "sha", sha1: "S" })); // would clear
    await act(async () => second.resolve({ kind: "sha", sha1: "S2" })); // real change
    await flushMicro();
    expect(h.banner()).toEqual(["foo.ts"]);
  });

  it("F3: an own save during verification discards the result and re-verifies against the new baseline", async () => {
    const h = mountDetect();
    await openWithBaseline(h);
    f.state.hold = true;
    h.fire("foo.ts");
    await advance(200);
    const inflight = f.pending[0];
    // Own save succeeds with sha1 T (disk is now T).
    f.state.hold = false;
    f.disk.set(f.key("/proj", "foo.ts"), "T");
    f.state.write = { status: 200, sha1: "T", reject: false, hang: false };
    await act(async () => {
      await h.result.current.trackedFileWrite("foo.ts", { cwd: "/proj", path: "foo.ts", content: "x", mtime: 1 });
    });
    await act(async () => inflight.resolve({ kind: "sha", sha1: "S" })); // stale answer
    await advance(200);
    expect(h.banner()).toEqual([]);
    expect(f.digestCalls.filter((c) => c.purpose === "verify").length).toBeGreaterThanOrEqual(2);
  });

  it("F4: the event raised by an own save waits for the save and never banners", async () => {
    const h = mountDetect();
    await openWithBaseline(h, "README.md", "S");
    f.state.write = { status: 200, sha1: "T", reject: false, hang: true };
    let release!: () => void;
    // Replace the hanging write with a gated one.
    const original = globalThis.fetch;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/file/write")) {
        await gate;
        return new Response(JSON.stringify({ success: true, data: { mtime: 5, size: 3, sha1: "T" } }), { status: 200 });
      }
      return original(input, init);
    }) as unknown as typeof fetch;
    f.disk.set(f.key("/proj", "README.md"), "T");

    let writePromise!: Promise<Response>;
    act(() => {
      writePromise = h.result.current.trackedFileWrite("README.md", { cwd: "/proj", path: "README.md", content: "x", mtime: 1 });
    });
    h.fire("README.md"); // the rename event arrives BEFORE the response
    await advance(500);
    expect(f.digestCalls.filter((c) => c.purpose === "verify")).toHaveLength(0); // waiting for the save
    await act(async () => {
      release();
      await writePromise;
    });
    await advance(200);
    expect(f.digestCalls.filter((c) => c.purpose === "verify").length).toBeGreaterThanOrEqual(1);
    expect(h.banner()).toEqual([]);
  });

  it("F5: a refused save (409) keeps the baseline; an unknown save outcome nulls it", async () => {
    // 409 → baseline S kept; external change S′ banners.
    const a = mountDetect({ sessionId: "sF5a", cwd: "/f5a" });
    await openWithBaseline(a, "foo.ts", "S", "/f5a");
    f.state.write = { status: 409, sha1: undefined, reject: false, hang: false };
    await act(async () => {
      await a.result.current.trackedFileWrite("foo.ts", { cwd: "/f5a", path: "foo.ts", content: "x", mtime: 1 });
    });
    f.disk.set(f.key("/f5a", "foo.ts"), "S2");
    a.fire("foo.ts");
    await advance(200);
    expect(a.banner()).toEqual(["foo.ts"]);
    a.unmount();

    // Unknown (network failure) → baseline null → even a digest equal to S banners.
    const b = mountDetect({ sessionId: "sF5b", cwd: "/f5b" });
    await openWithBaseline(b, "foo.ts", "S", "/f5b");
    f.state.write = { status: 200, sha1: undefined, reject: true, hang: false };
    await act(async () => {
      await expect(
        b.result.current.trackedFileWrite("foo.ts", { cwd: "/f5b", path: "foo.ts", content: "x", mtime: 1 }),
      ).rejects.toThrow();
    });
    b.fire("foo.ts"); // disk still S
    await advance(200);
    expect(b.banner()).toEqual(["foo.ts"]);
  });

  it("F6: a save that never responds is NOT aborted; the candidate's wait is bounded at 60 s and verification then runs", async () => {
    const h = mountDetect();
    await openWithBaseline(h);
    f.state.write = { status: 200, sha1: undefined, reject: false, hang: true };
    let writePromise!: Promise<Response>;
    let writeSettled = false;
    act(() => {
      writePromise = h.result.current.trackedFileWrite("foo.ts", { cwd: "/proj", path: "foo.ts", content: "x", mtime: 1 });
      writePromise.then(
        () => {
          writeSettled = true;
        },
        () => {
          writeSettled = true;
        },
      );
    });
    h.fire("foo.ts");
    await advance(30_000);
    expect(f.digestCalls.filter((c) => c.purpose === "verify")).toHaveLength(0);
    await advance(31_000);
    await advance(300);
    // The wait is bounded: verification ran against the current baseline ...
    expect(f.digestCalls.filter((c) => c.purpose === "verify").length).toBeGreaterThanOrEqual(1);
    // ... but the request itself is still in flight (never aborted, so a slow success is not shown as a failure).
    expect(writeSettled).toBe(false);
    expect(f.state.writeCalls).toBe(1);
    expect(h.banner()).toEqual([]); // disk still equals the (unchanged) baseline
  });

  it("F8: Dismiss during an in-flight verification keeps the banner dismissed; the next change banners again", async () => {
    const h = mountDetect();
    await openWithBaseline(h);
    f.disk.set(f.key("/proj", "foo.ts"), "S2");
    h.fire("foo.ts");
    await advance(200);
    expect(h.banner()).toEqual(["foo.ts"]);

    f.state.hold = true;
    h.fire("foo.ts");
    await advance(200);
    expect(f.pending).toHaveLength(1);
    act(() => h.result.current.clearChanged("foo.ts")); // Dismiss first
    expect(h.banner()).toEqual([]);
    await act(async () => f.pending[0].resolve({ kind: "sha", sha1: "S2" }));
    await advance(200);
    expect(h.banner()).toEqual([]); // not resurrected
    // Baseline is unchanged: a later different change banners again.
    f.state.hold = false;
    f.disk.set(f.key("/proj", "foo.ts"), "S3");
    h.fire("foo.ts");
    await advance(200);
    expect(h.banner()).toEqual(["foo.ts"]);
  });

  it("F11: a change that lands before the watch is armed is caught 1 s after the baseline", async () => {
    const h = mountDetect();
    await openWithBaseline(h);
    f.disk.set(f.key("/proj", "foo.ts"), "S2"); // no file_changed will ever arrive
    await advance(900);
    expect(h.banner()).toEqual([]);
    await advance(300);
    expect(h.banner()).toEqual(["foo.ts"]);
  });

  it("F11: closing the tab before the catch-up fires sends no digest request", async () => {
    const h = mountDetect();
    await openWithBaseline(h);
    const before = f.digestCalls.length;
    act(() => h.result.current.dispatch({ type: "closeByPath", path: "foo.ts" }));
    await advance(2000);
    expect(f.digestCalls.length).toBe(before);
  });

  it("F12: a null baseline (refused digest) skips the catch-up and never banners on its own", async () => {
    const h = mountDetect();
    f.state.override = () => ({ kind: "status", status: 403 });
    act(() => h.result.current.openInSplit("foo.ts"));
    await act(async () => {
      await h.result.current.captureBaseline("foo.ts");
    });
    const before = f.digestCalls.length;
    await advance(1500);
    expect(f.digestCalls.length).toBe(before);
    expect(h.banner()).toEqual([]);
    h.fire("foo.ts"); // a real candidate still banners
    await advance(200);
    expect(h.banner()).toEqual(["foo.ts"]);
  });

  it("F13: a reconnect re-declares the open set and re-verifies every non-null baseline once", async () => {
    const h = mountDetect();
    await openWithBaseline(h, "a.ts", "SA");
    await openWithBaseline(h, "b.ts", "SB");
    await advance(1500); // let the mount catch-ups settle
    h.onWatchFiles.mockClear();
    const before = f.digestCalls.filter((c) => c.purpose === "verify").length;
    f.disk.set(f.key("/proj", "b.ts"), "SB2"); // changed while disconnected
    h.bumpConnection();
    expect(h.onWatchFiles).toHaveBeenCalledWith("sD", "/proj", ["a.ts", "b.ts"]);
    await advance(300);
    const verifies = f.digestCalls.filter((c) => c.purpose === "verify").slice(before);
    expect(verifies.map((c) => c.path).sort()).toEqual(["a.ts", "b.ts"]);
    expect(h.banner()).toEqual(["b.ts"]);
  });

  it("E16: with change detection off no digest is requested and nothing banners", async () => {
    const h = mountDetect({ changeDetection: false });
    act(() => h.result.current.openInSplit("foo.ts"));
    await act(async () => {
      await h.result.current.captureBaseline("foo.ts");
    });
    await advance(2000);
    expect(f.digestCalls).toHaveLength(0);
    expect(h.result.current.changeDetection).toBe(false);
    expect(h.result.current.changedFiles).toBeNull();
    // trackedFileWrite is a plain passthrough (still performs the write).
    f.state.write = { status: 200, sha1: "T", reject: false, hang: false };
    const res = await h.result.current.trackedFileWrite("foo.ts", { cwd: "/proj", path: "foo.ts", content: "x", mtime: 1 });
    expect(res.status).toBe(200);
    expect(f.state.writeCalls).toBe(1);
  });

  it("cwd-hydration: while the session cwd is unhydrated ('') no digest is requested and detection reads off; once cwd arrives a baseline is captured", async () => {
    const h = mountDetect({ cwd: "" });
    expect(h.result.current.changeDetection).toBe(false);
    act(() => h.result.current.openInSplit("foo.ts"));
    await act(async () => {
      await h.result.current.captureBaseline("foo.ts");
    });
    await advance(2000);
    // A digest with an empty cwd is a guaranteed 400 -> null baseline -> a false banner on the next touch.
    expect(f.digestCalls).toHaveLength(0);

    h.scope.cwd = "/proj";
    f.disk.set(f.key("/proj", "foo.ts"), "S");
    h.rerender();
    expect(h.result.current.changeDetection).toBe(true);
    await act(async () => {
      await h.result.current.captureBaseline("foo.ts");
    });
    expect(f.digestCalls.at(-1)).toMatchObject({ cwd: "/proj", path: "foo.ts", purpose: "baseline" });
    h.fire("foo.ts");
    await advance(200);
    expect(h.banner()).toEqual([]); // identical content, real baseline -> no banner
  });

  it("Refresh re-sends the watch set (resyncWatch)", async () => {
    const h = mountDetect();
    await openWithBaseline(h);
    h.onWatchFiles.mockClear();
    act(() => h.result.current.resyncWatch());
    expect(h.onWatchFiles).toHaveBeenCalledWith("sD", "/proj", ["foo.ts"]);
  });
});
