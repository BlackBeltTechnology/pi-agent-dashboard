/**
 * Client hooks (change migrate-mcp-to-pi-builtin):
 *   - `useEffectiveConfig` shares ONE in-flight request per key (global = "",
 *     else the cwd) and reuses the cached success across remounts.
 *   - the per-cwd 403 cache short-circuits refused folders.
 *   - `useLiveState` fetches `/live` on mount and on explicit refresh only.
 */
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scopeToWire } from "../api.js";
import {
  invalidateEffective,
  loadEffective,
  useEffectiveConfig,
  useLiveState,
} from "../hooks.js";

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function view() {
  return { scope: "global", servers: [], layers: [] };
}

const LIVE_OK = { ok: true, servers: {}, errors: [] };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  invalidateEffective();
  invalidateEffective("/a");
});

describe("useEffectiveConfig — single in-flight per key", () => {
  it("two components mounting together issue one request", async () => {
    const fetchMock = vi.fn(async () => jsonOk(view()));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <>
        <Probe />
        <Probe />
      </>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("distinct cwds are distinct keys → one request each", async () => {
    const fetchMock = vi.fn(async () => jsonOk(view()));
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([loadEffective(), loadEffective("/a"), loadEffective("/a")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a remount reuses the cached view without a second request", async () => {
    const fetchMock = vi.fn(async () => jsonOk(view()));
    vi.stubGlobal("fetch", fetchMock);

    const first = render(<Probe />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<Probe />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("a failure clears the in-flight slot so the next call retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "boom" }) } as unknown as Response)
      .mockResolvedValueOnce(jsonOk(view()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadEffective()).rejects.toThrow();
    const ok = await loadEffective();
    expect(ok.scope).toBe("global");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a 403 is cached per cwd until invalidated", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "not-allowed", message: "no" }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadEffective("/refused")).rejects.toThrow();
    await expect(loadEffective("/refused")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    invalidateEffective("/refused");
    await expect(loadEffective("/refused")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function Probe() {
  useEffectiveConfig();
  return null;
}

describe("useLiveState — page view + explicit refresh only", () => {
  it("fetches once on mount; refresh issues exactly one new request", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/live")) return jsonOk(LIVE_OK);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useLiveState());
    await waitFor(() => expect(result.current.live).toEqual(LIVE_OK));
    expect(result.current.loading).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    result.current.refresh();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.live).toEqual(LIVE_OK);
    // review r3 B1: the page view may use the server's 30 s cache; an explicit
    // refresh must bypass it (`fresh=1`) or it returns the cached state.
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("fresh=1");
    expect(String(fetchMock.mock.calls[1][0])).toContain("fresh=1");
  });

  it("a failed live fetch leaves live null without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response),
    );
    const { result } = renderHook(() => useLiveState());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.live).toBeNull();
  });
});


// ── harden-plugin-cwd-admission ──────────────────────────────────────────────

describe("scopeToWire never serializes an admission token (E22)", () => {
  it("drops a server-side `admission` field from the wire body", () => {
    const scope = { kind: "project", cwd: "/w", admission: { canonCwd: "/w", rawCwd: "/w" } } as never;
    const json = JSON.stringify(scopeToWire(scope));
    expect(json).toBe('{"scope":"project","cwd":"/w"}');
    expect(json).not.toContain("admission");
  });
});

describe("transient 503 retry chain is per key (F4)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("five components on one cwd share ONE chain: 503 then 200 is two fetches in total", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const unavailable = {
      ok: false,
      status: 503,
      json: async () => ({ error: "cwd-admission-unavailable", message: "m", retryAfterMs: 1000 }),
    } as unknown as Response;
    const fetchMock = vi.fn().mockResolvedValueOnce(unavailable).mockResolvedValue(jsonOk(view()));
    vi.stubGlobal("fetch", fetchMock);
    function Pill() {
      useEffectiveConfig("/shared-cwd");
      return null;
    }
    render(
      <>
        <Pill />
        <Pill />
        <Pill />
        <Pill />
        <Pill />
      </>,
    );
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    invalidateEffective("/shared-cwd");
  });
});
