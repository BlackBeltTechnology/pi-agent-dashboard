/**
 * The auth-code poll's consecutive-failure budget (test-plan F3, F4): a
 * transient failure keeps polling (an in-flight login survives a single 500
 * or a mid-login server restart), the THIRD consecutive malformed/non-ok
 * response ends the flow with a message instead of silently waiting for the
 * 5-minute timeout, and a non-array body never reaches an array method.
 *
 * See change: fix-corrupt-auth-json-500.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderAuthSection } from "../components/settings/ProviderAuthSection.js";

const OAUTH_PROVIDER = { id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false };

describe("ProviderAuthSection auth-code poll failure budget", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /** Fetch mock: mount returns the normal array; after authorize, polls consume `script`. */
  function mockPollFetch(script: Array<"fail" | "ok" | "nonarray">, pollStatusCalls: { n: number }) {
    let flowStarted = false;
    return vi.fn().mockImplementation((url: string) => {
      if (url === "/api/provider-auth/handlers") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ids: ["anthropic"] }) });
      }
      if (url === "/api/provider-auth/status") {
        pollStatusCalls.n += 1;
        if (!flowStarted) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([OAUTH_PROVIDER]) });
        }
        const step = script.shift();
        if (step === "fail") {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ statusCode: 500, error: "Internal Server Error", message: "boom" }),
          });
        }
        if (step === "nonarray") {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ids: [] }) });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ ...OAUTH_PROVIDER, authenticated: true }]),
        });
      }
      if (url === "/api/provider-auth/authorize") {
        flowStarted = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ started: true }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
  }

  async function clickSignIn() {
    const signIn = await screen.findByRole("button", { name: /sign in/i });
    fireEvent.click(signIn);
  }

  // A malformed (non-array) poll body is a counted transient failure: the
  // login recovers when a later poll is healthy, and no TypeError reaches the
  // render (the poll never calls an array method on the body).
  it("a malformed non-array poll body does not abort the login or crash the render", async () => {
    global.fetch = mockPollFetch(["nonarray", "ok"], { n: 0 }) as typeof fetch;
    const onCredentialsChanged = vi.fn();
    render(<ProviderAuthSection onCredentialsChanged={onCredentialsChanged} />);

    await clickSignIn();
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);

    await waitFor(() => expect(onCredentialsChanged).toHaveBeenCalled());
    expect(screen.queryByText(/lost contact/i)).toBeNull();
    expect(screen.queryByText(/Render error:/i)).toBeNull();
  });

  // #F3 — two consecutive failures, then success: the login completes.
  it("two consecutive poll failures do not abort the login", async () => {
    global.fetch = mockPollFetch(["fail", "fail", "ok"], { n: 0 }) as typeof fetch;
    const onCredentialsChanged = vi.fn();
    render(<ProviderAuthSection onCredentialsChanged={onCredentialsChanged} />);

    await clickSignIn();
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);

    await waitFor(() => expect(onCredentialsChanged).toHaveBeenCalled());
    expect(screen.queryByText(/lost contact/i)).toBeNull();
  });

  // #F4 — the third consecutive failure ends the flow with a message.
  it("three consecutive poll failures end the flow with an error message", async () => {
    const pollStatusCalls = { n: 0 };
    global.fetch = mockPollFetch(["fail", "fail", "fail"], pollStatusCalls) as typeof fetch;
    render(<ProviderAuthSection />);

    await clickSignIn();
    // Mount fetch (pre-flow) already counted; note the count right before polls run.
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);

    expect(await screen.findByText(/lost contact/i)).toBeTruthy();

    // Polling has ceased: no further status traffic before the 5-minute timeout.
    const afterAbort = pollStatusCalls.n;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pollStatusCalls.n).toBe(afterAbort);
  });
});
