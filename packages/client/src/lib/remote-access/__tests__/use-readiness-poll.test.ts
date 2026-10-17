/**
 * Readiness is polled only while a provider-dependent step is current.
 * Test-plan #P1. See change: add-remote-access-wizard.
 */
import type { ProviderReadiness } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReadinessPoll } from "../use-readiness-poll.js";

const board = [{ provider: "zrok", state: "disconnected", endpoints: [] }] as ProviderReadiness[];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useReadinessPoll", () => {
  it("P1: 1 on open, 0 on landing, provider step skips in-flight ticks, +1 on return", async () => {
    // First evaluation resolves 7 s after it starts; later ones are instant.
    let calls = 0;
    const read = vi.fn(() => {
      calls++;
      return calls === 2
        ? new Promise<ProviderReadiness[]>((resolve) => setTimeout(() => resolve(board), 7_000))
        : Promise.resolve(board);
    });
    const { result, rerender } = renderHook(({ active }) => useReadinessPoll(active, read), { initialProps: { active: false } });

    // Dialog opens on the landing: exactly one read.
    await act(async () => {
      await result.current.tick();
    });
    expect(read).toHaveBeenCalledTimes(1);

    // 60 s on the landing: nothing more.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(read).toHaveBeenCalledTimes(1);

    // A provider step becomes current: immediate evaluation (in flight for 7 s).
    rerender({ active: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(read).toHaveBeenCalledTimes(2);

    // 5 s tick fires while that evaluation is still in flight → skipped.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(read).toHaveBeenCalledTimes(2);

    // Resolved at 7 s; the 10 s tick fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(read).toHaveBeenCalledTimes(3);

    // Back to the landing: polling stops, one read on return.
    rerender({ active: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await result.current.tick();
    });
    expect(read).toHaveBeenCalledTimes(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("keeps the last good board when a tick fails", async () => {
    const read = vi.fn().mockResolvedValueOnce(board).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useReadinessPoll(false, read));
    await act(async () => {
      await result.current.tick();
    });
    expect(result.current.providers).toEqual(board);
    await act(async () => {
      await result.current.tick();
    });
    expect(result.current.failed).toBe(true);
    expect(result.current.providers).toEqual(board);
  });

  it("stops polling on unmount", async () => {
    const read = vi.fn().mockResolvedValue(board);
    const { unmount } = renderHook(() => useReadinessPoll(true, read));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(read).toHaveBeenCalledTimes(1);
  });
});
