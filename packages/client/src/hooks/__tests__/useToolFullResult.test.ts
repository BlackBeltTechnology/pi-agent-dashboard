/**
 * `useToolFullResult` encodes the tool-call id: a nested id carries `/`, which
 * Fastify only routes as ONE `:toolCallId` param when encoded (`%2F`).
 * Test-plan E20. See change: render-nested-tool-calls (D3).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../lib/i18n/i18n.js";
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

  // Review B1: the route returns the STORED end's `result`, which for a live
  // (nested or top-level) end is pi's structured `{ content: [...] }` object.
  it("formats a route-shaped structured result as text, not [object Object]", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { content: [{ type: "text", text: "line 1\nline 2" }], details: { exitCode: 0 } },
        isError: false,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useToolFullResult("s1", "call_1/1"));
    await act(async () => {
      await result.current.fetchFull();
    });
    expect(result.current.result).toBe("line 1\nline 2");
  });

  // See change: distinguish-tool-result-pending-vs-gone (test-plan E21, D7).
  it.each([
    [410, { error: "result no longer available" }],
    [404, { error: "tool call still in flight or unknown" }],
  ])("E21: %i maps to the localized evicted notice, never the raw body text", async (status, body) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useToolFullResult("s1", "toolu_01"));
    await act(async () => {
      await result.current.fetchFull();
    });
    expect(result.current.error).toBe(t("tool.resultEvicted", undefined, "result evicted"));
    expect(result.current.error).not.toBe(body.error);
  });
});
