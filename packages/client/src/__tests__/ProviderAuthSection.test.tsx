/**
 * Component tests for the REDESIGNED ProviderAuthSection — the connected list.
 *
 * The section lists ONLY providers that hold a credential, merging two
 * independent sources keyed by (source, id):
 *   - `auth` rows from GET /api/provider-auth/status (configured ?? authenticated)
 *   - `custom` rows from GET /api/providers (client-side configured predicate)
 * Badges carry the credential KIND as a word (D1): only `ambient` or
 * `source === "environment"` earns Environment.
 *
 * Covers test-plan E7, E8, E9, P3, F9, F11 and the D6 dual-row precedence of
 * change redesign-providers-settings-page. See change:
 * redesign-providers-settings-page.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { ProviderAuthSection, customEndpointConfigured } from "../components/settings/ProviderAuthSection.js";
import { PROVIDER_AUTH_EVENT, useProvidersReady } from "../hooks/useProvidersReady.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface FetchScript {
  statuses?: any[];
  providers?: Record<string, any>;
  health?: Record<string, any>;
  catalogueReady?: boolean;
  statusMode?: "ok" | "500" | "nonarray" | "reject";
  providersMode?: "ok" | "500" | "reject";
  apiKeyPut?: () => Promise<any>;
  providerDelete?: () => Promise<any>;
  providerPatch?: () => Promise<any>;
  statusGets: number;
  providersGets: number;
}

function stubFetch(script: FetchScript) {
  return vi.fn(async (url: string, init?: any) => {
    if (url.includes("/api/provider-auth/status")) {
      script.statusGets++;
      if (script.statusMode === "500") {
        return { ok: false, status: 500, json: async () => ({ statusCode: 500, error: "Internal Server Error", message: "boom" }) } as any;
      }
      if (script.statusMode === "nonarray") {
        return { ok: true, status: 200, json: async () => ({ ids: [] }) } as any;
      }
      if (script.statusMode === "reject") throw new TypeError("simulated network failure");
      return { ok: true, status: 200, json: async () => script.statuses } as any;
    }
    if (url.includes("/api/providers")) {
      script.providersGets++;
      if (script.providersMode === "500") {
        return { ok: false, status: 500, json: async () => ({ statusCode: 500, error: "Internal Server Error" }) } as any;
      }
      if (script.providersMode === "reject") throw new TypeError("simulated network failure");
      if (init?.method === "PATCH") return script.providerPatch ? await script.providerPatch() : { ok: true, json: async () => ({ success: true }) } as any;
      return { ok: true, status: 200, json: async () => ({ success: true, providers: script.providers ?? {}, health: script.health ?? {} }) } as any;
    }
    if (url.includes("/api/provider-auth/catalogue-ready")) {
      return { ok: true, status: 200, json: async () => ({ ready: script.catalogueReady ?? true }) } as any;
    }
    if (url.includes("/api/provider-auth/api-key")) return script.apiKeyPut ? await script.apiKeyPut() : { ok: true, json: async () => ({ ok: true }) } as any;
    if (/\/api\/provider-auth\/[^/]+$/.test(url) && init?.method === "DELETE") return script.providerDelete ? await script.providerDelete() : { ok: true, json: async () => ({ ok: true }) } as any;
    return { ok: true, status: 200, json: async () => ({}) } as any;
  });
}

/** Mount the section and wait for the two source fetches to settle. */
async function renderSection(script: FetchScript, onCredentialsChanged?: () => void) {
  const fetchMock = stubFetch(script);
  vi.stubGlobal("fetch", fetchMock);
  const c = render(<ProviderAuthSection onCredentialsChanged={onCredentialsChanged} />);
  await waitFor(() => {
    // Both sources have been read at least once.
    expect(script.statusGets).toBeGreaterThanOrEqual(1);
    expect(script.providersGets).toBeGreaterThanOrEqual(1);
  });
  return { c, fetchMock };
}

function rows(c: { container: HTMLElement }) {
  return Array.from(c.container.querySelectorAll('[data-testid="provider-row"]'));
}

function badgeOf(row: Element): string {
  return row.querySelector('[data-testid="provider-badge"]')?.textContent ?? "";
}

// ── E7 — badge mapping: only ambient/environment earn Environment ────────────

describe("badge mapping (E7, D1)", () => {
  it("maps each row kind to its badge word", async () => {
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      statuses: [
        { id: "p-oauth", name: "OAuth Prov", flowType: "auth_code", authenticated: true, expires: Date.now() + 86_400_000, configured: true, source: "stored" },
        { id: "p-key", name: "Key Prov", flowType: "api_key", authenticated: true, maskedKey: "sk-…abc", configured: true, source: "stored" },
        { id: "p-ambient", name: "Ambient Prov", flowType: "api_key", authenticated: true, ambient: true, configured: true },
        { id: "p-env", name: "Env Prov", flowType: "api_key", authenticated: true, configured: true, source: "environment", envVar: "ENV_PROV_KEY" },
        { id: "p-runtime", name: "Runtime Prov", flowType: "api_key", authenticated: true, configured: true, source: "runtime" },
        { id: "p-mjk", name: "MJK Prov", flowType: "api_key", authenticated: true, configured: true, source: "models_json_key" },
      ],
    };
    const { c } = await renderSection(script);

    const byId = (id: string) => rows(c).find((r) => r.getAttribute("data-row-id") === id);
    await waitFor(() => expect(rows(c)).toHaveLength(6));
    expect(badgeOf(byId("p-oauth")!)).toBe("Subscription");
    expect(badgeOf(byId("p-key")!)).toBe("API key");
    expect(badgeOf(byId("p-ambient")!)).toBe("Environment");
    expect(badgeOf(byId("p-env")!)).toBe("Environment");
    expect(badgeOf(byId("p-runtime")!)).toBe("API key");
    expect(badgeOf(byId("p-mjk")!)).toBe("API key");
  });

  it("an Environment row names its envVar and offers no Remove", async () => {
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      statuses: [
        { id: "p-env", name: "Env Prov", flowType: "api_key", authenticated: true, configured: true, source: "environment", envVar: "ENV_PROV_KEY" },
      ],
    };
    const { c } = await renderSection(script);
    await waitFor(() => expect(rows(c)).toHaveLength(1));
    expect(rows(c)[0].textContent).toContain("ENV_PROV_KEY");
    expect(rows(c)[0].textContent).not.toMatch(/remove/i);
  });

  it("an ambient row without a known envVar names the ambient mechanism, never an empty variable", async () => {
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      statuses: [
        { id: "p-ambient", name: "Ambient Prov", flowType: "api_key", authenticated: true, ambient: true, configured: true },
      ],
    };
    const { c } = await renderSection(script);
    await waitFor(() => expect(rows(c)).toHaveLength(1));
    const text = rows(c)[0].textContent ?? "";
    expect(badgeOf(rows(c)[0])).toBe("Environment");
    expect(text).toMatch(/application default credentials/i);
    expect(text).not.toContain("()");
  });

  it("a stored key takes precedence over ambient — the row renders as an API-key row", async () => {
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      statuses: [
        { id: "p-both", name: "Both Prov", flowType: "api_key", authenticated: true, ambient: true, maskedKey: "sk-…stored", configured: true },
      ],
    };
    const { c } = await renderSection(script);
    await waitFor(() => expect(rows(c)).toHaveLength(1));
    expect(badgeOf(rows(c)[0])).toBe("API key");
    expect(rows(c)[0].textContent).toContain("sk-…stored");
  });
});

// ── E8 — the custom-endpoint configured predicate ────────────────────────────

describe("custom-endpoint configured predicate (E8)", () => {
  const ENTRIES = {
    "a-empty": { baseUrl: "http://x/v1", apiKey: "", api: "openai-completions" },
    "b-unset": { baseUrl: "http://x/v1", apiKey: "$UNSET", api: "openai-completions" },
    "c-set": { baseUrl: "http://x/v1", apiKey: "$SET", api: "openai-completions" },
    "d-literal": { baseUrl: "http://x/v1", apiKey: "***", api: "openai-completions" },
  };

  it("the pure predicate lists ✗ ✗ ✓ ✓ across the four key forms", () => {
    process.env.SET = "sk-x";
    try {
      expect(customEndpointConfigured(ENTRIES["a-empty"])).toBe(false);
      expect(customEndpointConfigured(ENTRIES["b-unset"])).toBe(false);
      expect(customEndpointConfigured(ENTRIES["c-set"])).toBe(true);
      expect(customEndpointConfigured(ENTRIES["d-literal"])).toBe(true);
    } finally {
      delete process.env.SET;
    }
  });

  it("the server's apiKeyResolved annotation is authoritative over the local oracle (E8)", () => {
    // No SET in this environment: the absent-annotation oracle would call the
    // reference unresolved — the server's annotation says resolved.
    expect(customEndpointConfigured({ baseUrl: "http://x/v1", apiKey: "$ANNOTATED", apiKeyResolved: true })).toBe(true);
    process.env.SET = "sk-x";
    try {
      // SET present in this environment: the oracle would say resolved — the
      // annotation says not.
      expect(customEndpointConfigured({ baseUrl: "http://x/v1", apiKey: "$SET", apiKeyResolved: false })).toBe(false);
    } finally {
      delete process.env.SET;
    }
  });

  it("renders only the resolvable entries, badged Custom endpoint — never Environment", async () => {
    vi.stubEnv?.("SET", "sk-x");
    process.env.SET = "sk-x";
    const script: FetchScript = { statusGets: 0, providersGets: 0, providers: ENTRIES };
    const { c } = await renderSection(script);

    await waitFor(() => expect(rows(c)).toHaveLength(2));
    for (const row of rows(c)) {
      expect(row.getAttribute("data-row-source")).toBe("custom");
      expect(badgeOf(row)).toBe("Custom endpoint");
      expect(badgeOf(row)).not.toBe("Environment");
    }
    expect(rows(c).map((r) => r.getAttribute("data-row-id")).sort()).toEqual(["c-set", "d-literal"]);
    delete process.env.SET;
  });

  it("a RESOLVED $NAME reference annotated by the server is listed even though no local oracle knows it (E8)", async () => {
    // PROBE_ONLY is deliberately absent from THIS environment: only the
    // server's apiKeyResolved annotation can vouch for the reference.
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      providers: { annotated: { baseUrl: "http://x/v1", apiKey: "$PROBE_ONLY", apiKeyResolved: true, api: "openai-completions" } },
    };
    const { c } = await renderSection(script);
    await waitFor(() => expect(rows(c)).toHaveLength(1));
    expect(rows(c)[0].getAttribute("data-row-id")).toBe("annotated");
    expect(badgeOf(rows(c)[0])).toBe("Custom endpoint");
  });

  it("an UNRESOLVED annotated $NAME reference stays unlisted even when a local oracle would resolve it (E8)", async () => {
    process.env.SET = "sk-x";
    try {
      const script: FetchScript = {
        statusGets: 0,
        providersGets: 0,
        statuses: [],
        providers: { "unset-remote": { baseUrl: "http://x/v1", apiKey: "$SET", apiKeyResolved: false, api: "openai-completions" } },
      };
      const { c } = await renderSection(script);
      await waitFor(() => expect(script.providersGets).toBeGreaterThanOrEqual(1));
      expect(rows(c)).toHaveLength(0);
      // With nothing listed and the catalogue available, the empty state shows.
      await waitFor(() => expect(c.getByTestId("providers-empty")).toBeTruthy());
    } finally {
      delete process.env.SET;
    }
  });
});

// ── E9 — an old server without `configured` must not produce an empty list ──

describe("configured ?? authenticated fallback (E9)", () => {
  it("lists the authenticated rows when `configured` is absent on every row", async () => {
    const statuses = Array.from({ length: 41 }, (_, i) => ({
      id: `prov-${i}`,
      name: `Prov ${i}`,
      flowType: "api_key",
      authenticated: i < 2,
      ...(i < 2 ? { maskedKey: `sk-…${i}` } : {}),
    }));
    const script: FetchScript = { statusGets: 0, providersGets: 0, statuses };
    const { c } = await renderSection(script);

    await waitFor(() => expect(rows(c)).toHaveLength(2));
  });
});

// ── P3 — render cost: the unconfigured never mount a row ────────────────────

describe("configured-only list projection (P3)", () => {
  it("mounts exactly the 6 configured rows of a 41-row status response", async () => {
    const statuses = Array.from({ length: 41 }, (_, i) => ({
      id: `prov-${i}`,
      name: `Prov ${i}`,
      flowType: i % 7 === 0 ? "auth_code" : "api_key",
      authenticated: i < 6,
      configured: i < 6,
      ...(i < 6 ? { maskedKey: `sk-…${i}` } : {}),
    }));
    const script: FetchScript = { statusGets: 0, providersGets: 0, statuses };
    const { c } = await renderSection(script);

    await waitFor(() => expect(rows(c)).toHaveLength(6));
    // No row carries a key input or login button for the unconfigured 35 —
    // the list has no "Add Key" affordance at rest (key entry lives in the
    // Add-provider dialog).
    expect(c.container.querySelectorAll("input[type=password]")).toHaveLength(0);
  });

  it("an unconfigured provider renders no row at all", async () => {
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      statuses: [
        { id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false, configured: false },
        { id: "openai", name: "OpenAI", flowType: "api_key", authenticated: true, maskedKey: "sk-…9f2", configured: true, source: "stored" },
      ],
    };
    const { c } = await renderSection(script);
    await waitFor(() => expect(rows(c)).toHaveLength(1));
    expect(rows(c)[0].getAttribute("data-row-id")).toBe("openai");
    expect(c.container.textContent).not.toContain("Anthropic");
  });
});

// ── D6 / F11 — row identity is (source, id); both rows render ───────────────

describe("dual-source row identity (D6, F11)", () => {
  it("renders an anthropic OAuth row AND an anthropic custom-endpoint row", async () => {
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      statuses: [
        { id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: true, configured: true, source: "stored" },
      ],
      providers: {
        anthropic: { baseUrl: "http://10.0.0.4:8000/v1", apiKey: "***", api: "openai-completions" },
      },
    };
    const { c } = await renderSection(script);

    await waitFor(() => expect(rows(c)).toHaveLength(2));
    const authRow = rows(c).find((r) => r.getAttribute("data-row-source") === "auth");
    const customRow = rows(c).find((r) => r.getAttribute("data-row-source") === "custom");
    expect(authRow!.getAttribute("data-row-id")).toBe("anthropic");
    expect(badgeOf(authRow!)).toBe("Subscription");
    expect(customRow!.getAttribute("data-row-id")).toBe("anthropic");
    expect(badgeOf(customRow!)).toBe("Custom endpoint");
    // Health pills are scoped to custom-endpoint rows only (D8, E17).
    expect(authRow!.querySelector('[data-testid="health-pill"]')).toBeNull();
    expect(customRow!.querySelector('[data-testid="health-pill"]')).toBeTruthy();
  });
});

// ── F7 — catalogue unavailable ≠ nothing configured (D5) ──────────────────

describe("catalogue unavailable (F7, D5)", () => {
  it("renders the scoped notice, keeps the Add control, and suppresses the empty state", async () => {
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      statuses: [
        { id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: true, configured: true, source: "stored" },
      ],
      catalogueReady: false,
    };
    const { c } = await renderSection(script);

    // The subscription row still renders — the notice never replaces the list.
    await waitFor(() => expect(rows(c)).toHaveLength(1));
    expect(c.getByTestId("catalogue-unavailable-notice")).toBeTruthy();
    // The Add control remains — it is the only path to adding a credential.
    expect(c.getByTestId("add-provider-button")).toBeTruthy();
    // The "nothing configured" empty state is suppressed.
    expect(c.queryByTestId("providers-empty")).toBeNull();
  });

  it("suppresses the empty state with no rows at all while the catalogue is unavailable", async () => {
    const script: FetchScript = { statusGets: 0, providersGets: 0, statuses: [], catalogueReady: false };
    const { c } = await renderSection(script);

    await waitFor(() => expect(c.getByTestId("catalogue-unavailable-notice")).toBeTruthy());
    expect(c.queryByTestId("providers-empty")).toBeNull();
    expect(c.getByTestId("add-provider-button")).toBeTruthy();
  });

  it("renders the empty state only when the catalogue is available", async () => {
    const script: FetchScript = { statusGets: 0, providersGets: 0, statuses: [], catalogueReady: true };
    const { c } = await renderSection(script);

    await waitFor(() => expect(c.getByTestId("providers-empty")).toBeTruthy());
    expect(c.queryByTestId("catalogue-unavailable-notice")).toBeNull();
    expect(c.getByTestId("add-provider-button")).toBeTruthy();
  });
});

// ── E17/F10 — health pills scoped to custom endpoints; pending reconcile ──

describe("health pill scope and pending reconcile (E17, F10)", () => {
  it("renders pills on custom-endpoint rows only", async () => {
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      statuses: [
        { id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: true, configured: true, source: "stored" },
        { id: "openai", name: "OpenAI", flowType: "api_key", authenticated: true, maskedKey: "sk-…9f2", configured: true, source: "stored" },
        { id: "vertex", name: "Vertex", flowType: "api_key", authenticated: true, ambient: true, configured: true },
      ],
      providers: { "local-vllm": { baseUrl: "http://x/v1", apiKey: "***", api: "openai-completions" } },
      health: {},
    };
    const { c } = await renderSection(script);

    await waitFor(() => expect(rows(c)).toHaveLength(4));
    const pills = c.container.querySelectorAll('[data-testid="health-pill"]');
    expect(pills).toHaveLength(1);
    expect(pills[0].closest('[data-testid="provider-row"]')!.getAttribute("data-row-source")).toBe("custom");
    // No cached health yet → the neutral register.
    expect(pills[0].getAttribute("data-state")).toBe("not-tested");
  });

  it("a custom-endpoint write shows a pending pill, then reconciles from exactly one health read ~2 s later (F10)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      providers: {},
      providerPatch: () => {
        // The server persists the entry; subsequent GETs return it.
        script.providers = { "local-vllm": { baseUrl: "http://localhost:8000/v1", apiKey: "sk-x", api: "openai-completions" } };
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) } as any);
      },
    };
    const fetchMock = stubFetch(script);
    vi.stubGlobal("fetch", fetchMock);
    const { fireEvent } = await import("@testing-library/react");
    const c = render(<ProviderAuthSection />);

    fireEvent.click(await c.findByTestId("add-provider-button"));
    fireEvent.click(await c.findByText(/custom endpoint/i));
    fireEvent.change(c.getByLabelText(/name/i), { target: { value: "local-vllm" } });
    fireEvent.change(c.getByLabelText(/base url/i), { target: { value: "http://localhost:8000/v1" } });
    fireEvent.change(c.getByLabelText(/api key/i), { target: { value: "sk-x" } });
    fireEvent.click(c.getByTestId("dialog-submit"));

    // The row appears immediately (optimistic) with the pending pill.
    await waitFor(() => expect(rows(c)).toHaveLength(1));
    expect(c.container.querySelector('[data-testid="health-pill"]')!.getAttribute("data-state")).toBe("pending");
    // Let the write-path refresh settle before measuring the reconcile window.
    await waitFor(() => expect(script.providersGets).toBeGreaterThanOrEqual(2));
    const readsBefore = script.providersGets;

    // Exactly one more read, ~2 s after the write response.
    await vi.advanceTimersByTimeAsync(2100);
    await waitFor(() => expect(script.providersGets).toBe(readsBefore + 1));
    // Advance well past the reconcile window: no further reads may fire.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(script.providersGets).toBe(readsBefore + 1);
    vi.useRealTimers();
  });
});

// ── Probe (POST /api/providers/test) + live pill on the custom-endpoint row ──
// Moved from the deleted LlmProviderCard suites (change:
// redesign-providers-settings-page): the Test control now lives in the row's
// edit surface for SAVED providers — the payload carries the provider's name
// and the masked `***` key.

describe("custom-endpoint row Test action (moved from LlmProviderCard)", () => {
  const ENTRY = { baseUrl: "http://10.0.0.4:8000/v1", apiKey: "***", api: "openai-completions" };

  function scriptWithRow(health?: Record<string, any>): FetchScript {
    return { statusGets: 0, providersGets: 0, providers: { "local-vllm": { ...ENTRY } }, health };
  }

  /** Mount a section with the row, intercepting the probe POST separately. */
  async function renderRowWithProbe(script: FetchScript, probe: { calls: any[]; respond?: () => any }) {
    const base = stubFetch(script);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      if (url.includes("/api/providers/test")) {
        probe.calls.push({ url, init });
        const body = probe.respond ? probe.respond() : { ok: true, status: 200, modelCount: 3, sample: ["m1"] };
        // fetchJsonResponse guards on the content-type header.
        return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => body } as any;
      }
      return base(url, init);
    }));
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(c.container.querySelector('[data-testid="provider-row"][data-row-id="local-vllm"]')).toBeTruthy());
    fireEvent.click(c.getByText("Edit"));
    const edit = () => c.getByTestId("custom-endpoint-edit");
    const testButton = () => within(edit()).getByRole("button", { name: "Test" }) as HTMLButtonElement;
    return { c, edit, testButton };
  }

  it("renders a Test control in the edit surface", async () => {
    const { testButton } = await renderRowWithProbe(scriptWithRow(), { calls: [] });
    expect(testButton()).toBeTruthy();
  });

  it("Test is disabled when the base URL is emptied and enabled again with a value", async () => {
    const { c, testButton } = await renderRowWithProbe(scriptWithRow(), { calls: [] });
    expect(testButton().disabled).toBe(false);
    fireEvent.change(c.getByLabelText(/base url/i), { target: { value: "" } });
    expect(testButton().disabled).toBe(true);
    fireEvent.change(c.getByLabelText(/base url/i), { target: { value: "http://10.0.0.9:8000/v1" } });
    expect(testButton().disabled).toBe(false);
  });

  it("Test is disabled when the API key is emptied", async () => {
    const { c, testButton } = await renderRowWithProbe(scriptWithRow(), { calls: [] });
    fireEvent.change(c.getByLabelText(/api key/i), { target: { value: "" } });
    expect(testButton().disabled).toBe(true);
  });

  it("clicking Test POSTs the probe with the SAVED provider's name and masked key, then updates the pill live", async () => {
    const probe = { calls: [] as any[] };
    const { c, testButton } = await renderRowWithProbe(scriptWithRow(), probe);
    fireEvent.click(testButton());
    await waitFor(() => expect(probe.calls).toHaveLength(1));
    const { url, init } = probe.calls[0];
    expect(url).toContain("/api/providers/test");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "local-vllm", baseUrl: "http://10.0.0.4:8000/v1", apiKey: "***", api: "openai-completions" });
    // The ok probe result updates the pill live: green, model count, no error line.
    const pill = await waitFor(() => c.container.querySelector('[data-testid="health-pill"]')!);
    expect(pill.getAttribute("data-state")).toBe("ok");
    expect(pill.textContent).toMatch(/3 models/);
    expect(c.container.querySelector('[data-testid="provider-error-line"]')).toBeNull();
  });

  it("a failed Test updates the pill + error line live OVER the cached health", async () => {
    const probe = { calls: [] as any[], respond: () => ({ ok: false, status: 403, error: "forbidden now" }) };
    const { c, testButton } = await renderRowWithProbe(
      scriptWithRow({ "local-vllm": { ok: true, status: 200, modelCount: 5, testedAt: 1 } }),
      probe,
    );
    // Starts connected from the cached health.
    expect(c.container.querySelector('[data-testid="health-pill"]')!.getAttribute("data-state")).toBe("ok");
    fireEvent.click(testButton());
    const pill = await waitFor(() => c.container.querySelector('[data-testid="health-pill"]')!);
    await waitFor(() => expect(pill.getAttribute("data-state")).toBe("error"));
    expect(pill.textContent).toMatch(/403/);
    expect(c.container.querySelector('[data-testid="provider-error-line"]')!.textContent).toBe("forbidden now");
  });

  it("discarding the edit clears the stale failed-Test result — the pill falls back to cached health", async () => {
    const probe = { calls: [] as any[], respond: () => ({ ok: false, status: 401, error: "bad key" }) };
    const { c, testButton } = await renderRowWithProbe(
      scriptWithRow({ "local-vllm": { ok: true, modelCount: 5, testedAt: 1 } }),
      probe,
    );
    fireEvent.click(testButton());
    await waitFor(() => expect(c.container.querySelector('[data-testid="health-pill"]')!.getAttribute("data-state")).toBe("error"));
    // Discard (Cancel) → the live result is dropped, cached health shows again.
    fireEvent.click(c.getByText("Cancel"));
    const pill = c.container.querySelector('[data-testid="health-pill"]')!;
    expect(pill.getAttribute("data-state")).toBe("ok");
    expect(pill.textContent).toMatch(/5 models/);
    expect(c.container.querySelector('[data-testid="provider-error-line"]')).toBeNull();
  });

  it("does not call the probe when the Test control is disabled", async () => {
    const probe = { calls: [] as any[] };
    const { c, testButton } = await renderRowWithProbe(scriptWithRow(), probe);
    fireEvent.change(c.getByLabelText(/base url/i), { target: { value: "" } });
    fireEvent.click(testButton());
    // Flush microtasks so a (buggy) async call path would have surfaced.
    await act(async () => {});
    expect(probe.calls).toHaveLength(0);
  });
});

// ── F9 — the single dispatch funnel ───────────────────────────────────────────
// Every successful write — from whichever control — dispatches exactly ONE
// provider-auth-event, through the section's single handleChanged funnel.
// A mount dispatches nothing; a failed write dispatches nothing.

/** Hook probe rendering the readiness state for in-DOM assertions. */
function ReadyProbe() {
  const state = useProvidersReady();
  return <div data-testid="providers-ready">{JSON.stringify(state)}</div>;
}

function trackEvents() {
  const events: CustomEvent[] = [];
  const onEvent = (e: Event) => events.push(e as CustomEvent);
  window.addEventListener(PROVIDER_AUTH_EVENT, onEvent);
  return { events, stop: () => window.removeEventListener(PROVIDER_AUTH_EVENT, onEvent) };
}

describe("single dispatch funnel (F9, restated for the dialog-era structure)", () => {
  beforeEach(() => {
    process.env.SET = undefined;
  });

  it("dispatches exactly one event when an api-key write succeeds from the dialog", async () => {
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      statuses: [{ id: "deepseek", name: "DeepSeek", flowType: "api_key", authenticated: false, configured: false }],
    };
    const { events, stop } = trackEvents();
    const fetchMock = stubFetch(script);
    vi.stubGlobal("fetch", fetchMock);
    const { fireEvent } = await import("@testing-library/react");
    const c = render(<ProviderAuthSection />);

    // Open the Add dialog, pick the provider, submit a key.
    fireEvent.click(await c.findByTestId("add-provider-button"));
    const option = await c.findByText("DeepSeek");
    fireEvent.click(option);
    fireEvent.change(await c.findByLabelText(/api key/i), { target: { value: "sk-test-123" } });
    fireEvent.click(c.getByTestId("dialog-submit"));

    await waitFor(() => expect(events).toHaveLength(1));
    stop();
  });

  it("dispatches exactly one event on an OAuth sign-out from the row", async () => {
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      statuses: [{ id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: true, configured: true, source: "stored" }],
    };
    const { events, stop } = trackEvents();
    const { fireEvent } = await import("@testing-library/react");
    const { c } = await renderSection(script);
    const { fireEvent: fe } = await import("@testing-library/react");
    void fe;
    fireEvent.click(await c.findByText("Sign Out"));
    await waitFor(() => expect(events).toHaveLength(1));
    stop();
  });

  it("dispatches exactly one event on a custom-endpoint write and never opens the Save Bar path", async () => {
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      providerPatch: () => Promise.resolve({ ok: true, json: async () => ({ success: true }) } as any),
    };
    const { events, stop } = trackEvents();
    const { fireEvent } = await import("@testing-library/react");
    const fetchMock = stubFetch(script);
    vi.stubGlobal("fetch", fetchMock);
    const c = render(<ProviderAuthSection />);

    fireEvent.click(await c.findByTestId("add-provider-button"));
    fireEvent.click(await c.findByText(/custom endpoint/i));
    fireEvent.change(c.getByLabelText(/name/i), { target: { value: "local-vllm" } });
    fireEvent.change(c.getByLabelText(/base url/i), { target: { value: "http://localhost:8000/v1" } });
    fireEvent.change(c.getByLabelText(/api key/i), { target: { value: "sk-x" } });
    fireEvent.click(c.getByTestId("dialog-submit"));

    await waitFor(() => expect(events).toHaveLength(1));
    stop();
  });

  it("dispatches nothing when the section merely mounts", async () => {
    const script: FetchScript = { statusGets: 0, providersGets: 0, statuses: [] };
    const { events, stop } = trackEvents();
    await renderSection(script);
    expect(events).toHaveLength(0);
    stop();
  });

  it("dispatches nothing on a failed write and keeps the error message", async () => {
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      statuses: [{ id: "deepseek", name: "DeepSeek", flowType: "api_key", authenticated: false, configured: false }],
      apiKeyPut: () => Promise.resolve({ ok: false, json: async () => ({ error: "save failed" }) } as any),
    };
    const { events, stop } = trackEvents();
    const { fireEvent } = await import("@testing-library/react");
    const fetchMock = stubFetch(script);
    vi.stubGlobal("fetch", fetchMock);
    const c = render(<ProviderAuthSection />);

    fireEvent.click(await c.findByTestId("add-provider-button"));
    fireEvent.click(await c.findByText("DeepSeek"));
    fireEvent.change(await c.findByLabelText(/api key/i), { target: { value: "sk-test-123" } });
    fireEvent.click(c.getByTestId("dialog-submit"));

    await waitFor(() => expect(c.getByText("save failed")).toBeTruthy());
    expect(events).toHaveLength(0);
    stop();
  });

  it("keeps the owner callback wired to the funnel (refetchCatalogue contract)", async () => {
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      statuses: [{ id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: true, configured: true, source: "stored" }],
    };
    const { events, stop } = trackEvents();
    const onCredentialsChanged = vi.fn();
    const { fireEvent } = await import("@testing-library/react");
    const { c } = await renderSection(script, onCredentialsChanged);
    fireEvent.click(await c.findByText("Sign Out"));
    await waitFor(() => expect(onCredentialsChanged).toHaveBeenCalledTimes(1));
    expect(events).toHaveLength(1);
    stop();
  });

  it("an api-key removal dispatches and readiness drops (E1 of dispatch-provider-auth-event)", async () => {
    const script: FetchScript = {
      statusGets: 0,
      providersGets: 0,
      statuses: [{ id: "openai", name: "OpenAI", flowType: "api_key", authenticated: true, maskedKey: "sk-…abc", configured: true, source: "stored" }],
      providerDelete: () => {
        script.statuses = [];
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as any);
      },
    };
    const { events, stop } = trackEvents();
    const { fireEvent } = await import("@testing-library/react");
    const fetchMock = stubFetch(script);
    vi.stubGlobal("fetch", fetchMock);
    const c = render(<><ProviderAuthSection /><ReadyProbe /></>);
    const probe = () => JSON.parse(c.getByTestId("providers-ready").textContent!);
    await waitFor(() => expect(probe().ready).toBe(true));
    fireEvent.click(c.getByText("Remove"));
    await waitFor(() => expect(probe().ready).toBe(false));
    expect(events).toHaveLength(1);
    stop();
  });
});
