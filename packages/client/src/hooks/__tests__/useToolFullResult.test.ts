/**
 * `useToolFullResult` encodes the tool-call id: a nested id carries `/`, which
 * Fastify only routes as ONE `:toolCallId` param when encoded (`%2F`).
 * Test-plan E20. See change: render-nested-tool-calls (D3).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useToolFullResult } from "../useToolFullResult.js";

describe("useToolFullResult (E20)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("requests /tool-result/<encoded nested id>", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: "full" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useToolFullResult("s1", "call_1/1"));
    await act(async () => {
      await result.current.fetchFull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/tool-result\/call_1%2F1$/);
    expect(result.current.result).toBe("full");
  });

  it("leaves a plain top-level id unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: "x" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useToolFullResult("s1", "toolu_01"));
    await act(async () => {
      await result.current.fetchFull();
    });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/sessions\/s1\/tool-result\/toolu_01$/);
  });
});
