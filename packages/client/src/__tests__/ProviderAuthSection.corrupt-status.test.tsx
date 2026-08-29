/**
 * The section-level failure contract of ProviderAuthSection: a failed or
 * malformed status response renders an INLINE error and keeps the section
 * mounted and interactive — it must not throw into the ErrorBoundary and it
 * must be recoverable via a user-triggered refresh (test-plan F1, F2, F5).
 *
 * See change: fix-corrupt-auth-json-500.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ProviderAuthSection } from "../components/settings/ProviderAuthSection.js";

const NORMAL_STATUSES = [
  { id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockHandlersOk() {
  return async (url: string) => {
    if (url.includes("/api/provider-auth/handlers")) {
      return { ok: true, json: async () => ({ ids: ["anthropic"] }) } as any;
    }
    return { ok: true, json: async () => ({}) } as any;
  };
}

describe("ProviderAuthSection — degraded status responses", () => {
// #F1 — a 500 (Fastify error envelope) must degrade, not white-screen.
it("a 500 status renders an inline error and keeps the section mounted", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/provider-auth/status")) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ statusCode: 500, error: "Internal Server Error", message: "Unexpected end of JSON input" }),
      } as any;
    }
    return mockHandlersOk()(url);
  }));

  const { getByTestId, getByText, queryByText } = render(<ProviderAuthSection />);

  await waitFor(() => {
    expect(getByTestId("provider-auth-status-error")).toBeTruthy();
  });
  // The section itself is still mounted (not replaced by the ErrorBoundary).
  expect(getByText(/Subscriptions \(OAuth\)/i)).toBeTruthy();
  expect(queryByText(/Render error:/i)).toBeNull();
});

// #F2 — a 200 body that is not an array must not reach an array method.
it("a non-array 200 body renders an inline error without a TypeError", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/provider-auth/status")) {
      return { ok: true, status: 200, json: async () => ({ ids: [] }) } as any;
    }
    return mockHandlersOk()(url);
  }));

  const { getByTestId, queryByText } = render(<ProviderAuthSection />);

  await waitFor(() => {
    expect(getByTestId("provider-auth-status-error")).toBeTruthy();
  });
  expect(queryByText(/Render error:/i)).toBeNull();
});

// #F5 — the error state clears when a user-triggered refresh succeeds.
it("retry after a failure replaces the inline error with the provider rows", async () => {
  let statusCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/provider-auth/status")) {
      statusCalls += 1;
      if (statusCalls === 1) {
        return { ok: false, status: 500, json: async () => ({ message: "boom" }) } as any;
      }
      return { ok: true, status: 200, json: async () => NORMAL_STATUSES } as any;
    }
    return mockHandlersOk()(url);
  }));

  const { getByTestId, getByRole, queryByTestId, findByRole } = render(<ProviderAuthSection />);

  await waitFor(() => {
    expect(getByTestId("provider-auth-status-error")).toBeTruthy();
  });

  fireEvent.click(await findByRole("button", { name: /retry/i }));

  await waitFor(() => {
    expect(queryByTestId("provider-auth-status-error")).toBeNull();
  });
  expect(getByRole("button", { name: /sign in/i })).toBeTruthy();
});
});
