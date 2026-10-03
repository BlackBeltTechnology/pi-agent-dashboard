import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetArchiveCache, getArchiveState, requestArchive } from "../archive-cache.js";

const ENTRY = { name: "2026-09-30-x", date: "2026-09-30", artifacts: [{ id: "proposal", status: "done" }] };
let fetchMock: ReturnType<typeof vi.fn>;

function okResponse(data: unknown = [ENTRY]) {
  return Promise.resolve({ json: () => Promise.resolve({ success: true, data }) } as Response);
}
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };

beforeEach(() => {
  vi.useFakeTimers();
  __resetArchiveCache();
  fetchMock = vi.fn(() => okResponse());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("archive-cache", () => {
  it("E15 dedupes concurrent requests", async () => {
    for (let i = 0; i < 20; i++) requestArchive("/repo", "a,b");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getArchiveState("/repo", "a,b").status).toBe("loading");
    await flush();
    const s = getArchiveState("/repo", "a,b");
    expect(s.status).toBe("ok");
    expect(s.entries).toHaveLength(1);
  });
  it("E16 refetches when active signature changes; stale entries read as loading", async () => {
    requestArchive("/repo", "add-auth,b"); await flush();
    expect(getArchiveState("/repo", "b").status).toBe("loading");
    requestArchive("/repo", "b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("E17 TTL boundary 5 min", async () => {
    requestArchive("/repo", "a"); await flush();
    vi.advanceTimersByTime(5 * 60_000 - 1000);
    requestArchive("/repo", "a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    requestArchive("/repo", "a");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("X1 error state, retry after 30 s", async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ json: () => Promise.resolve({ success: false, error: "boom" }) } as Response));
    requestArchive("/repo", "a"); await flush();
    expect(getArchiveState("/repo", "a")).toMatchObject({ status: "error", error: "boom" });
    vi.advanceTimersByTime(29_000);
    requestArchive("/repo", "a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    requestArchive("/repo", "a");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("network rejection becomes an error state", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("net down")));
    requestArchive("/repo", "a"); await flush();
    expect(getArchiveState("/repo", "a")).toMatchObject({ status: "error", error: "net down" });
  });
  it("null signature adopts the first real signature without refetching", async () => {
    requestArchive("/repo", null); await flush();
    requestArchive("/repo", "a,b");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getArchiveState("/repo", "a,b").status).toBe("ok");
  });
  it("a superseded in-flight response does not clobber the newer one", async () => {
    let first!: (v: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { first = r; }));
    requestArchive("/repo", "a");
    requestArchive("/repo", "b");
    await flush();
    first({ json: () => Promise.resolve({ success: true, data: [] }) } as Response);
    await flush();
    expect(getArchiveState("/repo", "b").entries).toHaveLength(1);
  });
});
