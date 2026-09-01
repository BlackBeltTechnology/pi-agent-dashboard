import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmProviderCard } from "../settings/SettingsPanel.js";

const mockTestProvider = vi.fn();

vi.mock("../../lib/api/providers-api.js", () => ({
  testProvider: (...args: any[]) => mockTestProvider(...args),
}));

afterEach(() => {
  cleanup();
  mockTestProvider.mockReset();
});

const baseProvider = {
  name: "my-llm",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-abc",
  api: "openai-completions",
  isNew: true,
};

function renderCard(overrides: Partial<typeof baseProvider> = {}, onChange = vi.fn(), onRemove = vi.fn()) {
  const provider = { ...baseProvider, ...overrides };
  render(<LlmProviderCard provider={provider} onChange={onChange} onRemove={onRemove} />);
  return { onChange, onRemove };
}

describe("LlmProviderCard Test button", () => {
  beforeEach(() => {
    mockTestProvider.mockResolvedValue({ ok: true, status: 200, modelCount: 3, sample: ["m1"] });
  });

  it("renders a Test button", () => {
    renderCard();
    expect(screen.getByTestId("test-provider-button")).toBeTruthy();
  });

  it("Test button is disabled when baseUrl is empty", () => {
    renderCard({ baseUrl: "" });
    const btn = screen.getByTestId("test-provider-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/Base URL/);
  });

  it("Test button is disabled when apiKey is empty", () => {
    renderCard({ apiKey: "" });
    const btn = screen.getByTestId("test-provider-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("Test button is enabled when both baseUrl and apiKey have values", () => {
    renderCard();
    const btn = screen.getByTestId("test-provider-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("click sends POST with correct payload for a new provider (no name)", async () => {
    renderCard();
    fireEvent.click(screen.getByTestId("test-provider-button"));
    await waitFor(() => expect(mockTestProvider).toHaveBeenCalledTimes(1));
    expect(mockTestProvider).toHaveBeenCalledWith({
      name: undefined,
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-abc",
      api: "openai-completions",
    });
  });

  it("saved (non-new) provider includes name in payload", async () => {
    renderCard({ isNew: false, apiKey: "***" });
    fireEvent.click(screen.getByTestId("test-provider-button"));
    await waitFor(() => expect(mockTestProvider).toHaveBeenCalledTimes(1));
    const call = mockTestProvider.mock.calls[0][0];
    expect(call.name).toBe("my-llm");
    expect(call.apiKey).toBe("***");
  });

  it("shows success pill with model count on ok", async () => {
    mockTestProvider.mockResolvedValue({ ok: true, status: 200, modelCount: 3, sample: ["m1", "m2"] });
    renderCard();
    fireEvent.click(screen.getByTestId("test-provider-button"));
    const pill = await waitFor(() => screen.getByTestId("test-pill"));
    expect(pill.getAttribute("data-state")).toBe("ok");
    expect(pill.textContent).toMatch(/3 models/);
  });

  it("shows 'Connected' without count when modelCount is 0", async () => {
    mockTestProvider.mockResolvedValue({ ok: true, status: 200, modelCount: 0, sample: [] });
    renderCard();
    fireEvent.click(screen.getByTestId("test-provider-button"));
    const pill = await waitFor(() => screen.getByTestId("test-pill"));
    expect(pill.getAttribute("data-state")).toBe("ok");
    expect(pill.textContent).toMatch(/^\s*Connected\s*$/);
  });

  it("shows yellow error pill with HTTP status + verbatim error line", async () => {
    mockTestProvider.mockResolvedValue({ ok: false, status: 401, error: "Invalid API key\nsome detail" });
    renderCard();
    fireEvent.click(screen.getByTestId("test-provider-button"));
    const pill = await waitFor(() => screen.getByTestId("test-pill"));
    expect(pill.getAttribute("data-state")).toBe("error");
    expect(pill.textContent).toMatch(/401/);
    // verbatim error rendered on the second line (all of it, not just line one)
    expect(screen.getByTestId("provider-error-line").textContent).toBe("Invalid API key\nsome detail");
  });

  it("shows red unreachable pill when there is no status", async () => {
    mockTestProvider.mockResolvedValue({ ok: false, error: "fetch failed: ECONNREFUSED" });
    renderCard();
    fireEvent.click(screen.getByTestId("test-provider-button"));
    const pill = await waitFor(() => screen.getByTestId("test-pill"));
    expect(pill.getAttribute("data-state")).toBe("unreachable");
    expect(screen.getByTestId("provider-error-line").textContent).toMatch(/ECONNREFUSED/);
  });

  it("falls back to the not-tested register when edited with no cached health", async () => {
    mockTestProvider.mockResolvedValue({ ok: true, status: 200, modelCount: 1, sample: ["m1"] });
    const onChange = vi.fn();
    renderCard({}, onChange);
    fireEvent.click(screen.getByTestId("test-provider-button"));
    await waitFor(() => expect(screen.getByTestId("test-pill").getAttribute("data-state")).toBe("ok"));

    // Re-render with the edited baseUrl and no cached health: the live result is
    // cleared and the pill drops back to the neutral not-tested register.
    cleanup();
    render(
      <LlmProviderCard
        provider={{ ...baseProvider, baseUrl: "https://new.example.com/v1" }}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId("test-pill").getAttribute("data-state")).toBe("not-tested");
  });

  it("does not call testProvider when disabled", async () => {
    renderCard({ baseUrl: "" });
    fireEvent.click(screen.getByTestId("test-provider-button"));
    // Give any microtask a chance
    await new Promise((r) => setTimeout(r, 5));
    expect(mockTestProvider).not.toHaveBeenCalled();
  });
});
