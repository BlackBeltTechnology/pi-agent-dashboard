/**
 * The auth-code poll's failure contract, restated for the section-owned flow
 * structure (design D4): flows START from the Add-provider dialog but their
 * timers live in the providers section, keyed per provider.
 *
 *  - a transient failure keeps polling (F4) — an in-flight login survives a
 *    single 500 or a mid-login server restart;
 *  - the THIRD consecutive malformed/non-ok response ends the flow with a
 *    message instead of silently waiting for the 5-minute timeout (F4);
 *  - a non-array body never reaches an array method;
 *  - the poll reads the RAW /status array — the rendered list is
 *    configured-only, so a provider *becoming* configured is observable only
 *    there (F2);
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
   * Fetch mock: mount returns the unconfigured rows; each /status poll after
   * its authorize consumes one step of `script`. Steps are consumed PER FETCH,
   * and concurrent flows poll the same endpoint — exactly the production
   * shape, where per-provider isolation comes from per-provider state.
   */
  function mockPollFetch(script: Step[], counters: { statusCalls: number }) {
    let flowStarted = false;
    return vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/provider-auth/catalogue-ready")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ready: true }) });
      }
      if (url.includes("/api/providers")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, providers: {}, health: {} }) });
      }
      if (url.includes("/api/provider-auth/status")) {
        counters.statusCalls += 1;
        if (!flowStarted) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([A, B]) });
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
        const rows: Record<string, any[]> = {
          healthyA: [{ ...A, authenticated: true, configured: true, source: "stored" }, B],
          healthyB: [A, { ...B, authenticated: true, configured: true, source: "stored" }],
          healthyBoth: [{ ...A, authenticated: true, configured: true }, { ...B, authenticated: true, configured: true }],
        };
        return Promise.resolve({ ok: true, json: () => Promise.resolve(rows[step as string] ?? [A, B]) });
      }
      if (url.includes("/api/provider-auth/authorize")) {
        flowStarted = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ authUrl: "https://example.test/oauth" }) });
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

  // A malformed (non-array) poll body is a counted transient failure: the
  // login recovers when a later poll is healthy, and no TypeError reaches the
  // render (the poll never calls an array method on the body).
  it("a malformed non-array poll body does not abort the login or crash the render", async () => {
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

  // F2 — the poll reads the RAW status array: the rendered list excludes the
  // unconfigured provider the whole time, yet the flow completes when the raw
  // array shows it configured.
  it("the poll observes the provider become configured in the raw status array (F2)", async () => {
    const counters = { statusCalls: 0 };
    // Two healthy steps: one completes the poll, one feeds the refresh that
    // handleChanged triggers on completion.
    global.fetch = mockPollFetch(["healthyA", "healthyA"], counters) as typeof fetch;
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
    // order). B completes on the first healthy response; A keeps polling and
    // hits its own 3-consecutive-failure bound afterwards. The third
    // "healthyB" feeds the refresh that B's completion triggers, and shows
    // only B configured — A stays unlisted.
    global.fetch = mockPollFetch(["fail", "fail", "healthyB", "healthyB", "healthyB", "fail", "fail", "fail"], counters) as typeof fetch;
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
