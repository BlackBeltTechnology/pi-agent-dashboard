import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useArchiveListing } from "../../../hooks/useArchiveListing.js";
import { archiveEntry, knownData, makeChange, stubArchiveApi } from "../../../test-support/attachmentHarness.js";
import { OpenSpecMapContext } from "../OpenSpecMapContext.js";
import { useAttachmentResolution } from "../useAttachmentResolution.js";

afterEach(() => vi.unstubAllGlobals());

const session = (id: string, name: string): DashboardSession =>
  ({ id, cwd: "/repo", status: "ended", source: "tui", startedAt: new Date(2026, 8, 20).getTime(), attachedProposal: name }) as DashboardSession;
const wrapperFor = (map: Map<string, any>) => ({ children }: { children: React.ReactNode }) => (
  <OpenSpecMapContext.Provider value={map}>{children}</OpenSpecMapContext.Provider>
);

describe("useAttachmentResolution", () => {
  it("E18 lazy: sessions resolving active never fetch the archive", () => {
    const fetchSpy = stubArchiveApi({});
    const wrapper = wrapperFor(new Map([["/repo", knownData(makeChange("a"))]]));
    for (let i = 0; i < 5; i++) renderHook(() => useAttachmentResolution(session(`s${i}`, "a")), { wrapper });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("E15 dedupe: 20 sessions needing the same archive issue one request", async () => {
    const fetchSpy = stubArchiveApi({ "/repo": [archiveEntry("2026-09-30-gone")] });
    const wrapper = wrapperFor(new Map([["/repo", knownData()]]));
    const hooks = Array.from({ length: 20 }, (_, i) => renderHook(() => useAttachmentResolution(session(`s${i}`, "gone")), { wrapper }));
    await waitFor(() => expect(hooks.every((h) => h.result.current?.kind === "archived")).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("X1 a failed fetch resolves unresolved{error} and useArchiveListing exposes the error", async () => {
    stubArchiveApi({ "/repo": "error" });
    const wrapper = wrapperFor(new Map([["/repo", knownData()]]));
    const res = renderHook(() => useAttachmentResolution(session("s", "gone")), { wrapper });
    await waitFor(() => expect(res.result.current).toEqual({ kind: "unresolved", reason: "error" }));
    const listing = renderHook(() => useArchiveListing("/repo"), { wrapper });
    expect(listing.result.current.error).toBe("boom");
  });

  it("B2 a mounted reader re-requests when the TTL is due (5 min) on its next render", async () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = stubArchiveApi({ "/repo": [archiveEntry("2026-09-30-gone")] });
      const wrapper = wrapperFor(new Map([["/repo", knownData()]]));
      const hook = renderHook(() => useAttachmentResolution(session("s", "gone")), { wrapper });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000 - 1000); });
      hook.rerender();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      hook.rerender();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("B2 a mounted reader retries a failed fetch 30 s later, on its next render", async () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = stubArchiveApi({ "/repo": "error" });
      const wrapper = wrapperFor(new Map([["/repo", knownData()]]));
      const hook = renderHook(() => useAttachmentResolution(session("s", "gone")), { wrapper });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
      hook.rerender();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      hook.rerender();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null with no attachment", () => {
    stubArchiveApi({});
    const { result } = renderHook(() => useAttachmentResolution({ ...session("s", "x"), attachedProposal: null }));
    expect(result.current).toBeNull();
  });
});
