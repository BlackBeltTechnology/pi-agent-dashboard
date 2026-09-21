/**
 * The section-level failure contract of ProviderAuthSection: a failed or
 * malformed status response renders an INLINE error and keeps the section
 * mounted and interactive — it must not throw into the ErrorBoundary and it
 * must be recoverable via a user-triggered refresh. The list merges TWO
 * independent sources, so each source renders its own error and a failure of
 * one never hides the rows contributed by the other (X7, X8, X9).
 *
 * See changes: fix-corrupt-auth-json-500, redesign-providers-settings-page.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ProviderAuthSection } from "../components/settings/ProviderAuthSection.js";

const CONFIGURED_ROW = {
  id: "openai",
  name: "OpenAI",
  flowType: "api_key",
  authenticated: true,
  configured: true,
  maskedKey: "sk-…9f2",
  source: "stored",
};
const CUSTOM_ENTRY = {
  "local-vllm": { baseUrl: "http://10.0.0.4:8000/v1", apiKey: "***", api: "openai-completions" },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface Script {
  statusMode?: "ok" | "500" | "nonarray" | "reject";
  providersMode?: "ok" | "500" | "reject";
  statuses?: any[];
  providers?: Record<string, any>;
  statusCalls: number;
}

function stubFetch(script: Script) {
  return vi.fn(async (url: string) => {
    if (url.includes("/api/provider-auth/status")) {
      script.statusCalls++;
      if (script.statusMode === "500") {
        return { ok: false, status: 500, json: async () => ({ statusCode: 500, error: "Internal Server Error", message: "Unexpected end of JSON input" }) } as any;
      }
      if (script.statusMode === "nonarray") {
        return { ok: true, status: 200, json: async () => ({ ids: [] }) } as any;
      }
      if (script.statusMode === "reject") throw new TypeError("simulated network failure");
      return { ok: true, status: 200, json: async () => script.statuses ?? [] } as any;
    }
    if (url.includes("/api/providers")) {
      if (script.providersMode === "500") {
        return { ok: false, status: 500, json: async () => ({ statusCode: 500, error: "Internal Server Error" }) } as any;
      }
      if (script.providersMode === "reject") throw new TypeError("simulated network failure");
      return { ok: true, status: 200, json: async () => ({ success: true, providers: script.providers ?? {}, health: {} }) } as any;
    }
    if (url.includes("/api/provider-auth/catalogue-ready")) {
      return { ok: true, status: 200, json: async () => ({ ready: true }) } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  });
}

describe("ProviderAuthSection — degraded status responses", () => {
  // X7 — a 500 (Fastify error envelope) must degrade, not white-screen, and
  // must NOT hide the custom-endpoint rows contributed by the other source.
  it("a 500 status renders an inline error and keeps custom-endpoint rows", async () => {
    const script: Script = { statusCalls: 0, statusMode: "500", providers: CUSTOM_ENTRY };
    vi.stubGlobal("fetch", stubFetch(script));

    const { getByTestId, queryByText, container } = render(<ProviderAuthSection />);

    await waitFor(() => {
      expect(getByTestId("provider-auth-status-error")).toBeTruthy();
    });
    // The credential-status source failed, but the custom-endpoint source is
    // intact: its row still renders with its actions.
    expect(container.querySelector('[data-testid="provider-row"][data-row-source="custom"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="provider-row"] button')).toBeTruthy();
    // The section itself is still mounted (not replaced by the ErrorBoundary).
    expect(getByTestId("add-provider-button")).toBeTruthy();
    expect(queryByText(/Render error:/i)).toBeNull();
  });

  // X9 — a 200 body that is not an array must not reach an array method.
  it("a non-array 200 body renders an inline error without a TypeError", async () => {
    const script: Script = { statusCalls: 0, statusMode: "nonarray" };
    vi.stubGlobal("fetch", stubFetch(script));

    const { getByTestId, queryByText } = render(<ProviderAuthSection />);

    await waitFor(() => {
      expect(getByTestId("provider-auth-status-error")).toBeTruthy();
    });
    expect(queryByText(/Render error:/i)).toBeNull();
  });

  // A rejected fetch (network failure) must degrade the same way as a 500.
  it("a network failure renders an inline error and keeps the section mounted", async () => {
    const script: Script = { statusCalls: 0, statusMode: "reject" };
    vi.stubGlobal("fetch", stubFetch(script));

    const { getByTestId, queryByText } = render(<ProviderAuthSection />);

    await waitFor(() => {
      expect(getByTestId("provider-auth-status-error")).toBeTruthy();
    });
    expect(getByTestId("add-provider-button")).toBeTruthy();
    expect(queryByText(/Render error:/i)).toBeNull();
  });

  // X8 — the inverse per-source degradation: a failed /api/providers read
  // leaves the credential rows rendered with their own actions, and the error
  // is scoped to the custom-endpoint source.
  it("a failed providers fetch does not hide credential rows (X8)", async () => {
    const script: Script = { statusCalls: 0, providersMode: "500", statuses: [CONFIGURED_ROW] };
    vi.stubGlobal("fetch", stubFetch(script));

    const { getByTestId, getByText, container } = render(<ProviderAuthSection />);

    await waitFor(() => {
      expect(getByTestId("providers-list-error")).toBeTruthy();
    });
    expect(container.querySelector('[data-testid="provider-row"][data-row-source="auth"][data-row-id="openai"]')).toBeTruthy();
    // The api-key row keeps its own actions (Edit / Remove).
    expect(getByText("Remove")).toBeTruthy();
    expect(container.querySelector('[data-testid="provider-auth-status-error"]')).toBeNull();
  });

  // Retry — the error state clears when a user-triggered refresh succeeds.
  it("retry after a failure replaces the inline error with the provider rows", async () => {
    let statusCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/provider-auth/status")) {
        statusCalls += 1;
        if (statusCalls === 1) {
          return { ok: false, status: 500, json: async () => ({ message: "boom" }) } as any;
        }
        return { ok: true, status: 200, json: async () => [CONFIGURED_ROW] } as any;
      }
      if (url.includes("/api/providers")) {
        return { ok: true, status: 200, json: async () => ({ success: true, providers: {}, health: {} }) } as any;
      }
      if (url.includes("/api/provider-auth/catalogue-ready")) {
        return { ok: true, status: 200, json: async () => ({ ready: true }) } as any;
      }
      return { ok: true, status: 200, json: async () => ({}) } as any;
    }));

    const { getByTestId, findByRole, queryByTestId, container } = render(<ProviderAuthSection />);

    await waitFor(() => {
      expect(getByTestId("provider-auth-status-error")).toBeTruthy();
    });

    fireEvent.click(await findByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(queryByTestId("provider-auth-status-error")).toBeNull();
    });
    expect(container.querySelector('[data-testid="provider-row"][data-row-id="openai"]')).toBeTruthy();
  });
});
