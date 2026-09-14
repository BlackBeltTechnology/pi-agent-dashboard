/**
 * useArchivedSessions — per-key lazy archive listing cache.
 *   - F6 (fault): a rejected first page surfaces `error` and a retry control;
 *     `retry` re-issues the fetch.
 *   - F7 (state): a loaded key is served from cache on re-`loadFirst` (no new
 *     fetch); `invalidate` drops the cache so the next `loadFirst` refetches.
 *
 * See change: archive-sessions-lazy-load (test-plan #F6, #F7).
 */

import type { ArchivedSessionSummary } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useArchivedSessions } from "../useArchivedSessions.js";

function makeItem(id: string, groupPath = "/a"): ArchivedSessionSummary {
  return {
    id,
    name: `Session ${id}`,
    cwd: groupPath,
    groupPath,
    endedAt: 1000,
    archivedAt: 2000,
    sessionFile: `/tmp/sessions/${id}.jsonl`,
  };
}

function okResponse(items: ArchivedSessionSummary[], nextCursor?: string) {
  return {
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve({ success: true, data: { items, ...(nextCursor ? { nextCursor } : {}) } }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useArchivedSessions", () => {
  it("F6: a rejected first page sets error (no items); retry fetches again", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(okResponse([makeItem("a1")]));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useArchivedSessions());

    await act(async () => { result.current.loadFirst("/a"); });
    const failed = result.current.get("/a");
    expect(failed.error).toBeTruthy();
    expect(failed.items).toEqual([]);
    expect(failed.loading).toBe(false);

    await act(async () => { result.current.retry("/a"); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const recovered = result.current.get("/a");
    expect(recovered.error).toBeUndefined();
    expect(recovered.items.map((i) => i.id)).toEqual(["a1"]);
  });

  it("F7: loaded key is cached (second loadFirst does not fetch); invalidate forces a refetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse([makeItem("a1"), makeItem("a2")], "cursor-1"))
      .mockResolvedValueOnce(okResponse([makeItem("a1"), makeItem("a2"), makeItem("a3")]));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useArchivedSessions());

    await act(async () => { result.current.loadFirst("/a"); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.get("/a").items.length).toBe(2);
    expect(result.current.get("/a").nextCursor).toBe("cursor-1");

    // Cached — collapse/re-expand does not refetch.
    await act(async () => { result.current.loadFirst("/a"); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Count-change invalidation drops the cache…
    act(() => { result.current.invalidate("/a"); });
    expect(result.current.get("/a").loaded).toBe(false);

    // …so the next expansion refetches the first page.
    await act(async () => { result.current.loadFirst("/a"); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.get("/a").items.length).toBe(3);
  });

  it("loadMore appends the next page using nextCursor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse([makeItem("a1")], "cursor-1"))
      .mockResolvedValueOnce(okResponse([makeItem("a2")]));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useArchivedSessions());
    await act(async () => { result.current.loadFirst("/a"); });
    await act(async () => { result.current.loadMore("/a"); });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondUrl).toContain("cursor=cursor-1");
    expect(result.current.get("/a").items.map((i) => i.id)).toEqual(["a1", "a2"]);
    expect(result.current.get("/a").nextCursor).toBeUndefined();
  });

  it("search key q:<text> issues q= requests instead of cwd=", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useArchivedSessions());
    await act(async () => { result.current.loadFirst("q:allowlist"); });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/sessions/archived?");
    expect(url).toContain("q=allowlist");
    expect(url).not.toContain("cwd=");
  });
});
