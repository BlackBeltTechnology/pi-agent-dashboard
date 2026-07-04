/**
 * FolderKbSection — five-state render + reindex/navigation (tasks 3.1–3.3).
 * See change: add-kb-folder-slot.
 */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { KbStats } from "../../shared/kb-plugin-types.js";
import { deriveKbRowState, FolderKbSection } from "../FolderKbSection.js";
import { kbSettingsUrl } from "../kb-api.js";

const cwd = "/repo/alpha";

function stats(over: Partial<KbStats> = {}): KbStats {
  return { files: 10, chunks: 100, indexed: true, staleCount: 0, indexing: false, jobStatus: "idle", ...over };
}

function jsonResp(body: unknown, ok = true, status = 200): Response {
  return { ok, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as unknown as Response;
}
function mockStats(s: KbStats) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    // Reindex is non-blocking: POST returns 202 { status:"running" }.
    if (init?.method === "POST") return jsonResp({ status: "running", jobId: "kb-1" });
    return jsonResp(s);
  });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderSlot(hook?: unknown) {
  return render(
    <Router hook={hook as never}>
      <FolderKbSection folder={{ cwd }} />
    </Router>,
  );
}

describe("deriveKbRowState (ordered)", () => {
  it("error wins over not-indexed even when chunks:0", () => {
    expect(deriveKbRowState(stats({ chunks: 0, indexed: false, jobStatus: "error" }))).toBe("error");
  });
  it("indexing outranks the count states", () => {
    expect(deriveKbRowState(stats({ indexing: true }))).toBe("indexing");
  });
  it("not-indexed for a fresh folder", () => {
    expect(deriveKbRowState(stats({ chunks: 0, indexed: false }))).toBe("not-indexed");
  });
  it("stale when drift present", () => {
    expect(deriveKbRowState(stats({ staleCount: 3 }))).toBe("stale");
  });
  it("populated otherwise", () => {
    expect(deriveKbRowState(stats())).toBe("populated");
  });
});

describe("FolderKbSection render", () => {
  it("populated: shows the chunk count + reindex", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats({ chunks: 1247 }));
    const { getByTestId } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-kb-count").textContent).toContain("1,247"));
    expect(getByTestId("folder-kb-reindex")).toBeTruthy();
  });

  it("not-indexed: shows Index now AND keeps settings reachable", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats({ chunks: 0, indexed: false }));
    const { getByTestId, findByTestId } = renderSlot();
    await findByTestId("folder-kb-index-now");
    expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("not-indexed");
    // Settings MUST be reachable so a fresh worktree can define sources.
    expect(getByTestId("folder-kb-open-settings")).toBeTruthy();
  });

  it("error: shows Retry (not Index now) AND keeps settings reachable", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats({ chunks: 0, indexed: false, jobStatus: "error", lastError: "boom" }));
    const { getByTestId, findByTestId, queryByTestId } = renderSlot();
    await findByTestId("folder-kb-retry");
    expect(queryByTestId("folder-kb-index-now")).toBeNull();
    expect(getByTestId("folder-kb-open-settings")).toBeTruthy();
  });

  it("stale: shows the stale flag", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats({ chunks: 88, staleCount: 3 }));
    const { findByTestId } = renderSlot();
    const flag = await findByTestId("folder-kb-stale");
    expect(flag.textContent).toContain("3 stale");
  });

  it("indexing: shows the spinner state", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats({ indexing: true }));
    const { findByTestId } = renderSlot();
    const row = await findByTestId("folder-kb-section");
    await waitFor(() => expect(row.getAttribute("data-state")).toBe("indexing"));
  });

  it("reindex click POSTs to /api/kb/reindex", async () => {
    const fetchMock = mockStats(stats());
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-kb-reindex")).toBeTruthy());
    fireEvent.click(getByTestId("folder-kb-reindex"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/kb/reindex") && (c[1] as RequestInit)?.method === "POST")).toBe(true),
    );
  });

  it("Index now → spinner while indexing, then the populated count (task 2.1)", async () => {
    // 202 on POST; GET returns not-indexed → indexing → settled, so the poll
    // observes indexing:true (unreachable under the old blocking route).
    const seq: KbStats[] = [
      stats({ chunks: 0, indexed: false }),
      stats({ chunks: 0, indexed: false, indexing: true, jobStatus: "running" }),
      stats({ chunks: 0, indexed: false, indexing: true, jobStatus: "running" }),
      stats({ chunks: 512, indexed: true }),
    ];
    let gi = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return jsonResp({ status: "running", jobId: "kb-1" });
      return jsonResp(seq[Math.min(gi++, seq.length - 1)]);
    });
    const { getByTestId, findByTestId } = renderSlot();
    await findByTestId("folder-kb-index-now");
    fireEvent.click(getByTestId("folder-kb-index-now"));
    await waitFor(() => expect(getByTestId("folder-kb-section").getAttribute("data-state")).toBe("indexing"), { timeout: 3000 });
    await waitFor(() => expect(getByTestId("folder-kb-count").textContent).toContain("512"), { timeout: 5000 });
  });

  it("rejected trigger (403) → failed + Retry, and Retry re-fires (task 2.2)", async () => {
    let posts = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts++;
        return jsonResp({ error: "cwd not allowed" }, false, 403);
      }
      return jsonResp(stats({ chunks: 0, indexed: false }));
    });
    const { getByTestId, findByTestId, queryByTestId } = renderSlot();
    await findByTestId("folder-kb-index-now");
    fireEvent.click(getByTestId("folder-kb-index-now"));
    // Trigger reject surfaces the failed state (was silently swallowed before).
    await findByTestId("folder-kb-retry");
    expect(queryByTestId("folder-kb-index-now")).toBeNull();
    fireEvent.click(getByTestId("folder-kb-retry"));
    await waitFor(() => expect(posts).toBeGreaterThanOrEqual(2));
  });

  it("count opens the KB settings overlay on click", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockStats(stats());
    const { hook, history } = memoryLocation({ path: "/", record: true });
    const { getByTestId } = renderSlot(hook);
    await waitFor(() => expect(getByTestId("folder-kb-open-settings")).toBeTruthy());
    fireEvent.click(getByTestId("folder-kb-open-settings"));
    expect(history[history.length - 1]).toBe(kbSettingsUrl(cwd));
  });
});
