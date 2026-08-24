/**
 * The catalogue-refetch notification contract of ProviderAuthSection.
 *
 * OAuth / device-code completions land server-side and change the model
 * catalogue exactly as an API-key save does; omitting them leaves a
 * freshly-authorized provider invisible in the Default Model picker.
 * See change: settings-default-model-without-session.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderAuthSection } from "../settings/ProviderAuthSection.js";

const OAUTH_PROVIDER = { id: "anthropic", name: "Anthropic", flowType: "oauth", authenticated: false };

describe("ProviderAuthSection credential-change notification", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("notifies the owner when an OAuth authorization completes (test-plan #X8)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let authenticated = false;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/provider-auth/status") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ ...OAUTH_PROVIDER, authenticated }]) });
      }
      if (url === "/api/provider-auth/handlers") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ids: ["anthropic"] }) });
      }
      if (url === "/api/provider-auth/authorize") {
        authenticated = true; // the server-side flow completes
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ started: true }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });

    const onCredentialsChanged = vi.fn();
    render(<ProviderAuthSection onCredentialsChanged={onCredentialsChanged} />);

    const signIn = await screen.findByRole("button", { name: /Sign in/i });
    expect(onCredentialsChanged).not.toHaveBeenCalled();

    fireEvent.click(signIn);
    // The row polls /status until the provider reports authenticated.
    await vi.advanceTimersByTimeAsync(2500);
    await waitFor(() => expect(onCredentialsChanged).toHaveBeenCalled());
  });

  it("does not treat the initial mount as a credential change", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/provider-auth/status") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([OAUTH_PROVIDER]) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
    const onCredentialsChanged = vi.fn();
    render(<ProviderAuthSection onCredentialsChanged={onCredentialsChanged} />);
    await screen.findByRole("button", { name: /Sign in/i });
    expect(onCredentialsChanged).not.toHaveBeenCalled();
  });
});
