import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderAuthSection } from "../../components/settings/ProviderAuthSection.js";
import { ANTHROPIC_PEER_SOURCE } from "../../lib/package/anthropic-peer.js";
import { packageQueue } from "../../lib/package/package-queue.js";
import { peerAutoInstallStore, usePeerAutoInstallReset } from "../../lib/package/peer-auto-install-store.js";
import { PROVIDER_AUTH_EVENT, useProvidersReady } from "../useProvidersReady.js";

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
    // afterwards — exactly what the component's dispatch must reveal. The
    // save path is the Add-provider dialog (key entry lives there now).
    let authConfigured = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      if (url.includes("/api/provider-auth/status")) {
        return {
          ok: true,
          json: async () => (authConfigured
            ? [{ id: "openai", name: "OpenAI", flowType: "api_key", authenticated: true, configured: true }]
            : [{ id: "openai", name: "OpenAI", flowType: "api_key", authenticated: false, configured: false }]),
        } as any;
      }
      if (url.includes("/api/provider-auth/catalogue-ready")) return { ok: true, json: async () => ({ ready: true }) } as any;
      if (url.includes("/api/provider-auth/api-key")) {
        authConfigured = true; // the write landed server-side
        return { ok: true, json: async () => ({ ok: true }) } as any;
      }
      if (url.includes("/api/providers")) return { ok: true, json: async () => ({ success: true, providers: {}, health: {} }) } as any;
      return { ok: false, json: async () => null } as any;
    }));
    const { events, stop } = trackAuthEvents();
    const focusSpy = vi.fn();
    window.addEventListener("focus", focusSpy);
    const { getByText, getByTestId, findByTestId } = render(createElement("div", null,
      createElement(ProviderAuthSection),
      createElement(ReadyProbe),
    ));
    const probe = () => JSON.parse(getByTestId("providers-ready").textContent!);

    await waitFor(() => expect(probe().loading).toBe(false));
    expect(probe().ready).toBe(false);

    // Open the Add-provider dialog, pick the provider, submit a key.
    fireEvent.click(await findByTestId("add-provider-button"));
    fireEvent.click(await waitFor(() => getByText("OpenAI")));
    fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: "sk-wire-1" } });
    fireEvent.click(getByTestId("dialog-submit"));

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

// See change: streamline-first-run (test-plan F4, design D3).
describe("anthropicAuthenticated tri-state + peer auto-install reset", () => {
  /** Routes status / health / recommended / install; the test controls anthropic state + status HTTP code. */
  function authFetch(ctl: { status: number; anthropic: boolean }) {
    return vi.fn().mockImplementation((url: string, init?: any) => {
      if (url.includes("/api/provider-auth/status")) {
        if (ctl.status !== 200) return Promise.resolve({ ok: false, status: ctl.status, json: async () => ({}) } as any);
        return Promise.resolve({ ok: true, json: async () => [{ id: "anthropic", authenticated: ctl.anthropic }] } as any);
      }
      if (url.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ plugins: [] }) } as any);
      if (url.includes("/api/packages/recommended")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { recommended: [{ id: "pi-anthropic-messages", activeInPi: false }] } }),
        } as any);
      }
      if (url.includes("/api/packages/install") && init?.method === "POST") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: { operationId: "op-1" } }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, providers: {} }) } as any);
    });
  }

  const completeInstall = (success: boolean) =>
    window.dispatchEvent(
      new CustomEvent("pi-package-event", {
        detail: { type: "package_operation_complete", operationId: "op-1", action: "install", source: ANTHROPIC_PEER_SOURCE, success },
      }),
    );

  beforeEach(() => {
    packageQueue.__resetForTests();
    peerAutoInstallStore.__resetForTests();
  });

  afterEach(() => {
    packageQueue.__resetForTests();
    peerAutoInstallStore.__resetForTests();
  });

  it("is true/false on a successful read and null (unknown) on a failed one", async () => {
    const ctl = { status: 200, anthropic: true };
    global.fetch = authFetch(ctl) as any;
    const { result } = renderHook(() => useProvidersReady());
    await waitFor(() => expect(result.current.anthropicAuthenticated).toBe(true));
    ctl.status = 500;
    act(() => { window.dispatchEvent(new Event(PROVIDER_AUTH_EVENT)); });
    await waitFor(() => expect(result.current.anthropicAuthenticated).toBeNull());
    ctl.status = 200;
    ctl.anthropic = false;
    act(() => { window.dispatchEvent(new Event(PROVIDER_AUTH_EVENT)); });
    await waitFor(() => expect(result.current.anthropicAuthenticated).toBe(false));
  });

  it("F4: resets only on true → false between successful reads; a late success is ignored", async () => {
    const ctl = { status: 200, anthropic: true };
    global.fetch = authFetch(ctl) as any;
    const { result } = renderHook(() => {
      const ready = useProvidersReady();
      usePeerAutoInstallReset(ready.anthropicAuthenticated);
      return ready;
    });
    await waitFor(() => expect(result.current.anthropicAuthenticated).toBe(true));

    await act(async () => { await peerAutoInstallStore.ensureInstall("sign-in"); });
    await waitFor(() => expect(peerAutoInstallStore.getSnapshot().outcome).toBe("running"));

    // true → unknown → true: unchanged.
    ctl.status = 500;
    act(() => { window.dispatchEvent(new Event(PROVIDER_AUTH_EVENT)); });
    await waitFor(() => expect(result.current.anthropicAuthenticated).toBeNull());
    expect(peerAutoInstallStore.getSnapshot().outcome).toBe("running");
    ctl.status = 200;
    act(() => { window.dispatchEvent(new Event(PROVIDER_AUTH_EVENT)); });
    await waitFor(() => expect(result.current.anthropicAuthenticated).toBe(true));
    expect(peerAutoInstallStore.getSnapshot().outcome).toBe("running");

    // true → false: reset; the late success must not resurrect it.
    ctl.anthropic = false;
    act(() => { window.dispatchEvent(new Event(PROVIDER_AUTH_EVENT)); });
    await waitFor(() => expect(result.current.anthropicAuthenticated).toBe(false));
    await waitFor(() => expect(peerAutoInstallStore.getSnapshot().outcome).toBeNull());
    act(() => completeInstall(true));
    expect(peerAutoInstallStore.getSnapshot().outcome).toBeNull();
  });
});
