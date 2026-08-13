/**
 * LlmProviderCard health pill: renders the four registers from cached health
 * (connected+count / status / unreachable / not-tested) plus the verbatim
 * error line, and updates live from a Test response.
 * See change: surface-provider-health-in-settings.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  isNew: false,
};

function renderCard(props: { health?: any; overrides?: Partial<typeof baseProvider> } = {}) {
  const provider = { ...baseProvider, ...(props.overrides ?? {}) };
  return render(
    <LlmProviderCard
      provider={provider}
      health={props.health}
      onChange={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
}

describe("LlmProviderCard cached-health pill", () => {
  it("connected register: green pill with model count, no error line", () => {
    renderCard({ health: { ok: true, status: 200, modelCount: 142, testedAt: 1 } });
    const pill = screen.getByTestId("test-pill");
    expect(pill.getAttribute("data-state")).toBe("ok");
    expect(pill.textContent).toMatch(/142 models/);
    expect(screen.queryByTestId("provider-error-line")).toBeNull();
  });

  it("error register: yellow pill with the status code + verbatim error line", () => {
    renderCard({ health: { ok: false, status: 401, error: "invalid x-api-key", testedAt: 1 } });
    const pill = screen.getByTestId("test-pill");
    expect(pill.getAttribute("data-state")).toBe("error");
    expect(pill.textContent).toMatch(/401/);
    const errLine = screen.getByTestId("provider-error-line");
    expect(errLine.textContent).toBe("invalid x-api-key");
  });

  it("unreachable register: red pill + verbatim error line when no status", () => {
    renderCard({ health: { ok: false, error: "getaddrinfo ENOTFOUND api.example.com", testedAt: 1 } });
    const pill = screen.getByTestId("test-pill");
    expect(pill.getAttribute("data-state")).toBe("unreachable");
    expect(pill.textContent).toMatch(/Unreachable/i);
    expect(screen.getByTestId("provider-error-line").textContent).toBe("getaddrinfo ENOTFOUND api.example.com");
  });

  it("not-tested register: neutral pill, no error line, when no cached health", () => {
    renderCard({ health: undefined });
    const pill = screen.getByTestId("test-pill");
    expect(pill.getAttribute("data-state")).toBe("not-tested");
    expect(screen.queryByTestId("provider-error-line")).toBeNull();
  });

  it("verbatim error line preserves the full multi-line error string", () => {
    renderCard({ health: { ok: false, status: 500, error: "line one\nline two", testedAt: 1 } });
    expect(screen.getByTestId("provider-error-line").textContent).toBe("line one\nline two");
  });

  it("a stale failed-Test result is cleared when the config changes externally (Discard)", async () => {
    mockTestProvider.mockResolvedValue({ ok: false, status: 401, error: "bad key" });
    const health = { ok: true, status: 200, modelCount: 5, testedAt: 1 };
    const { rerender } = renderCard({ health });
    // Test fails → error pill masks the cached-green health.
    fireEvent.click(screen.getByTestId("test-provider-button"));
    await waitFor(() => expect(screen.getByTestId("test-pill").getAttribute("data-state")).toBe("error"));
    // External restore (Discard) changes the provider config prop → the stale
    // test result is dropped and the pill falls back to cached health.
    rerender(
      <LlmProviderCard
        provider={{ ...baseProvider, apiKey: "sk-restored" }}
        health={health}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("test-pill").getAttribute("data-state")).toBe("ok"));
    expect(screen.queryByTestId("provider-error-line")).toBeNull();
  });

  it("Test response updates the pill + error line live over cached health", async () => {
    mockTestProvider.mockResolvedValue({ ok: false, status: 403, error: "forbidden now" });
    renderCard({ health: { ok: true, status: 200, modelCount: 5, testedAt: 1 } });
    // starts connected from cached health
    expect(screen.getByTestId("test-pill").getAttribute("data-state")).toBe("ok");

    fireEvent.click(screen.getByTestId("test-provider-button"));
    await waitFor(() => expect(screen.getByTestId("test-pill").getAttribute("data-state")).toBe("error"));
    expect(screen.getByTestId("test-pill").textContent).toMatch(/403/);
    expect(screen.getByTestId("provider-error-line").textContent).toBe("forbidden now");
  });
});
