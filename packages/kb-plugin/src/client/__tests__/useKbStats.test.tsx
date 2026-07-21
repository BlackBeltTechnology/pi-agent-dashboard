/**
 * useKbStats — polls while indexing, stops on completion (task 2.1); surfaces
 * a malformed-response error (task 2.2). See change: add-kb-folder-slot.
 */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KbStats } from "../../shared/kb-plugin-types.js";
import { REINDEX_GUARD_MS, useKbStats } from "../useKbStats.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function json(s: KbStats): Response {
  return { ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => s } as unknown as Response;
}
function jsonResp(body: unknown, ok = true, status = 200): Response {
  return { ok, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as unknown as Response;
}
/** Non-blocking reindex ack: POST → 202 { status:"running" }. */
function json202(): Response {
  return jsonResp({ status: "running", jobId: "kb-1" }, true, 202);
}
function base(over: Partial<KbStats> = {}): KbStats {
  return { files: 1, chunks: 0, indexed: false, staleCount: 0, indexing: false, jobStatus: "idle", ...over };
}

/** Probe that also exposes optimistic `pending` + a click-to-reindex button. */
function ReindexProbe({ cwd }: { cwd: string }): React.ReactElement {
  const { stats, reindexError, pending, reindex } = useKbStats(cwd);
  return (
    <div
      data-testid="probe"
      data-pending={String(pending)}
      data-indexing={String(stats?.indexing ?? "")}
      data-chunks={stats?.chunks ?? ""}
      data-reindex-error={reindexError ?? ""}
    >
      <button type="button" data-testid="go" onClick={() => reindex()}>go</button>
    </div>
  );
}
const getCount = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method !== "POST").length;

/** Probe that also surfaces the poll-outage `error` channel. */
function ReindexProbeErr({ cwd }: { cwd: string }): React.ReactElement {
  const { error, pending, reindex } = useKbStats(cwd);
  return (
    <div data-testid="probe" data-pending={String(pending)} data-error={error ?? ""}>
      <button type="button" data-testid="go" onClick={() => reindex()}>go</button>
    </div>
  );
}

function Probe({ cwd }: { cwd: string }): React.ReactElement {
  const { stats, error, reindexError } = useKbStats(cwd);
  return (
    <div
      data-testid="probe"
      data-chunks={stats?.chunks ?? ""}
      data-error={error ?? ""}
      data-reindex-error={reindexError ?? ""}
      data-indexing={String(stats?.indexing ?? "")}
    />
  );
}

describe("useKbStats", () => {
  it("polls while indexing then stops once the job completes", async () => {
    const responses = [
      base({ indexing: true, jobStatus: "running" }),
      base({ indexing: true, jobStatus: "running" }),
      base({ indexing: false, chunks: 42, indexed: true }),
    ];
    let i = 0;
    const fetchMock = vi.fn(async () => json(responses[Math.min(i++, responses.length - 1)]));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const { getByTestId } = render(<Probe cwd="/repo" />);
    // Eventually reaches the settled state with chunks populated.
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-chunks")).toBe("42"), { timeout: 5000 });
    const callsAtSettle = fetchMock.mock.calls.length;
    // No further polling after settle.
    await new Promise((r) => setTimeout(r, 1200));
    expect(fetchMock.mock.calls.length).toBe(callsAtSettle);
  });

  it("surfaces a typed error only after a bounded run of consecutive poll failures", async () => {
    // Resilient poll: MAX_POLL_MISSES=3 consecutive misses before giving up.
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () =>
      new Response("<html>oops</html>", { status: 500, headers: { "content-type": "text/html" } }),
    );
    const { getByTestId } = render(<Probe cwd="/repo" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-error")).toMatch(/HTTP 500/), { timeout: 5000 });
  });

  it("sets pending=true synchronously on reindex() before any promise resolves (task 1.1)", async () => {
    const seq = [base(), base({ indexing: true, jobStatus: "running" }), base({ indexing: false, chunks: 5, indexed: true })];
    let i = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json202() : json(seq[Math.min(i++, seq.length - 1)]),
    );
    const { getByTestId } = render(<ReindexProbe cwd="/repo" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"));
    fireEvent.click(getByTestId("go"));
    // Synchronous: pending flips true in the SAME render as the click, before any fetch resolves.
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("true");
    // And it resolves cleanly into the real polled state (no permanent optimistic spinner).
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-chunks")).toBe("5"), { timeout: 5000 });
  });

  it("clears pending only when a /stats poll observes indexing:true — no false/false gap (task 1.2)", async () => {
    const seq = [base(), base({ indexing: true, jobStatus: "running" })];
    let i = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json202() : json(seq[Math.min(i++, seq.length - 1)]),
    );
    const { getByTestId } = render(<ReindexProbe cwd="/repo" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"));
    fireEvent.click(getByTestId("go"));
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("true");
    // Handoff: pending clears exactly when indexing:true is observed — same commit, no gap.
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"));
    expect(getByTestId("probe").getAttribute("data-indexing")).toBe("true");
  });

  it("clears pending and sets reindexError when the trigger POST is rejected (task 1.3)", async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? jsonResp({ error: "cwd not allowed" }, false, 403) : json(base()),
    );
    const { getByTestId } = render(<ReindexProbe cwd="/repo" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"));
    fireEvent.click(getByTestId("go"));
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("true");
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-reindex-error")).toMatch(/cwd not allowed/));
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("false");
  });

  it("clears pending via the bounded timeout guard when indexing:true is never observed (task 1.4)", async () => {
    // 202 ack but /stats always reports settled (job finished before the first poll):
    // indexing:true is never seen, so only the guard can clear pending.
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json202() : json(base({ indexing: false, chunks: 9, indexed: true })),
    );
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId } = render(<ReindexProbe cwd="/repo" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"));
    fireEvent.click(getByTestId("go"));
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("true");
    const getsBefore = getCount(fetchMock);
    // Neither reject nor indexing:true fires → the guard clears pending and refetches fresh stats.
    await waitFor(
      () => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"),
      { timeout: REINDEX_GUARD_MS + 3000 },
    );
    expect(getCount(fetchMock)).toBeGreaterThan(getsBefore);
  }, REINDEX_GUARD_MS + 6000);

  it("resets pending when cwd changes so it never leaks across folders (CodeRabbit)", async () => {
    // Hang ALL requests so pending stays true and no background fetch resolves after exit.
    (globalThis as { fetch?: unknown }).fetch = vi.fn(() => new Promise<Response>(() => {}));
    const { getByTestId, rerender } = render(<ReindexProbe cwd="/repo/a" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"));
    fireEvent.click(getByTestId("go"));
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("true");
    rerender(<ReindexProbe cwd="/repo/b" />);
    // The new folder starts clean — no leaked optimistic spinner.
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("false");
  });

  it("reindex() clears a prior poll `error` so the optimistic spinner is not masked (CodeRabbit)", async () => {
    // First: a persistent poll outage surfaces `error`; then a reindex click must clear it.
    let allow202 = false;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") { allow202 = true; return json202(); }
      return allow202 ? json(base({ indexing: true, jobStatus: "running" })) : new Response("<html/>", { status: 500, headers: { "content-type": "text/html" } });
    });
    const { getByTestId } = render(<ReindexProbeErr cwd="/repo" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-error")).toMatch(/HTTP 500/), { timeout: 5000 });
    fireEvent.click(getByTestId("go"));
    // Optimistic pending fires AND the stale poll error is cleared in the same commit.
    expect(getByTestId("probe").getAttribute("data-pending")).toBe("true");
    expect(getByTestId("probe").getAttribute("data-error")).toBe("");
    // Settle the reindex flow (202 → poll sees indexing:true → pending clears) before exit
    // so no background state update leaks past the test.
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-pending")).toBe("false"), { timeout: 5000 });
  });

  it("tolerates a lone transient poll miss during indexing without dropping the spinner (task 2.3)", async () => {
    let call = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => {
      call += 1;
      if (call === 2) throw new Error("network blip"); // one transient miss mid-walk
      if (call >= 4) return json(base({ indexing: false, chunks: 7, indexed: true }));
      return json(base({ indexing: true, jobStatus: "running" }));
    });
    const { getByTestId } = render(<Probe cwd="/repo" />);
    // The spinner (indexing:true) shows and survives the blip.
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-indexing")).toBe("true"));
    // Polling continues to the terminal state; error never surfaces.
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-chunks")).toBe("7"), { timeout: 5000 });
    expect(getByTestId("probe").getAttribute("data-error")).toBe("");
  });
});
