/**
 * Client hooks (change extract-mcp-client-plugin, task 7.1):
 *   - `useEffectiveConfig` shares ONE in-flight request per key (global = "",
 *     else the cwd) and reuses the cached success across remounts.
 *   - `useAdapterStatus` derives one status object; every non-`ok` verdict is
 *     read-only, with the banner CTA (`upgrade` vs `install`) driven by kind.
 */
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterVerdict } from "../../core/types.js";
import {
  type deriveAdapterStatus,
  invalidateEffective,
  loadEffective,
  useAdapterStatus,
  useEffectiveConfig,
} from "../hooks.js";

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function view(adapter: AdapterVerdict) {
  return { cwd: "", servers: [], settings: {}, layerErrors: [], adapter };
}

const OK: AdapterVerdict = { kind: "ok", installed: "2.20.0", floor: "2.20.0" };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  invalidateEffective();
  invalidateEffective("/a");
});

describe("useEffectiveConfig — single in-flight per key", () => {
  it("two components mounting together issue one request", async () => {
    const fetchMock = vi.fn(async () => jsonOk(view(OK)));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <>
        <Probe />
        <Probe />
      </>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Let both `finally` handlers settle before unmount.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("distinct cwds are distinct keys → one request each", async () => {
    const fetchMock = vi.fn(async () => jsonOk(view(OK)));
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([loadEffective(), loadEffective("/a"), loadEffective("/a")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a remount reuses the cached view without a second request", async () => {
    const fetchMock = vi.fn(async () => jsonOk(view(OK)));
    vi.stubGlobal("fetch", fetchMock);

    const first = render(<Probe />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<Probe />);
    // Cached: the mount renders with data and never re-fetches.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("a failure clears the in-flight slot so the next call retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "boom" }) } as unknown as Response)
      .mockResolvedValueOnce(jsonOk(view(OK)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadEffective()).rejects.toThrow();
    const ok = await loadEffective();
    expect(ok.adapter.kind).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function Probe() {
  useEffectiveConfig();
  return null;
}

describe("useAdapterStatus — one derived status object", () => {
  const cases: Array<[AdapterVerdict, boolean, ReturnType<typeof deriveAdapterStatus>["action"]]> = [
    [{ kind: "ok", installed: "2.20.0", floor: "2.20.0" }, false, null],
    [{ kind: "below-floor", installed: "2.19.0", floor: "2.20.0" }, true, "upgrade"],
    [{ kind: "absent", floor: "2.20.0" }, true, "install"],
    [{ kind: "unparseable", floor: "2.20.0" }, true, null],
  ];

  for (const [verdict, readOnly, action] of cases) {
    it(`${verdict.kind}: readOnly=${readOnly} action=${action}`, () => {
      const { result } = renderHook(() => useAdapterStatus(verdict));
      expect(result.current.readOnly).toBe(readOnly);
      expect(result.current.action).toBe(action);
      expect(result.current.ok).toBe(!readOnly);
      expect(result.current.floor).toBe(verdict.floor);
      expect(result.current.kind).toBe(verdict.kind);
    });
  }

  it("an absent verdict reads as unknown + read-only with the fallback floor", () => {
    const { result } = renderHook(() => useAdapterStatus(undefined));
    expect(result.current.kind).toBe("unknown");
    expect(result.current.readOnly).toBe(true);
    expect(result.current.action).toBeNull();
    expect(result.current.floor).toBe("2.20.0");
  });

  it("keeps one object identity across re-renders with the same verdict", () => {
    const { result, rerender } = renderHook(() => useAdapterStatus(OK));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
