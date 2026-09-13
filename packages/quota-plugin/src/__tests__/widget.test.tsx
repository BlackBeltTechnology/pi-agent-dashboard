import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { providerForModel, QuotaWidget, useQuota } from "../client.js";
import type { ApiQuotaResponse, ProviderQuota, QuotaWindowDto } from "../types.js";

const WINDOW = 5 * 3600;
function resetIn(fraction: number): string {
  // fraction of the window still remaining until reset
  return new Date(Date.now() + WINDOW * fraction * 1000).toISOString();
}

function win(label: string, usedPercent: number, extra: Partial<QuotaWindowDto> = {}): QuotaWindowDto {
  return { label, usedPercent, resetsAt: resetIn(0.4), windowSeconds: WINDOW, ...extra };
}

function makeSession(over: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/repo",
    source: "pi",
    status: "active",
    startedAt: 0,
    ...over,
  } as DashboardSession;
}

function mockQuota(body: ApiQuotaResponse) {
  global.fetch = vi.fn(async () => ({ json: async () => body })) as unknown as typeof fetch;
}

/** All chip testids in document order. */
function chipIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="quota-chip-"]')).map(
    (el) => el.dataset.testid ?? "",
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("providerForModel", () => {
  it("E9: takes the prefix before the first slash; undefined without a slash", () => {
    expect(providerForModel("anthropic/x")).toBe("anthropic");
    expect(providerForModel("openai-codex/x")).toBe("openai-codex");
    expect(providerForModel(undefined)).toBe(undefined);
    expect(providerForModel("my-alias")).toBe(undefined);
    expect(providerForModel("a/b/c")).toBe("a");
  });
});

describe("QuotaWidget context-strip chip", () => {
  it("E1: no providers → renders nothing, no error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuota({ providers: [] });
    const { container } = render(<QuotaWidget session={makeSession({ model: "anthropic/claude-x" })} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("quota-context-group")).toBe(null);
    expect(screen.queryByTestId("quota-no-adapter-note")).toBe(null);
    expect(container.childElementCount).toBe(0);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("E2: a provider with zero windows is filtered out (no group)", async () => {
    mockQuota({ providers: [{ provider: "anthropic", windows: [] }] });
    const { container } = render(<QuotaWidget session={makeSession()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("quota-context-group")).toBe(null);
    expect(container.childElementCount).toBe(0);
  });

  it("E3: every window renders inline with a bar each", async () => {
    mockQuota({
      providers: [
        { provider: "anthropic", windows: [win("5h", 14), win("7d", 32)] },
      ],
    });
    render(<QuotaWidget session={makeSession()} />);
    const chip = await screen.findByTestId("quota-chip-anthropic");
    expect(chip.textContent).toContain("5h");
    expect(chip.textContent).toContain("14%");
    expect(chip.textContent).toContain("7d");
    expect(chip.textContent).toContain("32%");
    expect(chip.querySelectorAll('[data-testid="quota-bar"]').length).toBe(2);
  });

  it("E4: the session provider's chip leads and is ringed; others dim", async () => {
    mockQuota({
      providers: [
        { provider: "openai-codex", windows: [win("7d", 40)] },
        { provider: "anthropic", windows: [win("5h", 14)] },
      ],
    });
    const { container } = render(
      <QuotaWidget session={makeSession({ model: "anthropic/claude-x" })} />,
    );
    await screen.findByTestId("quota-chip-anthropic");
    expect(chipIds(container)).toEqual(["quota-chip-anthropic", "quota-chip-openai-codex"]);
    expect(screen.getByTestId("quota-chip-anthropic").getAttribute("data-session-provider")).toBe("true");
    expect(screen.getByTestId("quota-chip-openai-codex").getAttribute("data-dimmed")).toBe("true");
    expect(screen.queryByTestId("quota-no-adapter-note")).toBe(null);
  });

  it("E5: a defined provider with no quota gets a dashed note ahead of dimmed chips", async () => {
    mockQuota({ providers: [{ provider: "anthropic", windows: [win("5h", 14)] }] });
    render(<QuotaWidget session={makeSession({ model: "google-vertex/gemini-x" })} />);
    const note = await screen.findByTestId("quota-no-adapter-note");
    expect(note.textContent).toBe("gemini-x · no quota");
    expect(note.tagName).not.toBe("BUTTON");
    const chip = screen.getByTestId("quota-chip-anthropic");
    expect(note.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(chip.getAttribute("data-dimmed")).toBe("true");
    expect(chip.getAttribute("data-session-provider")).toBe(null);
  });

  it("E6: an undefined model yields no ring, no dim and no note", async () => {
    mockQuota({
      providers: [
        { provider: "anthropic", windows: [win("5h", 14)] },
        { provider: "openai-codex", windows: [win("7d", 40)] },
      ],
    });
    render(<QuotaWidget session={makeSession()} />);
    await screen.findByTestId("quota-chip-anthropic");
    for (const id of ["quota-chip-anthropic", "quota-chip-openai-codex"]) {
      expect(screen.getByTestId(id).getAttribute("data-session-provider")).toBe(null);
      expect(screen.getByTestId(id).getAttribute("data-dimmed")).toBe(null);
    }
    expect(screen.queryByTestId("quota-no-adapter-note")).toBe(null);
  });

  it("E7: a model without a slash is treated as undefined", async () => {
    mockQuota({ providers: [{ provider: "anthropic", windows: [win("5h", 14)] }] });
    render(<QuotaWidget session={makeSession({ model: "my-alias" })} />);
    const chip = await screen.findByTestId("quota-chip-anthropic");
    expect(chip.getAttribute("data-session-provider")).toBe(null);
    expect(chip.getAttribute("data-dimmed")).toBe(null);
    expect(screen.queryByTestId("quota-no-adapter-note")).toBe(null);
  });

  it("E8: the note uses the model id after the first slash", async () => {
    mockQuota({ providers: [{ provider: "anthropic", windows: [win("5h", 14)] }] });
    render(
      <QuotaWidget
        session={makeSession({ model: "google-vertex/publishers/google/models/gemini-x" })}
      />,
    );
    const note = await screen.findByTestId("quota-no-adapter-note");
    expect(note.textContent).toBe("publishers/google/models/gemini-x · no quota");
  });

  it("E10: a stale provider is tagged and its bars are muted", async () => {
    mockQuota({
      providers: [{ provider: "anthropic", windows: [win("5h", 14)], stale: true }],
    });
    render(<QuotaWidget session={makeSession()} />);
    const chip = await screen.findByTestId("quota-chip-anthropic");
    expect(chip.getAttribute("data-stale")).toBe("true");
    expect(chip.textContent).toContain("not live");
    const fill = chip.querySelector<HTMLElement>('[data-testid="quota-bar"] > div');
    expect(fill?.getAttribute("data-severity")).toBe("muted");
  });

  it("E11: the chip never repeats the model id", async () => {
    mockQuota({ providers: [{ provider: "anthropic", windows: [win("5h", 14)] }] });
    render(<QuotaWidget session={makeSession({ model: "anthropic/claude-sonnet-4" })} />);
    const chip = await screen.findByTestId("quota-chip-anthropic");
    expect(chip.textContent).not.toContain("claude-sonnet-4");
  });

  it("F6: a model change re-derives the ring on the next render", async () => {
    mockQuota({
      providers: [
        { provider: "anthropic", windows: [win("5h", 14)] },
        { provider: "openai-codex", windows: [win("7d", 40)] },
      ],
    });
    const { container, rerender } = render(
      <QuotaWidget session={makeSession({ model: "anthropic/x" })} />,
    );
    await screen.findByTestId("quota-chip-anthropic");
    rerender(<QuotaWidget session={makeSession({ model: "openai-codex/y" })} />);
    expect(chipIds(container)).toEqual(["quota-chip-openai-codex", "quota-chip-anthropic"]);
    expect(screen.getByTestId("quota-chip-openai-codex").getAttribute("data-session-provider")).toBe("true");
    expect(screen.getByTestId("quota-chip-anthropic").getAttribute("data-dimmed")).toBe("true");
  });

  it("X1: a rejected fetch renders nothing and does not throw", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const { container } = render(<QuotaWidget session={makeSession()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.childElementCount).toBe(0);
    expect(screen.queryByTestId("quota-context-group")).toBe(null);
  });

  it("X2: a malformed body renders nothing and does not throw", async () => {
    mockQuota({} as unknown as ApiQuotaResponse);
    const { container } = render(<QuotaWidget session={makeSession()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.childElementCount).toBe(0);
    expect(screen.queryByTestId("quota-context-group")).toBe(null);
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
    expect(result.current.lastUpdated).toBe(null);
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
