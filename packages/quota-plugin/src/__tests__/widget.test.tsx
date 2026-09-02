import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuotaWidget, useQuota } from "../client.js";
import type { ApiQuotaResponse, ProviderQuota } from "../types.js";

const WINDOW = 5 * 3600;
function resetIn(fraction: number): string {
  // fraction of the window still remaining until reset
  return new Date(Date.now() + WINDOW * fraction * 1000).toISOString();
}

function mockQuota(body: ApiQuotaResponse) {
  global.fetch = vi.fn(async () => ({ json: async () => body })) as unknown as typeof fetch;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("QuotaWidget", () => {
  it("renders a mini-slider per provider from /api/quota with a now tick", async () => {
    mockQuota({
      providers: [
        { provider: "openai-codex", windows: [{ label: "7d", usedPercent: 70, resetsAt: resetIn(0.4), windowSeconds: WINDOW }] },
      ],
    });
    render(<QuotaWidget />);
    await waitFor(() => expect(screen.getByTestId("quota-widget")).toBeTruthy());
    expect(screen.getByTestId("quota-slider-openai-codex")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    // The compact one-line row shows NO percentage number (dialog owns exact figures).
    expect(screen.queryByText("70%")).toBeNull();
    // `now` tick rendered when pace is available.
    expect(screen.getAllByTestId("quota-now-tick").length).toBeGreaterThan(0);
  });

  it("colours the bar fill by pace severity (over pace → orange)", async () => {
    mockQuota({
      providers: [
        { provider: "openai-codex", windows: [{ label: "7d", usedPercent: 70, resetsAt: resetIn(0.4), windowSeconds: WINDOW }] },
      ],
    });
    render(<QuotaWidget />);
    const row = await screen.findByTestId("quota-slider-openai-codex");
    // 60% elapsed, 70% used → projected ~117 → orange (#fbbf24) on the fill.
    const fill = row.querySelector<HTMLElement>('div[style*="width: 70%"]');
    expect(fill?.style.background).toBe("rgb(251, 191, 36)");
  });

  it("renders Anthropic (no longer excluded)", async () => {
    mockQuota({
      providers: [
        { provider: "anthropic", windows: [{ label: "5h", usedPercent: 30, resetsAt: resetIn(0.4), windowSeconds: WINDOW }] },
      ],
    });
    render(<QuotaWidget />);
    expect(await screen.findByTestId("quota-slider-anthropic")).toBeTruthy();
    expect(screen.getByText("Anthropic")).toBeTruthy();
  });

  it("renders nothing when /api/quota returns no providers", async () => {
    mockQuota({ providers: [] });
    const { container } = render(<QuotaWidget />);
    // Give the async load a tick; widget must never mount.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("quota-widget")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the fetch fails (honest degradation, no error UI)", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    render(<QuotaWidget />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("quota-widget")).toBeNull();
  });
});

// ── add-quota-refresh-and-retry: useQuota fetch/refresh state (design D7) ──────

const snap = (provider: string, usedPercent: number): ProviderQuota[] => [
  { provider, windows: [{ label: "7d", usedPercent, resetsAt: resetIn(0.5), windowSeconds: WINDOW }] },
];

/** A Response-like whose json() yields the given body. */
const jsonRes = (body: ApiQuotaResponse) => ({ json: async () => body }) as unknown as Response;

describe("useQuota", () => {
  it("F1: an out-of-order (slow poll) response never clobbers a newer refresh", async () => {
    let resolveSlow!: (r: Response) => void;
    const slow = new Promise<Response>((r) => {
      resolveSlow = r;
    });
    const calls: Array<() => Promise<Response>> = [
      () => slow, // seq1 — initial poll, resolves LAST
      () => Promise.resolve(jsonRes({ providers: snap("github-copilot", 20) })), // seq2 — refresh, fast
    ];
    let i = 0;
    global.fetch = vi.fn(() => calls[Math.min(i++, calls.length - 1)]()) as unknown as typeof fetch;

    const { result } = renderHook(() => useQuota());
    // Fire the manual refresh (seq2) while the poll (seq1) is still pending.
    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.providers.map((p) => p.provider)).toEqual(["github-copilot"]));
    const updatedAfterRefresh = result.current.lastUpdated;

    // Now the slow seq1 finally resolves — it must be dropped.
    await act(async () => {
      resolveSlow(jsonRes({ providers: snap("openai-codex", 99) }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.providers.map((p) => p.provider)).toEqual(["github-copilot"]);
    expect(result.current.lastUpdated).toBe(updatedAfterRefresh); // never regresses
  });

  it("F1b: a failed NEWER refresh still supersedes a slower older poll", async () => {
    let resolveSlow!: (r: Response) => void;
    const slow = new Promise<Response>((r) => {
      resolveSlow = r;
    });
    const calls: Array<() => Promise<Response>> = [
      () => slow, // seq1 — initial poll, resolves LAST, with real data
      () => Promise.reject(new Error("network")), // seq2 — refresh, fails FIRST
    ];
    let i = 0;
    global.fetch = vi.fn(() => calls[Math.min(i++, calls.length - 1)]()) as unknown as typeof fetch;

    const { result } = renderHook(() => useQuota());
    await act(async () => {
      result.current.refresh(); // issues seq2, which rejects
      await Promise.resolve();
      await Promise.resolve();
    });
    // seq1 (older poll) now resolves with data — it must NOT clobber, since a
    // newer request (seq2) was already issued. Snapshot stays empty.
    await act(async () => {
      resolveSlow(jsonRes({ providers: snap("openai-codex", 10) }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.providers).toEqual([]);
    expect(result.current.lastUpdated).toBeNull();
  });

  it("F2: refresh is a no-op while a request is already in flight", async () => {
    let pending!: (r: Response) => void;
    const held = new Promise<Response>((r) => {
      pending = r;
    });
    const fetchSpy = vi.fn(() => held) as unknown as typeof fetch;
    global.fetch = fetchSpy;

    const { result } = renderHook(() => useQuota());
    // Initial poll is call #1 (held). First refresh is call #2 (held, in flight).
    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
    });
    expect(result.current.isRefreshing).toBe(true);
    // Second refresh while in flight — must NOT issue another fetch.
    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
    });
    expect((fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    pending(jsonRes({ providers: [] }));
  });

  it("X1: a failed refresh keeps the prior snapshot and its caption", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonRes({ providers: snap("openai-codex", 42) })),
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useQuota());
    await waitFor(() => expect(result.current.providers.map((p) => p.provider)).toEqual(["openai-codex"]));
    const priorUpdated = result.current.lastUpdated;

    // The refresh rejects — the prior snapshot and lastUpdated must survive.
    global.fetch = vi.fn(() => Promise.reject(new Error("network"))) as unknown as typeof fetch;
    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.providers.map((p) => p.provider)).toEqual(["openai-codex"]);
    expect(result.current.lastUpdated).toBe(priorUpdated);
    expect(result.current.isRefreshing).toBe(false);
  });
});
