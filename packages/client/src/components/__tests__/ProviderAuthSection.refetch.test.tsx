/**
 * The catalogue-refetch notification contract of ProviderAuthSection.
 *
 * OAuth / device-code completions land server-side and change the model
 * catalogue exactly as an API-key save does; omitting them leaves a
 * freshly-authorized provider invisible in the Default Model picker. Flows
 * start from the Add-provider dialog and are polled by the SECTION (design
 * D4). See change: settings-default-model-without-session,
 * redesign-providers-settings-page (task 6.3).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderAuthSection } from "../settings/ProviderAuthSection.js";

const OAUTH_PROVIDER = { id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false, configured: false };

describe("ProviderAuthSection credential-change notification", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("notifies the owner when an OAuth authorization completes (test-plan #X8)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let authenticated = false;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/provider-auth/status")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ ...OAUTH_PROVIDER, authenticated, configured: authenticated }]) });
      }
      if (url.includes("/api/providers")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, providers: {}, health: {} }) });
      }
      if (url.includes("/api/provider-auth/catalogue-ready")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ready: true }) });
      }
      if (url.includes("/api/provider-auth/authorize")) {
        authenticated = true; // the server-side flow completes
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ authUrl: "https://example.test/oauth" }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });

    const onCredentialsChanged = vi.fn();
    render(<ProviderAuthSection onCredentialsChanged={onCredentialsChanged} />);

    // The flow starts from the Add-provider dialog.
    fireEvent.click(await screen.findByTestId("add-provider-button"));
    fireEvent.click(await screen.findByText("Anthropic"));
    expect(onCredentialsChanged).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId("dialog-sign-in"));

    // The section polls /status until the provider reports configured.
    await vi.advanceTimersByTimeAsync(2500);
    await waitFor(() => expect(onCredentialsChanged).toHaveBeenCalled());
  });

  it("does not treat the initial mount as a credential change", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/provider-auth/status")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([OAUTH_PROVIDER]) });
      }
      if (url.includes("/api/providers")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, providers: {}, health: {} }) });
      }
      if (url.includes("/api/provider-auth/catalogue-ready")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ready: true }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
    const onCredentialsChanged = vi.fn();
    render(<ProviderAuthSection onCredentialsChanged={onCredentialsChanged} />);
    await screen.findByTestId("add-provider-button");
    expect(onCredentialsChanged).not.toHaveBeenCalled();
  });
});
