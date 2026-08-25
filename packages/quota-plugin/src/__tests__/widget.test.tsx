import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuotaWidget } from "../client.js";
import type { ApiQuotaResponse } from "../types.js";

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
