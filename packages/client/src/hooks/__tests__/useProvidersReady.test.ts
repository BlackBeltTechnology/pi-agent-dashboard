import { createElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, render, waitFor, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { ProviderAuthSection } from "../../components/settings/ProviderAuthSection.js";
import { useProvidersReady, PROVIDER_AUTH_EVENT } from "../useProvidersReady.js";

/**
 * Build a fetch mock that routes by URL:
 *   - /api/providers          → { success, providers }
 *   - /api/provider-auth/status → array of { authenticated }
 */
function mockFetch(opts: {
  providers?: Record<string, { apiKey?: string }>;
  authStatus?: Array<{ authenticated: boolean }>;
  providersFails?: boolean;
  authStatusFails?: boolean;
}) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/provider-auth/status")) {
      if (opts.authStatusFails) return Promise.reject(new Error("fail"));
      return Promise.resolve({
        ok: true,
        json: async () => opts.authStatus ?? [],
      } as any);
    }
    if (url.includes("/api/providers")) {
      if (opts.providersFails) return Promise.reject(new Error("fail"));
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, providers: opts.providers ?? {} }),
      } as any);
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useProvidersReady", () => {
  it("starts with loading=true, ready=false, count=0", () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as any;
    const { result } = renderHook(() => useProvidersReady());
    expect(result.current.loading).toBe(true);
    expect(result.current.ready).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it("returns ready=true when any /api/providers entry has non-empty apiKey", async () => {
    global.fetch = mockFetch({
      providers: { anthropic: { apiKey: "sk-abc" }, openai: { apiKey: "" } },
      authStatus: [],
    }) as any;
    const { result } = renderHook(() => useProvidersReady());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(true);
    expect(result.current.count).toBe(1);
  });

  it("returns ready=true when /api/provider-auth/status has an authenticated OAuth provider", async () => {
    global.fetch = mockFetch({
      providers: {},
      authStatus: [
        { authenticated: true } as any,
        { authenticated: false } as any,
      ],
    }) as any;
    const { result } = renderHook(() => useProvidersReady());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(true);
    expect(result.current.count).toBe(1);
  });

  it("counts both sources when both have credentials", async () => {
    global.fetch = mockFetch({
      providers: { openai: { apiKey: "sk-xyz" } },
      authStatus: [{ authenticated: true } as any],
    }) as any;
    const { result } = renderHook(() => useProvidersReady());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.count).toBe(2);
    expect(result.current.ready).toBe(true);
  });

  it("returns ready=false when neither source has credentials", async () => {
    global.fetch = mockFetch({
      providers: { anthropic: { apiKey: "" } },
      authStatus: [{ authenticated: false } as any],
    }) as any;
    const { result } = renderHook(() => useProvidersReady());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it("returns ready=false when both endpoints fail", async () => {
    global.fetch = mockFetch({ providersFails: true, authStatusFails: true }) as any;
    const { result } = renderHook(() => useProvidersReady());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(false);
  });

  it("still reports ready when one endpoint fails but the other has creds", async () => {
    global.fetch = mockFetch({
      providersFails: true,
      authStatus: [{ authenticated: true } as any],
    }) as any;
    const { result } = renderHook(() => useProvidersReady());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(true);
  });

  it("refetches on provider-auth-event", async () => {
    let call = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      call++;
      if (url.includes("/api/provider-auth/status")) {
        // first call returns empty, later calls return authenticated
        return Promise.resolve({
          ok: true,
          json: async () => (call <= 2 ? [] : [{ authenticated: true }]),
        } as any);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, providers: {} }),
      } as any);
    }) as any;

    const { result } = renderHook(() => useProvidersReady());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(false);

    act(() => {
      window.dispatchEvent(new CustomEvent(PROVIDER_AUTH_EVENT));
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
  });
});

// ── dispatch-provider-auth-event ─────────────────────────────────────────
// Hook-side proof of change dispatch-provider-auth-event: the event a SAVE
// PATH dispatches (not a manual dispatch, not a focus) drives the refetch.
// test-plan #D5, #E5, #X4.

/** Hook probe rendering the readiness state for in-DOM assertions. */
function ReadyProbe() {
  const state = useProvidersReady();
  return createElement("div", { "data-testid": "providers-ready" }, JSON.stringify(state));
}

function trackAuthEvents() {
  const events: CustomEvent[] = [];
  const onEvent = (e: Event) => events.push(e as CustomEvent);
  window.addEventListener(PROVIDER_AUTH_EVENT, onEvent);
  return { events, stop: () => window.removeEventListener(PROVIDER_AUTH_EVENT, onEvent) };
}

describe("useProvidersReady — provider-auth-event wiring (dispatch-provider-auth-event)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("D5 a real save path converges the hook to ready=true with no focus event", async () => {
    // Server state: unconfigured until the API-key PUT lands, authenticated
    // afterwards — exactly what the component's dispatch must reveal.
    let authConfigured = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      if (url.includes("/api/provider-auth/handlers")) return { ok: true, json: async () => ({ ids: ["openai"] }) } as any;
      if (url.includes("/api/provider-auth/status")) {
        return {
          ok: true,
          json: async () => (authConfigured
            ? [{ id: "openai", name: "OpenAI", flowType: "api_key", authenticated: true }]
            : [{ id: "openai", name: "OpenAI", flowType: "api_key", authenticated: false }]),
        } as any;
      }
      if (url.includes("/api/provider-auth/api-key")) {
        authConfigured = true; // the write landed server-side
        return { ok: true, json: async () => ({ ok: true }) } as any;
      }
      if (url.includes("/api/providers")) return { ok: true, json: async () => ({ success: true, providers: {} }) } as any;
      return { ok: false, json: async () => null } as any;
    }));
    const { events, stop } = trackAuthEvents();
    const focusSpy = vi.fn();
    window.addEventListener("focus", focusSpy);
    const { getByText, getByTestId } = render(createElement("div", null,
      createElement(ProviderAuthSection),
      createElement(ReadyProbe),
    ));
    const probe = () => JSON.parse(getByTestId("providers-ready").textContent!);

    await waitFor(() => expect(probe().loading).toBe(false));
    expect(probe().ready).toBe(false);

    fireEvent.click(await waitFor(() => getByText("Add Key")));
    fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: "sk-wire-1" } });
    fireEvent.click(getByText("Save"));

    await waitFor(() => expect(events).toHaveLength(1));
    await waitFor(() => expect(probe().ready).toBe(true));
    expect(probe().count).toBe(1);
    expect(focusSpy).not.toHaveBeenCalled();
    stop();
    window.removeEventListener("focus", focusSpy);
  });

  it("E5 three dispatches converge to the same state as one", async () => {
    global.fetch = mockFetch({
      providers: {},
      authStatus: [{ authenticated: true } as any],
    }) as any;
    const { result } = renderHook(() => useProvidersReady());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(true);
    expect(result.current.count).toBe(1);

    await act(async () => {
      window.dispatchEvent(new CustomEvent(PROVIDER_AUTH_EVENT));
      window.dispatchEvent(new CustomEvent(PROVIDER_AUTH_EVENT));
      window.dispatchEvent(new CustomEvent(PROVIDER_AUTH_EVENT));
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(true);
    expect(result.current.count).toBe(1);
  });

  it("X4 a rejected providers refetch does not wedge the hook", async () => {
    global.fetch = mockFetch({
      providersFails: true,
      authStatus: [{ authenticated: true } as any],
    }) as any;
    const { result } = renderHook(() => useProvidersReady());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(true);

    await act(async () => {
      window.dispatchEvent(new CustomEvent(PROVIDER_AUTH_EVENT));
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(true);
    expect(result.current.count).toBe(1);
  });
});
