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
  authorizePost?: () => Promise<any>;
  deviceCodePost?: () => Promise<any>;
  deviceStatusGet?: () => Promise<any>;
  apiKeyPut?: () => Promise<any>;
  providerPatch?: () => Promise<any>;
  calls: { put: number; patch: number; deviceCode: number; status: number };
}

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
    if (url.includes("/api/provider-auth/authorize")) {
      return script.authorizePost ? await script.authorizePost() : { ok: true, json: async () => ({ authUrl: "https://example.test/oauth" }) } as any;
    }
    if (url.includes("/api/provider-auth/device-code")) {
      script.calls.deviceCode++;
      return script.deviceCodePost ? await script.deviceCodePost() : { ok: true, json: async () => ({ flowId: "flow-1", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 }) } as any;
    }
    if (url.includes("/api/provider-auth/device-status/")) {
      return script.deviceStatusGet ? await script.deviceStatusGet() : { ok: true, json: async () => ({ status: "pending" }) } as any;
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
    const c = await renderSection({ statuses, calls: { put: 0, patch: 0, deviceCode: 0, status: 0 } });

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
    await renderSection({ statuses, calls: { put: 0, patch: 0, deviceCode: 0, status: 0 } });

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
    await renderSection({ statuses, calls: { put: 0, patch: 0, deviceCode: 0, status: 0 } });

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
    await renderSection({ statuses: [], calls: { put: 0, patch: 0, deviceCode: 0, status: 0 } });

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
    await renderSection({ statuses, calls: { put: 0, patch: 0, deviceCode: 0, status: 0 } });

    await openPicker();
    fireEvent.click(dialog().getByText("Anthropic"));
    const d = dialog();
    expect(d.getByTestId("dialog-sign-in")).toBeTruthy();
    expect(d.queryByLabelText(/api key/i)).toBeNull();
  });

  it("an api_key pane shows the envVar hint", async () => {
    const statuses = [{ id: "mistral", name: "Mistral", flowType: "api_key", authenticated: false, configured: false, envVar: "MISTRAL_API_KEY" }];
    await renderSection({ statuses, calls: { put: 0, patch: 0, deviceCode: 0, status: 0 } });

    await openPicker();
    fireEvent.click(dialog().getByText("Mistral"));
    expect(dialog().getByText(/MISTRAL_API_KEY/)).toBeTruthy();
  });

  it("a device_code pane requires an explicit Open Registration Page action — never auto-opens", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const statuses = [{ id: "device-prov", name: "Device Prov", flowType: "device_code", authenticated: false, configured: false }];
    await renderSection({ statuses, calls: { put: 0, patch: 0, deviceCode: 0, status: 0 } });

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

  it("GitHub Copilot prompts for the Enterprise domain BEFORE starting the flow", async () => {
    const script: Script = { statuses: [{ id: "github-copilot", name: "GitHub Copilot", flowType: "device_code", authenticated: false, configured: false }], calls: { put: 0, patch: 0, deviceCode: 0, status: 0 } };
    await renderSection(script);

    await openPicker();
    fireEvent.click(dialog().getByText("GitHub Copilot"));
    const d = dialog();
    // The prompt comes first, with the blank-for-github.com placeholder.
    const input = d.getByLabelText(/GitHub Enterprise domain/i);
    expect(input.getAttribute("placeholder")).toMatch(/blank for github\.com/i);
    expect(script.calls.deviceCode).toBe(0);
    fireEvent.change(input, { target: { value: "ghe.example.com" } });
    fireEvent.click(d.getByText(/continue/i));
    // The flow starts only after the prompt, carrying the domain.
    await waitFor(() => expect(script.calls.deviceCode).toBe(1));
  });
});

// ── 7.4 — validate before writing ────────────────────────────────────────────

describe("validation before write (7.4)", () => {
  it("an empty api key is refused at the dialog with a visible message and no request", async () => {
    const script: Script = { statuses: [{ id: "deepseek", name: "DeepSeek", flowType: "api_key", authenticated: false, configured: false }], calls: { put: 0, patch: 0, deviceCode: 0, status: 0 } };
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
    const script: Script = { statuses: [], calls: { put: 0, patch: 0, deviceCode: 0, status: 0 } };
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
    let authenticated = false;
    const script: Script = {
      statuses: [{ id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false, configured: false }],
      authorizePost: async () => {
        authenticated = true;
        return { ok: true, json: async () => ({ authUrl: "https://example.test/oauth" }) } as any;
      },
      calls: { put: 0, patch: 0, deviceCode: 0, status: 0 },
    };
    // After the flow starts, /status shows the provider configured.
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/provider-auth/status")) {
        script.calls.status++;
        return { ok: true, json: async () => [script.statuses![0], { id: "x" }] .slice(0, 1).map((r) => ({ ...r, authenticated, configured: authenticated })) } as any;
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
      deviceStatusGet: () => Promise.resolve({ ok: true, json: async () => ({ status: "error", error: "An API key is already stored for this provider — remove the key first." }) } as any),
      calls: { put: 0, patch: 0, deviceCode: 0, status: 0 },
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

// ── 7.7 — the custom-endpoint Edit surface never renames ────────────────────

describe("custom-endpoint Edit surface (7.7)", () => {
  it("the name is immutable in place; saving PATCHes the same name and never renames", async () => {
    const patchUrls: string[] = [];
    const script: Script = {
      statuses: [],
      providers: { "local-vllm": { baseUrl: "http://10.0.0.4:8000/v1", apiKey: "***", api: "openai-completions" } },
      providerPatch: () => Promise.resolve({ ok: true, json: async () => ({ success: true }) } as any),
      calls: { put: 0, patch: 0, deviceCode: 0, status: 0 },
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
    const script: Script = { statuses: [], calls: { put: 0, patch: 0, deviceCode: 0, status: 0 } };
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
