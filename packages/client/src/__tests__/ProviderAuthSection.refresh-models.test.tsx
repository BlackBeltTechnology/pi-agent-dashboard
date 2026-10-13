/**
 * Custom-endpoint row "Refresh models" control — POST /api/providers/:name/refresh.
 * Covers test-plan #F1–#F5, #X3, #X6. Harness mirrors
 * `ProviderAuthSection.test.tsx` (stubbed fetch, real section).
 *
 * See change: add-provider-models-refresh.
 */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderAuthSection } from "../components/settings/ProviderAuthSection.js";
import { PROVIDER_AUTH_EVENT } from "../hooks/useProvidersReady.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ENTRY = { baseUrl: "http://10.0.0.4:8000/v1", apiKey: "***", api: "openai-completions" };
const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, headers: { get: () => "application/json" }, json: async () => body }) as any;

interface Harness {
  refreshCalls: string[];
  /** Resolve the pending refresh with a response body (default = deferred). */
  respond?: (url: string) => Promise<any> | any;
  providerDelete?: () => Promise<any>;
}

function route(h: Harness, url: string, method?: string) {
  if (url.includes("/refresh")) {
    h.refreshCalls.push(url);
    return h.respond ? h.respond(url) : json({ success: true, health: { ok: true, modelCount: 7, testedAt: 2 } });
  }
  if (url.includes("/api/provider-auth/status")) return json([]);
  if (url.includes("/api/provider-auth/catalogue-ready")) return json({ ready: true });
  if (url.includes("/api/providers/") && method === "DELETE") return h.providerDelete?.() ?? json({ success: true });
  if (url.includes("/api/providers")) {
    return json({ success: true, providers: { proxy: { ...ENTRY } }, health: { proxy: { ok: true, modelCount: 3, testedAt: 1 } } });
  }
  return json({});
}

// StrictMode mirrors the real app root (main.tsx): dev double-mount must not
// strand the row in "Refreshing…" (mountedRef reset on remount).
async function mount(h: Harness, onCredentialsChanged?: () => void) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => route(h, url, init?.method)));
  const c = render(<StrictMode><ProviderAuthSection onCredentialsChanged={onCredentialsChanged} /></StrictMode>);
  await waitFor(() => expect(c.container.querySelector('[data-row-id="proxy"]')).toBeTruthy());
  return c;
}

const button = (c: { queryByTestId: (id: string) => HTMLElement | null }) =>
  c.queryByTestId("provider-refresh-models") as HTMLButtonElement | null;
const pill = (c: { container: HTMLElement }) => c.container.querySelector('[data-testid="health-pill"]')!;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("Refresh models row control", () => {
  it("disables while in flight, then shows the fresh model count (F1)", async () => {
    const d = deferred<any>();
    const h: Harness = { refreshCalls: [], respond: () => d.promise };
    const c = await mount(h);
    expect(pill(c).textContent).toMatch(/3 models/);

    fireEvent.click(button(c)!);
    await waitFor(() => expect(button(c)!.disabled).toBe(true));
    expect(pill(c).getAttribute("data-state")).toBe("testing");
    expect(h.refreshCalls[0]).toMatch(/\/api\/providers\/proxy\/refresh$/);

    await act(async () => { d.resolve(json({ success: true, health: { ok: true, modelCount: 7, testedAt: 2 } })); });
    await waitFor(() => expect(pill(c).textContent).toMatch(/7 models/));
    expect(button(c)!.disabled).toBe(false);
  });

  it("a double click sends one request (F2)", async () => {
    const d = deferred<any>();
    const h: Harness = { refreshCalls: [], respond: () => d.promise };
    const c = await mount(h);
    fireEvent.click(button(c)!);
    fireEvent.click(button(c)!);
    await act(async () => {});
    expect(h.refreshCalls).toHaveLength(1);
    await act(async () => { d.resolve(json({ success: true, health: null })); });
  });

  it("a successful refresh funnels exactly one provider-auth event + catalogue refetch (F3)", async () => {
    const events: Event[] = [];
    const onEvent = (e: Event) => events.push(e);
    window.addEventListener(PROVIDER_AUTH_EVENT, onEvent);
    const onCredentialsChanged = vi.fn();
    const h: Harness = { refreshCalls: [] };
    const c = await mount(h, onCredentialsChanged);
    fireEvent.click(button(c)!);
    await waitFor(() => expect(onCredentialsChanged).toHaveBeenCalledTimes(1));
    expect(events).toHaveLength(1);
    window.removeEventListener(PROVIDER_AUTH_EVENT, onEvent);
  });

  it("is not rendered in edit mode (F4)", async () => {
    const c = await mount({ refreshCalls: [] });
    expect(button(c)).toBeTruthy();
    fireEvent.click(c.getByText("Edit"));
    expect(button(c)).toBeNull();
  });

  it("is disabled while the row's removal is pending (F5)", async () => {
    const d = deferred<any>();
    const c = await mount({ refreshCalls: [], providerDelete: () => d.promise });
    fireEvent.click(c.getByText("Remove"));
    await waitFor(() => expect(button(c)!.disabled).toBe(true));
    await act(async () => { d.resolve(json({ success: true })); });
  });

  it("a failed refresh shows an inline error and keeps the prior pill (X3)", async () => {
    const h: Harness = { refreshCalls: [], respond: () => json({ success: false, error: "boom" }, 500) };
    const c = await mount(h);
    fireEvent.click(button(c)!);
    await waitFor(() => expect(c.getByTestId("provider-refresh-error").textContent).toContain("boom"));
    expect(button(c)!.disabled).toBe(false);
    expect(pill(c).textContent).toMatch(/3 models/);
  });

  it("unmounting mid-flight ignores the late result (X6)", async () => {
    const d = deferred<any>();
    const events: Event[] = [];
    const onEvent = (e: Event) => events.push(e);
    window.addEventListener(PROVIDER_AUTH_EVENT, onEvent);
    const err = vi.spyOn(console, "error");
    const c = await mount({ refreshCalls: [], respond: () => d.promise });
    fireEvent.click(button(c)!);
    c.unmount();
    await act(async () => { d.resolve(json({ success: true, health: null })); });
    expect(events).toHaveLength(0);
    expect(err.mock.calls.some((a) => String(a[0]).includes("unmounted"))).toBe(false);
    window.removeEventListener(PROVIDER_AUTH_EVENT, onEvent);
  });
});
