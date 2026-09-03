/**
 * Component test for ProviderAuthSection — OAuth handler-gap detection.
 *
 * An OAuth row whose provider id has no matching server handler (e.g. an
 * extension-registered provider) renders its Sign In button disabled with a
 * "not yet supported" tooltip. See change: adopt-pi-071-072-073-features.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ProviderAuthSection } from "../components/settings/ProviderAuthSection.js";
import { PROVIDER_AUTH_EVENT, useProvidersReady } from "../hooks/useProvidersReady.js";

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

// ── dispatch-provider-auth-event ─────────────────────────────────────────────
// A successful credential write dispatches `provider-auth-event` on `window`
// so `useProvidersReady()` refetches without a window focus. The dispatch
// lives in the single `handleChanged` funnel — never in `refresh`, which also
// runs on mount. test-plan #D1–#D6, #E1–#E2, #X1, #X3, #R1 of change
// dispatch-provider-auth-event.

/** Hook probe rendering the readiness state for in-DOM assertions. */
function ReadyProbe() {
  const state = useProvidersReady();
  return <div data-testid="providers-ready">{JSON.stringify(state)}</div>;
}

interface DispatchCtl {
  statuses: any[];
  handlerIds: string[];
  llmProviders: Record<string, any>;
  apiKeyPut?: () => Promise<any>;
  authorizePost?: () => Promise<any>;
  deviceStatusGet?: () => Promise<any>;
  providerDelete?: () => Promise<any>;
  statusGets: number;
}
let dc: DispatchCtl;

function stubDispatchFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
    if (url.includes("/api/provider-auth/handlers")) return { ok: true, json: async () => ({ ids: dc.handlerIds }) } as any;
    if (url.includes("/api/provider-auth/status")) {
      dc.statusGets++;
      return { ok: true, json: async () => dc.statuses } as any;
    }
    if (url.includes("/api/provider-auth/api-key")) return dc.apiKeyPut ? await dc.apiKeyPut() : { ok: true, json: async () => ({ ok: true }) } as any;
    if (url.includes("/api/provider-auth/authorize")) return dc.authorizePost ? await dc.authorizePost() : { ok: true, json: async () => ({}) } as any;
    if (url.includes("/api/provider-auth/device-status/")) return dc.deviceStatusGet ? await dc.deviceStatusGet() : { ok: true, json: async () => ({ status: "pending" }) } as any;
    if (/\/api\/provider-auth\/[^/]+$/.test(url) && init?.method === "DELETE") return dc.providerDelete ? await dc.providerDelete() : { ok: true, json: async () => ({ ok: true }) } as any;
    if (url.includes("/api/providers")) return { ok: true, json: async () => ({ success: true, providers: dc.llmProviders, health: {} }) } as any;
    return { ok: true, json: async () => ({}) } as any;
  }));
}

function trackEvents() {
  const events: CustomEvent[] = [];
  const onEvent = (e: Event) => events.push(e as CustomEvent);
  window.addEventListener(PROVIDER_AUTH_EVENT, onEvent);
  return { events, stop: () => window.removeEventListener(PROVIDER_AUTH_EVENT, onEvent) };
}

/** Mount the section, walk the API-key save to a single Save submission. */
async function saveApiKey(c: { findByText: (t: string) => Promise<HTMLElement>; getByText: (t: string) => HTMLElement }) {
  fireEvent.click(await c.findByText("Add Key"));
  fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: "sk-test-123" } });
  fireEvent.click(c.getByText("Save"));
}

describe("ProviderAuthSection — credential writes dispatch provider-auth-event", () => {
  beforeEach(() => {
    dc = { statuses: [], handlerIds: ["openai", "anthropic", "device-prov"], llmProviders: {}, statusGets: 0 };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("D1 dispatches exactly one event on an API-key save", async () => {
    dc.statuses = [{ id: "openai", name: "OpenAI", flowType: "api_key", authenticated: false }];
    stubDispatchFetch();
    const { events, stop } = trackEvents();
    const c = render(<ProviderAuthSection />);
    await saveApiKey(c);
    await waitFor(() => expect(events).toHaveLength(1));
    stop();
  });

  it("D2 dispatches one event when the auth-code poll observes completion", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    dc.statuses = [{ id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false }];
    // The server-side callback write lands between POST /authorize and the
    // next status poll — the poll is what OBSERVES the completion.
    dc.authorizePost = async () => {
      dc.statuses = [{ id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: true }];
      return { ok: true, json: async () => ({}) } as any;
    };
    stubDispatchFetch();
    const { events, stop } = trackEvents();
    const c = render(<ProviderAuthSection />);
    fireEvent.click(await c.findByText("Sign In"));
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    await waitFor(() => expect(events).toHaveLength(1));
    expect(c.getByText("Connected")).toBeTruthy();
    stop();
  });

  it("D3 dispatches one event when the device-code poll observes completion", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    dc.statuses = [{ id: "device-prov", name: "Device Prov", flowType: "device_code", authenticated: false }];
    dc.deviceStatusGet = async () => ({ ok: true, json: async () => ({ status: "complete" }) }) as any;
    stubDispatchFetch();
    const { events, stop } = trackEvents();
    const c = render(<ProviderAuthSection />);
    fireEvent.click(await c.findByText("Sign In"));
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    await waitFor(() => expect(events).toHaveLength(1));
    stop();
  });

  it("D6 the event carries no credential material", async () => {
    dc.statuses = [{ id: "openai", name: "OpenAI", flowType: "api_key", authenticated: false }];
    stubDispatchFetch();
    const { events, stop } = trackEvents();
    const c = render(<ProviderAuthSection />);
    await saveApiKey(c);
    await waitFor(() => expect(events).toHaveLength(1));
    const ev = events[0];
    expect(ev.type).toBe("provider-auth-event");
    expect(ev.detail ?? null).toBeNull();
    expect(JSON.stringify(ev)).not.toContain("sk-test-123");
    expect(JSON.stringify(ev)).not.toContain("openai");
    stop();
  });

  it("E1 dispatches on API-key removal and readiness drops to ready=false", async () => {
    dc.statuses = [{ id: "openai", name: "OpenAI", flowType: "api_key", authenticated: true, maskedKey: "sk-…abc" }];
    dc.providerDelete = async () => {
      dc.statuses = []; // the server really removed the credential
      return { ok: true, json: async () => ({ ok: true }) } as any;
    };
    stubDispatchFetch();
    const { events, stop } = trackEvents();
    const c = render(<><ProviderAuthSection /><ReadyProbe /></>);
    const probe = () => JSON.parse(c.getByTestId("providers-ready").textContent!);
    await waitFor(() => expect(probe().ready).toBe(true));
    fireEvent.click(c.getByText("Remove"));
    await waitFor(() => expect(probe().ready).toBe(false));
    expect(events).toHaveLength(1);
    stop();
  });

  it("E2 dispatches on OAuth sign-out", async () => {
    dc.statuses = [{ id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: true }];
    stubDispatchFetch();
    const { events, stop } = trackEvents();
    const c = render(<ProviderAuthSection />);
    fireEvent.click(await c.findByText("Sign Out"));
    await waitFor(() => expect(events).toHaveLength(1));
    stop();
  });

  it("X1 dispatches nothing on a transport-failed save and keeps the error", async () => {
    dc.statuses = [{ id: "openai", name: "OpenAI", flowType: "api_key", authenticated: false }];
    dc.apiKeyPut = async () => ({ ok: false, json: async () => ({ error: "save failed" }) }) as any;
    stubDispatchFetch();
    const { events, stop } = trackEvents();
    const c = render(<ProviderAuthSection />);
    await saveApiKey(c);
    await waitFor(() => expect(c.getByText("save failed")).toBeTruthy());
    expect(events).toHaveLength(0);
    stop();
  });

  it("X3 dispatches nothing when the section merely mounts", async () => {
    dc.statuses = [];
    stubDispatchFetch();
    const { events, stop } = trackEvents();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(c.queryByText("Loading provider status…")).toBeNull());
    expect(dc.statusGets).toBeGreaterThanOrEqual(1);
    expect(events).toHaveLength(0);
    stop();
  });

  it("R1 keeps the owner callback and the section refresh intact", async () => {
    dc.statuses = [{ id: "openai", name: "OpenAI", flowType: "api_key", authenticated: false }];
    stubDispatchFetch();
    const { events, stop } = trackEvents();
    const onCredentialsChanged = vi.fn();
    const c = render(<ProviderAuthSection onCredentialsChanged={onCredentialsChanged} />);
    await c.findByText("Add Key");
    const statusGetsBeforeSave = dc.statusGets;
    await saveApiKey(c);
    await waitFor(() => expect(onCredentialsChanged).toHaveBeenCalledTimes(1));
    expect(events).toHaveLength(1);
    // handleChanged still drives the section's own refresh.
    await waitFor(() => expect(dc.statusGets).toBeGreaterThan(statusGetsBeforeSave));
    stop();
  });
});
