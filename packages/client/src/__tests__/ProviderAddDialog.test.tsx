/**
 * The Add-provider dialog (provider-add-flow) — picker membership, the
 * selectable count (E10), cross-type suppression in both directions (F6's L1
 * half), keyboard-only selection (F5's L1 half), per-flowType panes (7.3),
 * validate-before-write (7.4), the abandoned-dialog contract (F1 — the flow
 * outlives the dialog; X6 — a late refusal renders on the section), and the
 * immutable name in the custom-endpoint Edit surface (7.7).
 *
 * See change: redesign-providers-settings-page.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderAuthSection } from "../components/settings/ProviderAuthSection.js";
import { PROVIDER_AUTH_EVENT } from "../hooks/useProvidersReady.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface Script {
  statuses?: any[];
  providers?: Record<string, any>;
  health?: Record<string, any>;
  startPost?: () => Promise<any>;
  flowGet?: () => Promise<any>;
  apiKeyPut?: () => Promise<any>;
  providerPatch?: () => Promise<any>;
  calls: { put: number; patch: number; start: number; status: number };
}

/** The default POST /start snapshot — authUrl present, no pending widget yet. */
const DEFAULT_START = { flowId: "flow-1", provider: "anthropic", status: "pending", authUrl: "https://example.test/oauth" };

function stubFetch(script: Script) {
  return vi.fn(async (url: string, init?: any) => {
    if (url.includes("/api/provider-auth/status")) {
      script.calls.status++;
      return { ok: true, status: 200, json: async () => script.statuses ?? [] } as any;
    }
    if (url.includes("/api/providers")) {
      if (init?.method === "PATCH") {
        script.calls.patch++;
        return script.providerPatch ? await script.providerPatch() : { ok: true, json: async () => ({ success: true }) } as any;
      }
      return { ok: true, status: 200, json: async () => ({ success: true, providers: script.providers ?? {}, health: script.health ?? {} }) } as any;
    }
    if (url.includes("/api/provider-auth/catalogue-ready")) {
      return { ok: true, status: 200, json: async () => ({ ready: true }) } as any;
    }
    if (url.includes("/api/provider-auth/api-key")) {
      script.calls.put++;
      return script.apiKeyPut ? await script.apiKeyPut() : { ok: true, json: async () => ({ ok: true }) } as any;
    }
    if (url.includes("/api/provider-auth/start")) {
      script.calls.start++;
      return script.startPost ? await script.startPost() : { ok: true, json: async () => DEFAULT_START } as any;
    }
    if (url.includes("/api/provider-auth/flow/")) {
      if (init?.method === "POST") {
        // POST /flow/:flowId/input — the prompt answer.
        return { ok: true, status: 202, json: async () => ({ ok: true }) } as any;
      }
      if (init?.method === "DELETE") {
        return { ok: true, status: 204 } as any;
      }
      return script.flowGet ? await script.flowGet() : { ok: true, json: async () => ({ ...DEFAULT_START, status: "pending" }) } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  });
}

async function renderSection(script: Script) {
  vi.stubGlobal("fetch", stubFetch(script));
  const c = render(<ProviderAuthSection />);
  await waitFor(() => expect(script.calls.status).toBeGreaterThanOrEqual(1));
  return c;
}

function dialog() {
  return within(screen.getByRole("dialog"));
}

async function openPicker() {
  fireEvent.click(await screen.findByTestId("add-provider-button"));
  await screen.findByRole("dialog");
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

// ── 7.1 — picker membership, count, suppression, keyboard ────────────────────

describe("picker membership and the selectable count (E10)", () => {
  it("the Add control names 34 selectable providers: 41 rows, 6 configured, 1 suppressed", async () => {
    const statuses: any[] = [
      { id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: true, configured: true, source: "stored" },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `keyed-${i}`, name: `Keyed ${i}`, flowType: "api_key", authenticated: true, configured: true, maskedKey: `sk-…${i}`, source: "stored" })),
      // The twin of the connected OAuth subscription — suppressed.
      { id: "anthropic-api", name: "Anthropic (API Key)", flowType: "api_key", authenticated: false, configured: false },
      ...Array.from({ length: 34 }, (_, i) => ({ id: `open-${i}`, name: `Open ${i}`, flowType: i % 2 ? "auth_code" : "api_key", authenticated: false, configured: false })),
    ];
    const c = await renderSection({ statuses, calls: { put: 0, patch: 0, start: 0, status: 0 } });

    expect(c.getByTestId("add-provider-count").textContent).toContain("34");
    expect(c.getByTestId("add-provider-count").textContent).not.toContain("35");

    await openPicker();
    const d = dialog();
    // The configured are absent from the picker.
    expect(d.queryByText("Anthropic")).toBeNull();
    expect(d.queryByText("Keyed 0")).toBeNull();
    // The suppressed twin stays visible, but non-selectable, naming the way out.
    const twin = d.getByText("Anthropic (API Key)").closest('[role="option"]')!;
    expect(twin.getAttribute("aria-disabled")).toBe("true");
    expect(twin.getAttribute("title")).toMatch(/sign out first/i);
    // Selecting it does nothing.
    fireEvent.click(twin);
    expect(d.queryByLabelText(/api key/i)).toBeNull();
  });

  it("suppresses the OAuth entry while the twin holds a stored key (F6, inverse)", async () => {
    const statuses: any[] = [
      { id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false, configured: false },
      { id: "anthropic-api", name: "Anthropic (API Key)", flowType: "api_key", authenticated: true, configured: true, maskedKey: "sk-…xyz", source: "stored" },
    ];
    await renderSection({ statuses, calls: { put: 0, patch: 0, start: 0, status: 0 } });

    await openPicker();
    const d = dialog();
    const entry = d.getByText("Anthropic").closest('[role="option"]')!;
    expect(entry.getAttribute("aria-disabled")).toBe("true");
    expect(entry.getAttribute("title")).toMatch(/removed first|remove.*first/i);
  });

  it("selects by keyboard alone — type to filter, arrows, Enter (F5)", async () => {
    const statuses: any[] = [
      { id: "alpha", name: "Alpha", flowType: "api_key", authenticated: false, configured: false },
      { id: "beta", name: "Beta", flowType: "api_key", authenticated: false, configured: false },
      { id: "gamma", name: "Gamma", flowType: "api_key", authenticated: false, configured: false },
    ];
    await renderSection({ statuses, calls: { put: 0, patch: 0, start: 0, status: 0 } });

    await openPicker();
    const d = dialog();
    const input = d.getByPlaceholderText(/search providers/i) as HTMLInputElement;
    // ArrowDown ×2 from the first entry lands on Gamma — no pointer involved.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    // Gamma's pane opens (a NEW dialog — the picker unmounted).
    const pane = await screen.findByRole("dialog");
    expect(within(pane).getByText(/Add Gamma/)).toBeTruthy();
  });

  it("offers the pinned Custom endpoint entry with or without a catalogue, under any search", async () => {
    await renderSection({ statuses: [], calls: { put: 0, patch: 0, start: 0, status: 0 } });

    await openPicker();
    const d = dialog();
    expect(d.getByText(/custom endpoint/i)).toBeTruthy();
    const input = d.getByPlaceholderText(/search providers/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "zzz-no-match" } });
    expect(d.getByText(/custom endpoint/i)).toBeTruthy();
  });
});

// ── 7.3 — the pane branches on flowType ──────────────────────────────────────

describe("panes branch on flowType (7.3)", () => {
  it("an auth_code pane offers the browser sign-in and NO key field", async () => {
    const statuses = [{ id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false, configured: false }];
    await renderSection({ statuses, calls: { put: 0, patch: 0, start: 0, status: 0 } });

    await openPicker();
    fireEvent.click(dialog().getByText("Anthropic"));
    const d = dialog();
    expect(d.getByTestId("dialog-sign-in")).toBeTruthy();
    expect(d.queryByLabelText(/api key/i)).toBeNull();
  });

  it("an api_key pane shows the envVar hint", async () => {
    const statuses = [{ id: "mistral", name: "Mistral", flowType: "api_key", authenticated: false, configured: false, envVar: "MISTRAL_API_KEY" }];
    await renderSection({ statuses, calls: { put: 0, patch: 0, start: 0, status: 0 } });

    await openPicker();
    fireEvent.click(dialog().getByText("Mistral"));
    expect(dialog().getByText(/MISTRAL_API_KEY/)).toBeTruthy();
  });

  it("a device_code pane requires an explicit Open Registration Page action — never auto-opens", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const statuses = [{ id: "device-prov", name: "Device Prov", flowType: "device_code", authenticated: false, configured: false }];
    const script: Script = {
      statuses,
      startPost: () => Promise.resolve({ ok: true, json: async () => ({ flowId: "flow-1", provider: "device-prov", status: "pending", pending: { kind: "device_code", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresInSeconds: 900 } }) } as any),
      calls: { put: 0, patch: 0, start: 0, status: 0 },
    };
    await renderSection(script);

    await openPicker();
    fireEvent.click(dialog().getByText("Device Prov"));
    const d = dialog();
    fireEvent.click(d.getByTestId("dialog-sign-in"));
    // The code and the verification URL render with the explicit action.
    expect(await d.findByText("WDJB-MJHT")).toBeTruthy();
    const openBtn = d.getByText(/open registration page/i);
    expect(openBtn).toBeTruthy();
    expect(openSpy).not.toHaveBeenCalled();
    fireEvent.click(openBtn);
    expect(openSpy).toHaveBeenCalledWith("https://github.com/login/device", "_blank");
  });

  it("GitHub Copilot prompts for the Enterprise domain BEFORE starting the flow and sends it as enterpriseDomain", async () => {
    const starts: any[] = [];
    const script: Script = { statuses: [{ id: "github-copilot", name: "GitHub Copilot", flowType: "device_code", authenticated: false, configured: false }], calls: { put: 0, patch: 0, start: 0, status: 0 } };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      if (url.includes("/api/provider-auth/start")) {
        starts.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ flowId: "flow-1", provider: "github-copilot", status: "pending" }) } as any;
      }
      const handler = stubFetch(script);
      return handler(url, init);
    }) as any);
    render(<ProviderAuthSection />);

    await openPicker();
    fireEvent.click(dialog().getByText("GitHub Copilot"));
    const d = dialog();
    // The prompt comes first, with the blank-for-github.com placeholder.
    const input = d.getByLabelText(/GitHub Enterprise domain/i);
    expect(input.getAttribute("placeholder")).toMatch(/blank for github\.com/i);
    expect(starts).toHaveLength(0);
    fireEvent.change(input, { target: { value: "ghe.example.com" } });
    fireEvent.click(d.getByText(/continue/i));
    // The flow starts only after the prompt, carrying the domain — and the
    // enterprise text field is gone once the flow exists.
    await waitFor(() => expect(starts).toHaveLength(1));
    expect(starts[0]).toEqual({ provider: "github-copilot", enterpriseDomain: "ghe.example.com" });
    expect(d.queryByLabelText(/GitHub Enterprise domain/i)).toBeNull();
  });
});

// ── 7.4 — validate before writing ────────────────────────────────────────────

describe("validation before write (7.4)", () => {
  it("an empty api key is refused at the dialog with a visible message and no request", async () => {
    const script: Script = { statuses: [{ id: "deepseek", name: "DeepSeek", flowType: "api_key", authenticated: false, configured: false }], calls: { put: 0, patch: 0, start: 0, status: 0 } };
    await renderSection(script);

    await openPicker();
    fireEvent.click(dialog().getByText("DeepSeek"));
    const d = dialog();
    fireEvent.click(d.getByTestId("dialog-submit"));
    expect(d.getByTestId("dialog-validation").textContent).toMatch(/key is required/i);
    expect(script.calls.put).toBe(0);
    // The dialog stays open.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("a blank or whitespace-only custom-endpoint name is refused at the dialog with no request", async () => {
    const script: Script = { statuses: [], calls: { put: 0, patch: 0, start: 0, status: 0 } };
    await renderSection(script);

    await openPicker();
    fireEvent.click(dialog().getByText(/custom endpoint/i));
    const d = dialog();
    fireEvent.change(d.getByLabelText(/name/i), { target: { value: "   " } });
    fireEvent.change(d.getByLabelText(/base url/i), { target: { value: "http://localhost:8000/v1" } });
    fireEvent.change(d.getByLabelText(/api key/i), { target: { value: "sk-x" } });
    fireEvent.click(d.getByTestId("dialog-submit"));
    expect(d.getByTestId("dialog-validation").textContent).toMatch(/name is required/i);
    expect(script.calls.patch).toBe(0);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

// ── 7.5 / 7.6 — the flow outlives the dialog; late refusal on the section ────

describe("abandoned-dialog contract (F1, X6)", () => {
  it("an auth-code flow keeps polling after the dialog is dismissed and completes (F1)", async () => {
    let completed = false;
    const script: Script = {
      statuses: [{ id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false, configured: false }],
      startPost: async () => {
        completed = true;
        return { ok: true, json: async () => DEFAULT_START } as any;
      },
      flowGet: () => Promise.resolve({ ok: true, json: async () => ({ ...DEFAULT_START, status: "complete" }) } as any),
      calls: { put: 0, patch: 0, start: 0, status: 0 },
    };
    // After the flow starts, /status shows the provider configured.
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/provider-auth/status")) {
        script.calls.status++;
        return { ok: true, json: async () => [script.statuses![0], { id: "x" }] .slice(0, 1).map((r) => ({ ...r, authenticated: completed, configured: completed })) } as any;
      }
      const handler = stubFetch(script);
      return handler(url, undefined);
    }) as any);

    const events: CustomEvent[] = [];
    window.addEventListener(PROVIDER_AUTH_EVENT, (e) => events.push(e as CustomEvent));
    const c = render(<ProviderAuthSection />);

    fireEvent.click(await c.findByTestId("add-provider-button"));
    fireEvent.click(dialog().getByText("Anthropic"));
    fireEvent.click(dialog().getByTestId("dialog-sign-in"));

    // Dismiss the dialog mid-flow.
    fireEvent.click(document.querySelector('[aria-label="Close"]')!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // The poll never stopped at dismissal — it observes completion and lands.
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    await waitFor(() => expect(events).toHaveLength(1));
    await waitFor(() => {
      expect(c.container.querySelector('[data-testid="provider-row"][data-row-id="anthropic"]')).toBeTruthy();
    });
  });

  it("a device flow refused after the dialog closed renders the refusal inline on the section (X6)", async () => {
    const script: Script = {
      statuses: [{ id: "device-prov", name: "Device Prov", flowType: "device_code", authenticated: false, configured: false }],
      startPost: () => Promise.resolve({ ok: true, json: async () => ({ flowId: "flow-1", provider: "device-prov", status: "pending", pending: { kind: "device_code", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device" } }) } as any),
      flowGet: () => Promise.resolve({ ok: true, json: async () => ({ flowId: "flow-1", provider: "device-prov", status: "error", error: "An API key is already stored for this provider — remove the key first." }) } as any),
      calls: { put: 0, patch: 0, start: 0, status: 0 },
    };
    const c = await renderSection(script);

    await openPicker();
    fireEvent.click(dialog().getByText("Device Prov"));
    fireEvent.click(dialog().getByTestId("dialog-sign-in"));
    await waitFor(() => expect(dialog().getByText("WDJB-MJHT")).toBeTruthy());

    // Dismiss the dialog while the flow polls.
    fireEvent.click(document.querySelector('[aria-label="Close"]')!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // The refusal lands on the SECTION, and the provider is not connected.
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    const error = await screen.findByTestId("provider-flow-error");
    expect(error.textContent).toMatch(/remove the key first/);
    expect(c.container.querySelector('[data-testid="provider-row"][data-row-id="device-prov"]')).toBeNull();
  });
});

// ── E29 — one prompt-driven pane branches on flow.status.pending ───────────

describe("the sign-in pane branches on flow.status.pending (E29)", () => {
  const authUrl = "https://example.test/oauth";

  async function startWithPending(pending: any) {
    const script: Script = {
      statuses: [{ id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false, configured: false }],
      startPost: () => Promise.resolve({ ok: true, json: async () => ({ flowId: "flow-1", provider: "anthropic", status: "pending", authUrl, pending }) } as any),
      calls: { put: 0, patch: 0, start: 0, status: 0 },
    };
    await renderSection(script);
    await openPicker();
    fireEvent.click(dialog().getByText("Anthropic"));
    fireEvent.click(dialog().getByTestId("dialog-sign-in"));
  }

  // The auth link is asserted in EVERY case: it renders whenever authUrl is
  // present, beside whatever pending widget the flow is showing.
  it("manual_code renders the paste field labelled by pending.message beside the auth link", async () => {
    await startWithPending({ kind: "manual_code", message: "Paste the callback URL", placeholder: "http://localhost:53692/callback?code=…" });
    const d = dialog();
    expect(await d.findByTestId("dialog-input-field")).toBeTruthy();
    expect(d.getByText("Paste the callback URL")).toBeTruthy();
    expect(d.getByTestId("dialog-input-submit")).toBeTruthy();
    expect(screen.getByRole("dialog").querySelector(`a[href="${authUrl}"]`)).toBeTruthy();
  });

  it("text renders the text field labelled by pending.message beside the auth link", async () => {
    await startWithPending({ kind: "text", message: "Enter your workspace name", placeholder: "my-workspace" });
    const d = dialog();
    expect(await d.findByTestId("dialog-input-field")).toBeTruthy();
    expect(d.getByText("Enter your workspace name")).toBeTruthy();
    expect((d.getByTestId("dialog-input-field") as HTMLInputElement).getAttribute("placeholder")).toBe("my-workspace");
    expect(screen.getByRole("dialog").querySelector(`a[href="${authUrl}"]`)).toBeTruthy();
  });

  it("select renders one button per option beside the auth link", async () => {
    await startWithPending({
      kind: "select",
      message: "How do you want to sign in?",
      options: [
        { id: "browser", label: "Browser login" },
        { id: "device", label: "Device code login", description: "Use a code on another machine" },
      ],
    });
    const d = dialog();
    expect(await d.findByTestId("dialog-option-browser")).toBeTruthy();
    expect(d.getByTestId("dialog-option-device")).toBeTruthy();
    expect(d.getByText("Browser login")).toBeTruthy();
    expect(d.getByText("Use a code on another machine")).toBeTruthy();
    expect(screen.getByRole("dialog").querySelector(`a[href="${authUrl}"]`)).toBeTruthy();
  });

  it("device_code keeps the code pane and renders the auth link too", async () => {
    await startWithPending({ kind: "device_code", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresInSeconds: 900 });
    const d = dialog();
    expect(await d.findByText("WDJB-MJHT")).toBeTruthy();
    expect(d.getByText(/open registration page/i)).toBeTruthy();
    expect(d.getByText(/Code expires in 15:00/)).toBeTruthy();
    expect(screen.getByRole("dialog").querySelector(`a[href="${authUrl}"]`)).toBeTruthy();
  });

  it("submitting the paste field POSTs the answer to the input endpoint and clears the field", async () => {
    const inputPosts: any[] = [];
    const script: Script = {
      statuses: [{ id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false, configured: false }],
      startPost: () => Promise.resolve({ ok: true, json: async () => ({ flowId: "flow-1", provider: "anthropic", status: "pending", pending: { kind: "manual_code", message: "Paste the callback URL" } }) } as any),
      calls: { put: 0, patch: 0, start: 0, status: 0 },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      if (url.includes("/api/provider-auth/flow/") && init?.method === "POST") {
        inputPosts.push({ url, body: JSON.parse(init.body) });
      }
      const handler = stubFetch(script);
      return handler(url, init);
    }) as any);
    // Manual mount — renderSection would re-stub fetch over the recorder.
    render(<ProviderAuthSection />);
    await waitFor(() => expect(script.calls.status).toBeGreaterThanOrEqual(1));
    await openPicker();
    fireEvent.click(dialog().getByText("Anthropic"));
    fireEvent.click(dialog().getByTestId("dialog-sign-in"));

    const field = (await dialog().findByTestId("dialog-input-field")) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "http://localhost:53692/callback?code=abc" } });
    fireEvent.click(dialog().getByTestId("dialog-input-submit"));
    await waitFor(() => expect(inputPosts).toHaveLength(1));
    expect(inputPosts[0].url).toContain("/api/provider-auth/flow/flow-1/input");
    expect(inputPosts[0].body).toEqual({ value: "http://localhost:53692/callback?code=abc" });
    // Cleared after submit — a later status read never repopulates it.
    expect((dialog().getByTestId("dialog-input-field") as HTMLInputElement).value).toBe("");
  });

  it("Cancel DELETEs the flow, stops the poll, and returns to the picker", async () => {
    let deletes = 0;
    let flowGets = 0;
    const script: Script = {
      statuses: [{ id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false, configured: false }],
      startPost: () => Promise.resolve({ ok: true, json: async () => ({ flowId: "flow-1", provider: "anthropic", status: "pending", pending: { kind: "text", message: "Enter your workspace name" } }) } as any),
      calls: { put: 0, patch: 0, start: 0, status: 0 },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      if (url.includes("/api/provider-auth/flow/") && init?.method === "DELETE") {
        deletes++;
      }
      if (url.includes("/api/provider-auth/flow/")) {
        flowGets++;
      }
      const handler = stubFetch(script);
      return handler(url, init);
    }) as any);
    // Manual mount — renderSection would re-stub fetch over the recorder.
    render(<ProviderAuthSection />);
    await waitFor(() => expect(script.calls.status).toBeGreaterThanOrEqual(1));
    await openPicker();
    fireEvent.click(dialog().getByText("Anthropic"));
    fireEvent.click(dialog().getByTestId("dialog-sign-in"));
    expect(await dialog().findByTestId("dialog-cancel")).toBeTruthy();

    fireEvent.click(dialog().getByTestId("dialog-cancel"));
    await waitFor(() => expect(deletes).toBe(1));
    // Back to the picker: the sign-in pane is gone.
    expect(dialog().getByPlaceholderText(/search providers/i)).toBeTruthy();
    // The poll stopped: no further /flow traffic.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const after = flowGets;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(flowGets).toBe(after);
  });

  it("a start failure (500) is a terminal pane error with Try Again — no poll begins", async () => {
    const flowGets = vi.fn();
    const script: Script = {
      statuses: [{ id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false, configured: false }],
      startPost: () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "Callback port 53692 is already in use." }) } as any),
      calls: { put: 0, patch: 0, start: 0, status: 0 },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      if (url.includes("/api/provider-auth/flow/")) {
        flowGets();
      }
      const handler = stubFetch(script);
      return handler(url, init);
    }) as any);
    // Manual mount — renderSection would re-stub fetch over the recorder.
    render(<ProviderAuthSection />);
    await waitFor(() => expect(script.calls.status).toBeGreaterThanOrEqual(1));
    await openPicker();
    fireEvent.click(dialog().getByText("Anthropic"));
    fireEvent.click(dialog().getByTestId("dialog-sign-in"));

    const err = await dialog().findByTestId("dialog-flow-error");
    expect(err.textContent).toMatch(/port 53692 is already in use/);
    expect(dialog().getByTestId("dialog-try-again")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(flowGets).not.toHaveBeenCalled();
  });
});

// ── 7.7 — the custom-endpoint Edit surface never renames ────────────────────

describe("custom-endpoint Edit surface (7.7)", () => {
  it("the name is immutable in place; saving PATCHes the same name and never renames", async () => {
    const patchUrls: string[] = [];
    const script: Script = {
      statuses: [],
      providers: { "local-vllm": { baseUrl: "http://10.0.0.4:8000/v1", apiKey: "***", api: "openai-completions" } },
      providerPatch: () => Promise.resolve({ ok: true, json: async () => ({ success: true }) } as any),
      calls: { put: 0, patch: 0, start: 0, status: 0 },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      if (url.includes("/api/providers") && init?.method === "PATCH") {
        script.calls.patch++;
        patchUrls.push(url);
        return { ok: true, json: async () => ({ success: true }) } as any;
      }
      const handler = stubFetch(script);
      return handler(url, init);
    }) as any);
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(c.container.querySelector('[data-testid="provider-row"][data-row-id="local-vllm"]')).toBeTruthy());

    fireEvent.click(c.getByText("Edit"));
    const edit = c.getByTestId("custom-endpoint-edit");
    // The name renders as text — no name input exists.
    expect(edit.textContent).toContain("local-vllm");
    expect(edit.querySelector('input[aria-label="Name"]')).toBeNull();

    // Change the base URL and save — PATCH addresses the SAME name.
    fireEvent.change(c.getByLabelText(/base url/i), { target: { value: "http://10.0.0.9:8000/v1" } });
    fireEvent.click(c.getByText("Save"));
    await waitFor(() => expect(script.calls.patch).toBe(1));
    expect(patchUrls[0]).toContain(`/api/providers/${encodeURIComponent("local-vllm")}`);
    expect(c.queryByText("Remove")).toBeTruthy();
  });
});

// ── Custom-endpoint pane Test action (moved from LlmProviderCard) ────────
// The pane tests a NEW provider: the probe payload carries NO name — the
// server has nothing saved to resolve the key against yet.

describe("custom-endpoint pane Test action (moved from LlmProviderCard)", () => {
  async function openPaneWithProbe(probe: { calls: any[]; respond?: () => any }) {
    const script: Script = { statuses: [], calls: { put: 0, patch: 0, start: 0, status: 0 } };
    const base = stubFetch(script);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      if (url.includes("/api/providers/test")) {
        probe.calls.push({ url, init });
        const body = probe.respond ? probe.respond() : { ok: true, status: 200, modelCount: 3, sample: ["m1"] };
        // fetchJsonResponse guards on the content-type header.
        return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => body } as any;
      }
      return base(url, init);
    }) as any);
    render(<ProviderAuthSection />);
    fireEvent.click(await screen.findByTestId("add-provider-button"));
    await screen.findByRole("dialog");
    fireEvent.click(dialog().getByText(/custom endpoint/i));
    const testButton = () => dialog().getByTestId("dialog-test") as HTMLButtonElement;
    return { testButton };
  }

  it("renders a Test control", async () => {
    const { testButton } = await openPaneWithProbe({ calls: [] });
    expect(testButton()).toBeTruthy();
  });

  it("Test is disabled when the base URL is empty", async () => {
    const { testButton } = await openPaneWithProbe({ calls: [] });
    // A fresh pane has both fields empty — the control starts disabled.
    expect(testButton().disabled).toBe(true);
  });

  it("Test is disabled when the API key is empty", async () => {
    const { testButton } = await openPaneWithProbe({ calls: [] });
    fireEvent.change(dialog().getByLabelText(/base url/i), { target: { value: "http://localhost:8000/v1" } });
    expect(testButton().disabled).toBe(true);
  });

  it("Test is enabled when both the base URL and the key have values", async () => {
    const { testButton } = await openPaneWithProbe({ calls: [] });
    fireEvent.change(dialog().getByLabelText(/base url/i), { target: { value: "http://localhost:8000/v1" } });
    fireEvent.change(dialog().getByLabelText(/api key/i), { target: { value: "sk-x" } });
    expect(testButton().disabled).toBe(false);
  });

  it("clicking Test POSTs the probe WITHOUT a name for a NEW provider, then updates the pill live", async () => {
    const probe = { calls: [] as any[] };
    const { testButton } = await openPaneWithProbe(probe);
    fireEvent.change(dialog().getByLabelText(/name/i), { target: { value: "local-vllm" } });
    fireEvent.change(dialog().getByLabelText(/base url/i), { target: { value: "http://localhost:8000/v1" } });
    fireEvent.change(dialog().getByLabelText(/api key/i), { target: { value: "sk-x" } });
    fireEvent.click(testButton());
    await waitFor(() => expect(probe.calls).toHaveLength(1));
    const { url, init } = probe.calls[0];
    expect(url).toContain("/api/providers/test");
    expect(init.method).toBe("POST");
    const payload = JSON.parse(init.body);
    expect(payload).toEqual({ baseUrl: "http://localhost:8000/v1", apiKey: "sk-x", api: "openai-completions" });
    // A NEW provider sends NO name at all.
    expect("name" in payload).toBe(false);
    // The ok probe result updates the pill live: green, model count.
    const pill = await waitFor(() => dialog().getByTestId("health-pill"));
    expect(pill.getAttribute("data-state")).toBe("ok");
    expect(pill.textContent).toMatch(/3 models/);
  });

  it("does not call the probe when the Test control is disabled", async () => {
    const probe = { calls: [] as any[] };
    const { testButton } = await openPaneWithProbe(probe);
    expect(testButton().disabled).toBe(true);
    fireEvent.click(testButton());
    // Flush microtasks so a (buggy) async call path would have surfaced.
    await act(async () => {});
    expect(probe.calls).toHaveLength(0);
  });
});
