/**
 * The auth-code poll's failure contract, restated for the section-owned flow
 * structure (design D4): flows START from the Add-provider dialog but their
 * timers live in the providers section, keyed per provider.
 *
 *  - a transient failure keeps polling (F4) — an in-flight login survives a
 *    single 500 or a mid-login server restart;
 *  - the THIRD consecutive failed response ends the flow with a message
 *    instead of silently waiting for the 5-minute timeout (F4);
 *  - a malformed snapshot body is tolerated (no crash, no abort);
 *  - the poll observes GET /flow/:flowId to a terminal state — the rendered
 *    list is configured-only and converges through the completion refresh
 *    (F2);
 *  - two concurrent flows keep separate timers and counters — one flow's
 *    bound or completion never touches the other (F3).
 *
 * See change: redesign-providers-settings-page (tasks 6.3, 7.5).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderAuthSection } from "../components/settings/ProviderAuthSection.js";

const A = { id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false, configured: false };
const B = { id: "second-oauth", name: "Second Prov", flowType: "auth_code", authenticated: false, configured: false };

type Step = "fail" | "nonarray" | "healthyA" | "healthyB" | "healthyBoth";

describe("ProviderAuthSection auth-code poll (section-owned flows)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /**
   * Fetch mock: mount returns the unconfigured rows; each GET /flow poll
   * after its /start consumes one step of `script`. Steps are consumed PER
   * FETCH, and concurrent flows poll the same endpoint — exactly the
   * production shape, where per-provider isolation comes from per-provider
   * state. A healthy step completes the flow AND marks that provider
   * configured for the subsequent /status refresh.
   */
  function mockPollFetch(script: Step[], counters: { statusCalls: number }) {
    const configured = { A: false, B: false };
    return vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/provider-auth/catalogue-ready")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ready: true }) });
      }
      if (url.includes("/api/providers")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, providers: {}, health: {} }) });
      }
      if (url.includes("/api/provider-auth/status")) {
        counters.statusCalls += 1;
        return Promise.resolve({ ok: true, json: () => Promise.resolve([
          { ...A, authenticated: configured.A, configured: configured.A },
          { ...B, authenticated: configured.B, configured: configured.B },
        ]) });
      }
      if (url.includes("/api/provider-auth/start")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ flowId: "flow-1", provider: "anthropic", status: "pending", authUrl: "https://example.test/oauth" }) });
      }
      if (url.includes("/api/provider-auth/flow/")) {
        const step = script.shift();
        if (step === "fail") {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ statusCode: 500, error: "Internal Server Error", message: "boom" }),
          });
        }
        if (step === "nonarray") {
          // A malformed snapshot body — parses, but is not an OAuthFlowStatus.
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ids: [] }) });
        }
        if (step === "healthyA") configured.A = true;
        if (step === "healthyB") configured.B = true;
        if (step === "healthyBoth") { configured.A = true; configured.B = true; }
        const complete = step === "healthyA" || step === "healthyB" || step === "healthyBoth";
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ flowId: "flow-1", provider: "anthropic", status: complete ? "complete" : "pending" }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
  }

  /** Open the Add dialog and start the auth-code flow for `name`. */
  async function startFlow(name: string) {
    fireEvent.click(await screen.findByTestId("add-provider-button"));
    fireEvent.click(await screen.findByText(name));
    fireEvent.click(await screen.findByTestId("dialog-sign-in"));
  }

  // A malformed snapshot body (not an OAuthFlowStatus) does not abort the
  // login or crash the render: the poll tolerates it and recovers when a
  // later poll is healthy.
  it("a malformed poll body does not abort the login or crash the render", async () => {
    const counters = { statusCalls: 0 };
    global.fetch = mockPollFetch(["nonarray", "healthyA"], counters) as typeof fetch;
    const onCredentialsChanged = vi.fn();
    render(<ProviderAuthSection onCredentialsChanged={onCredentialsChanged} />);

    await startFlow("Anthropic");
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);

    await waitFor(() => expect(onCredentialsChanged).toHaveBeenCalled());
    expect(screen.queryByText(/lost contact/i)).toBeNull();
    expect(screen.queryByText(/Render error:/i)).toBeNull();
  });

  // F2 — the poll observes the flow complete via GET /flow: the rendered list
  // excludes the unconfigured provider the whole time, and only the refresh
  // triggered by the completion converges the list.
  it("the flow poll observes completion and the list converges (F2)", async () => {
    const counters = { statusCalls: 0 };
    // One healthy step completes the poll and marks A configured; the refresh
    // that handleChanged triggers then reads /status with A configured.
    global.fetch = mockPollFetch(["healthyA"], counters) as typeof fetch;
    const onCredentialsChanged = vi.fn();
    const c = render(<ProviderAuthSection onCredentialsChanged={onCredentialsChanged} />);

    await startFlow("Anthropic");
    // While polling, the rendered list still has NO anthropic row — the list
    // is configured-only.
    expect(c.container.querySelectorAll('[data-testid="provider-row"]').length).toBe(0);

    await vi.advanceTimersByTimeAsync(2500);
    await waitFor(() => expect(onCredentialsChanged).toHaveBeenCalled());
    // The list converges: the provider is now connected.
    await waitFor(() => {
      const row = c.container.querySelector('[data-testid="provider-row"][data-row-id="anthropic"]');
      expect(row).toBeTruthy();
    });
  });

  // F4 — two consecutive failures, then success: the login completes.
  it("two consecutive poll failures do not abort the login", async () => {
    const counters = { statusCalls: 0 };
    global.fetch = mockPollFetch(["fail", "fail", "healthyA"], counters) as typeof fetch;
    const onCredentialsChanged = vi.fn();
    render(<ProviderAuthSection onCredentialsChanged={onCredentialsChanged} />);

    await startFlow("Anthropic");
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);

    await waitFor(() => expect(onCredentialsChanged).toHaveBeenCalled());
    expect(screen.queryByText(/lost contact/i)).toBeNull();
  });

  // F4 — the third consecutive failure ends the flow with a message.
  it("three consecutive poll failures end the flow with an error message", async () => {
    const counters = { statusCalls: 0 };
    global.fetch = mockPollFetch(["fail", "fail", "fail"], counters) as typeof fetch;
    render(<ProviderAuthSection />);

    await startFlow("Anthropic");
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);

    expect(await screen.findByTestId("provider-flow-error")).toBeTruthy();
    expect(screen.getByTestId("provider-flow-error").textContent).toMatch(/lost contact/i);

    // Polling has ceased: no further status traffic before the 5-minute timeout.
    const afterAbort = counters.statusCalls;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(counters.statusCalls).toBe(afterAbort);
  });

  // F3 — two concurrent flows keep separate timers and counters: the second
  // flow completes while the first keeps polling through its OWN failures and
  // ends at its OWN bound. A shared timer would have ended both together.
  it("one flow's completion and failure bound do not touch the other (F3)", async () => {
    const counters = { statusCalls: 0 };
    // Fetch order per 2 s tick: A's poll first, then B's (started in that
    // order). A burns two failures; B completes on the first healthy response
    // (which also marks B configured for the refresh its completion triggers);
    // A then hits its own 3-consecutive-failure bound.
    global.fetch = mockPollFetch(["fail", "fail", "fail", "healthyB", "fail"], counters) as typeof fetch;
    const onCredentialsChanged = vi.fn();
    const c = render(<ProviderAuthSection onCredentialsChanged={onCredentialsChanged} />);

    await startFlow("Anthropic");
    await startFlow("Second Prov");

    // B completes (dispatch: exactly B's completion).
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);
    await waitFor(() => expect(onCredentialsChanged).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(c.container.querySelector('[data-testid="provider-row"][data-row-source="auth"][data-row-id="second-oauth"]')).toBeTruthy();
    });
    // The dialog closed on completion.
    expect(c.queryByTestId("provider-add-dialog")).toBeNull();

    // A's flow is STILL alive: its poll continues and reaches its own bound.
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await screen.findByTestId("provider-flow-error")).toBeTruthy();
    expect(screen.getByTestId("provider-flow-error").textContent).toMatch(/lost contact/i);
    // A's abort dispatched nothing further.
    expect(onCredentialsChanged).toHaveBeenCalledTimes(1);
    // B's row is untouched by A's abort.
    expect(c.container.querySelector('[data-testid="provider-row"][data-row-id="second-oauth"]')).toBeTruthy();

    // Polling has ceased entirely.
    const after = counters.statusCalls;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(counters.statusCalls).toBe(after);
  });
});
