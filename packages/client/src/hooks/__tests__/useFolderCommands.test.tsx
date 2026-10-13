/**
 * `useFolderCommands` / `fetchFolderCommands` — sessionless command list.
 * test-plan X1 (404 → empty, ≤1 request), X2 (500 / network → empty).
 * See change: redesign-directory-home-split.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFolderCommandsCache, useFolderCommands } from "../useFolderCommands.js";

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, statusText: "", headers: new Headers({ "content-type": "application/json" }), json: async () => body }) as unknown as Response;

/** Let the hook's fetch → state-update chain settle (microtasks only). */
const flush = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetFolderCommandsCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("useFolderCommands", () => {
  it("returns the folder list and origin on success, with one request per cwd", async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: { origin: "scan", commands: [{ name: "skill:x", source: "skill", scope: "folder" }] } }));
    const { result, rerender } = renderHook(({ cwd }) => useFolderCommands(cwd), { initialProps: { cwd: "/p" as string | undefined } });
    await waitFor(() => expect(result.current.commands).toHaveLength(1));
    expect(result.current.origin).toBe("scan");
    rerender({ cwd: "/p" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/pi-resources/commands?cwd=%2Fp");
  });

  it("X1: a 404 (old server) yields [] with no throw and a single request", async () => {
    fetchMock.mockResolvedValue(json(404, { error: "not found" }));
    const { result } = renderHook(() => useFolderCommands("/p"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await flush();
    expect(result.current).toEqual({ commands: [], origin: "none" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("X2: a 500 yields []", async () => {
    fetchMock.mockResolvedValue(json(500, { error: "boom" }));
    const { result } = renderHook(() => useFolderCommands("/p"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await flush();
    expect(result.current.commands).toEqual([]);
  });

  it("X2: a network error yields []", async () => {
    fetchMock.mockRejectedValue(new TypeError("network"));
    const { result } = renderHook(() => useFolderCommands("/p"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await flush();
    expect(result.current).toEqual({ commands: [], origin: "none" });
  });

  it("stays idle (no request) without a cwd, and never shows another cwd's list", async () => {
    const { result } = renderHook(() => useFolderCommands(undefined));
    expect(result.current.commands).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
