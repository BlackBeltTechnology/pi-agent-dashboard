/**
 * useKbStats — polls while indexing, stops on completion (task 2.1); surfaces
 * a malformed-response error (task 2.2). See change: add-kb-folder-slot.
 */

import { cleanup, render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KbStats } from "../../shared/kb-plugin-types.js";
import { useKbStats } from "../useKbStats.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function json(s: KbStats): Response {
  return { ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => s } as unknown as Response;
}
function base(over: Partial<KbStats> = {}): KbStats {
  return { files: 1, chunks: 0, indexed: false, staleCount: 0, indexing: false, jobStatus: "idle", ...over };
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
