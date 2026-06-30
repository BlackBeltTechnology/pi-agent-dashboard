/**
 * Component test for ProviderAuthSection — OAuth handler-gap detection.
 *
 * An OAuth row whose provider id has no matching server handler (e.g. an
 * extension-registered provider) renders its Sign In button disabled with a
 * "not yet supported" tooltip. See change: adopt-pi-071-072-073-features.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { ProviderAuthSection } from "../components/ProviderAuthSection.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockFetch(statuses: any[], handlerIds: string[]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/provider-auth/handlers")) {
      return { ok: true, json: async () => ({ ids: handlerIds }) } as any;
    }
    if (url.includes("/api/provider-auth/status")) {
      return { ok: true, json: async () => statuses } as any;
    }
    return { ok: true, json: async () => ({}) } as any;
  }));
}

describe("ProviderAuthSection — handler-gap detection", () => {
  it("renders an OAuth row with no server handler as disabled-with-tooltip", async () => {
    mockFetch(
      [
        { id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false },
        { id: "custom-llm", name: "Custom LLM", flowType: "auth_code", authenticated: false },
      ],
      ["anthropic"],
    );

    const { getAllByText } = render(<ProviderAuthSection />);

    await waitFor(() => {
      expect(getAllByText("Sign In").length).toBe(2);
    });

    // The disabled state arrives only AFTER /handlers resolves — the row is
    // NOT failed-closed during load. Wait for exactly one disabled button.
    let customBtn: HTMLButtonElement | undefined;
    let anthropicBtn: HTMLButtonElement | undefined;
    await waitFor(() => {
      const signInButtons = getAllByText("Sign In").map((el) => el.closest("button")!);
      customBtn = signInButtons.find((b) => b.disabled);
      anthropicBtn = signInButtons.find((b) => !b.disabled);
      expect(customBtn).toBeTruthy();
      expect(anthropicBtn).toBeTruthy();
    });

    // Tooltip lives on the wrapper span (a disabled button does not fire hover).
    const tooltipHost = customBtn!.closest("[title]") as HTMLElement;
    expect(tooltipHost.getAttribute("title")).toContain("OAuth flow not yet supported in dashboard for Custom LLM");
  });
});
