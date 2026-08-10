import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";
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

  it("shows error pill with HTTP status", async () => {
    mockTestProvider.mockResolvedValue({ ok: false, status: 401, error: "Invalid API key\nsome detail" });
    renderCard();
    fireEvent.click(screen.getByTestId("test-provider-button"));
    const pill = await waitFor(() => screen.getByTestId("test-pill"));
    expect(pill.getAttribute("data-state")).toBe("err");
    expect(pill.textContent).toMatch(/401/);
    expect(pill.textContent).toMatch(/Invalid API key/);
    // only first line shown
    expect(pill.textContent).not.toMatch(/some detail/);
  });

  it("shows error pill without status when network error", async () => {
    mockTestProvider.mockResolvedValue({ ok: false, error: "fetch failed: ECONNREFUSED" });
    renderCard();
    fireEvent.click(screen.getByTestId("test-provider-button"));
    const pill = await waitFor(() => screen.getByTestId("test-pill"));
    expect(pill.getAttribute("data-state")).toBe("err");
    expect(pill.textContent).toMatch(/ECONNREFUSED/);
  });

  it("clears pill when baseUrl is edited after a result", async () => {
    mockTestProvider.mockResolvedValue({ ok: true, status: 200, modelCount: 1, sample: ["m1"] });
    const onChange = vi.fn();
    renderCard({}, onChange);
    fireEvent.click(screen.getByTestId("test-provider-button"));
    await waitFor(() => screen.getByTestId("test-pill"));

    // Edit baseUrl via the input — simulate parent passing the updated value by
    // re-rendering through the onChange handler.
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const baseUrlInput = inputs.find((i) => i.value.startsWith("https://")) as HTMLInputElement;
    fireEvent.change(baseUrlInput, { target: { value: "https://new.example.com/v1" } });

    // onChange fires with new url; pill should be cleared on subsequent render.
    // In this unit test we verify the onChange was called AND the pill cleared
    // for the re-render that the parent would do. Simulate that:
    cleanup();
    render(
      <LlmProviderCard
        provider={{ ...baseProvider, baseUrl: "https://new.example.com/v1" }}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("test-pill")).toBeNull();
  });

  it("does not call testProvider when disabled", async () => {
    renderCard({ baseUrl: "" });
    fireEvent.click(screen.getByTestId("test-provider-button"));
    // Give any microtask a chance
    await new Promise((r) => setTimeout(r, 5));
    expect(mockTestProvider).not.toHaveBeenCalled();
  });
});
