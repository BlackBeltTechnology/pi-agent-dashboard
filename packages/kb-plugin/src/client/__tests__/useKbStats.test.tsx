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
  const { stats, error } = useKbStats(cwd);
  return <div data-testid="probe" data-chunks={stats?.chunks ?? ""} data-error={error ?? ""} data-indexing={String(stats?.indexing ?? "")} />;
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

  it("surfaces a typed error on a non-JSON (HTML) response", async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () =>
      new Response("<html>oops</html>", { status: 500, headers: { "content-type": "text/html" } }),
    );
    const { getByTestId } = render(<Probe cwd="/repo" />);
    await waitFor(() => expect(getByTestId("probe").getAttribute("data-error")).toMatch(/HTTP 500/));
  });
});
