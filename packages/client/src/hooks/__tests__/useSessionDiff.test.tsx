import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionDiff } from "../useSessionDiff.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const response = () => ({
  json: async () => ({ success: true, data: { files: [], isGitRepo: true } }),
}) as Response;

describe("useSessionDiff single-flight refresh", () => {
  afterEach(() => vi.restoreAllMocks());

  it("coalesces refreshes during an in-flight request into one trailing fetch", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result } = renderHook(() => useSessionDiff("session-1"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.refresh();
      result.current.refresh();
      result.current.refresh();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve(response()));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => second.resolve(response()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
