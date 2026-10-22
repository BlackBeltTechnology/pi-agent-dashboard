import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useServerCapabilities } from "../useServerCapabilities.js";

vi.mock("../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

const health = (body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ json: async () => body } as Response);

afterEach(() => vi.restoreAllMocks());

describe("useServerCapabilities platform (scope-anchor-editor-pane-controls D10)", () => {
  it.each([
    ["darwin", "darwin"],
    ["win32", "win32"],
    [undefined, undefined],
    [42, undefined],
  ])("platform %s → %s", async (platform, expected) => {
    health({ capabilities: { systemOpen: true }, platform });
    const { result } = renderHook(() => useServerCapabilities());
    await waitFor(() => expect(result.current.systemOpen).toBe(true));
    expect(result.current.platform).toBe(expected);
  });

  it("a failing health fetch keeps the defaults", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useServerCapabilities());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    // Let the rejection settle through the hook's `.catch` before asserting the defaults held.
    await act(async () => {
      await fetchSpy.mock.results[0].value.catch(() => {});
    });
    expect(result.current).toEqual({ systemOpen: false });
  });
});
