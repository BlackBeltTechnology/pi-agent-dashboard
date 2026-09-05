/**
 * Unit tests for `usePiChangelog`.
 *
 * See change: pi-update-whats-new-panel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePiChangelog } from "../usePiChangelog.js";
import type { ChangelogResponse } from "@blackbelt-technology/pi-dashboard-shared/changelog-types.js";

function makeResponse(): ChangelogResponse {
  return {
    pkg: "@mariozechner/pi-coding-agent",
    from: "0.62.0",
    to: "0.70.0",
    releases: [],
    hasBreaking: false,
    changelogUrl: null,
    parsedAt: "2026-05-08T00:00:00.000Z",
  };
}

describe("usePiChangelog", () => {
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeResponse(),
    });
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT fetch when enabled is false", () => {
    renderHook(() =>
      usePiChangelog("@mariozechner/pi-coding-agent", "0.62.0", "0.70.0", { enabled: false }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches once when enabled and resolves data", async () => {
    const { result } = renderHook(() =>
      usePiChangelog("@mariozechner/pi-coding-agent", "0.62.0", "0.70.0", { enabled: true }),
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data!.pkg).toBe("@mariozechner/pi-coding-agent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("does not fetch when from or to is missing", () => {
    renderHook(() =>
      usePiChangelog("@mariozechner/pi-coding-agent", undefined, "0.70.0", { enabled: true }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears state when enabled flips to false", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePiChangelog("@mariozechner/pi-coding-agent", "0.62.0", "0.70.0", { enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    rerender({ enabled: false });
    expect(result.current.data).toBeNull();
  });

  it("refetches on pi_core_update_complete WS event for the same pkg", async () => {
    const { result } = renderHook(() =>
      usePiChangelog("@mariozechner/pi-coding-agent", "0.62.0", "0.70.0", { enabled: true }),
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const initialCalls = fetchMock.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("pi-core-event", {
          detail: {
            type: "pi_core_update_complete",
            results: [{ name: "@mariozechner/pi-coding-agent", success: true }],
          },
        }),
      );
      // Yield once so the handler's microtasks settle.
      await Promise.resolve();
    });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls));
  });

  it("ignores pi_core_update_complete for unrelated packages", async () => {
    const { result } = renderHook(() =>
      usePiChangelog("@mariozechner/pi-coding-agent", "0.62.0", "0.70.0", { enabled: true }),
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const initialCalls = fetchMock.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("pi-core-event", {
          detail: {
            type: "pi_core_update_complete",
            results: [{ name: "some-other-pkg", success: true }],
          },
        }),
      );
      await Promise.resolve();
    });
    // Flush microtasks and confirm no extra fetch.
    await act(async () => {});
    expect(fetchMock.mock.calls.length).toBe(initialCalls);
  });

  it("surfaces fetch error without throwing", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: "bootstrap installing" }),
    });
    const { result } = renderHook(() =>
      usePiChangelog("@mariozechner/pi-coding-agent", "0.62.0", "0.70.0", { enabled: true }),
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toMatch(/bootstrap installing/);
    expect(result.current.data).toBeNull();
  });
});
