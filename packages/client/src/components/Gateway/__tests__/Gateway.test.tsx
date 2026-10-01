import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayConnectToggle } from "../GatewayConnectToggle.js";
import { GatewayEndpoints } from "../GatewayEndpoints.js";
import { GatewayProviderSection } from "../GatewayProviderSection.js";
import { GatewaySetupGuide } from "../GatewaySetupGuide.js";
import { GatewayUrlManager } from "../GatewayUrlManager.js";

vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GatewayProviderSection (9.1 render in isolation)", () => {
  it("renders providers + gates modes by the provider matrix", () => {
    const onChange = vi.fn();
    render(<GatewayProviderSection provider="zrok" mode="public" onChange={onChange} />);
    expect(screen.getByTestId("gateway-provider-zrok")).toBeDefined();
    // zrok is public-only → private mode disabled.
    expect((screen.getByTestId("gateway-mode-private") as HTMLButtonElement).disabled).toBe(true);
  });

  it("auto-selects a valid mode when switching to a provider that lacks the current mode", () => {
    const onChange = vi.fn();
    // Start tailscale/private, switch to ngrok (public-only) → mode must flip to public.
    render(<GatewayProviderSection provider="tailscale" mode="private" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("gateway-provider-ngrok"));
    expect(onChange).toHaveBeenCalledWith({ provider: "ngrok", mode: "public" });
  });
});

describe("GatewaySetupGuide (9.1 render in isolation)", () => {
  it("renders the provider's steps with a server-side security note", () => {
    render(<GatewaySetupGuide provider="tailscale" />);
    expect(screen.getByTestId("gateway-setup-guide")).toBeDefined();
    expect(screen.getAllByTestId("gateway-setup-run").length).toBeGreaterThan(0);
  });
});

describe("GatewayEndpoints (task 6.4 Add HTTPS round-trip)", () => {
  const eps: TunnelEndpoint[] = [
    { kind: "public", url: "https://a.example", tls: true },
    { kind: "mesh", url: "http://100.101.22.7:8000", tls: false },
  ];

  it("renders tagged endpoints with TLS / no-TLS badges", () => {
    render(<GatewayEndpoints endpoints={eps} />);
    const rows = screen.getAllByTestId("gateway-endpoint");
    expect(rows.length).toBe(2);
    expect(screen.getByText("TLS")).toBeDefined();
    expect(screen.getByText("no TLS")).toBeDefined();
  });

  it("rejects a plain-http entry client-side (task 6.5 UX gate)", async () => {
    render(<GatewayEndpoints endpoints={eps} />);
    fireEvent.change(screen.getByTestId("gateway-add-https-input"), {
      target: { value: "http://192.168.1.10:8000" },
    });
    fireEvent.click(screen.getByTestId("gateway-add-https-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("gateway-add-https-error").textContent).toMatch(/https|wss/i);
    });
  });

  it("PUTs the top-level publicBaseUrls list, seeded from the legacy pairing key", async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.endsWith("/api/config") && init?.method === "PUT") {
        return { ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ success: true }) } as Response;
      }
      if (url.endsWith("/api/config")) {
        // GET current config — legacy-only shape; its entries must be seeded
        // into the first top-level write, not orphaned.
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            success: true,
            data: { pairing: { publicBaseUrls: ["https://legacy.example"], enabled: true } },
          }),
        } as Response;
      }
      // endpoints refetch
      return {
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ success: true, data: { endpoints: eps } }),
      } as Response;
    }) as typeof fetch);

    render(<GatewayEndpoints />);
    fireEvent.change(await screen.findByTestId("gateway-add-https-input"), {
      target: { value: "https://new.example" },
    });
    fireEvent.click(screen.getByTestId("gateway-add-https-btn"));

    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT");
      expect(put).toBeDefined();
      const body = put?.body as { publicBaseUrls: string[]; pairing?: unknown };
      expect(body.publicBaseUrls).toEqual(["https://legacy.example", "https://new.example"]);
      // The legacy nested object is left untouched by the write.
      expect(body.pairing).toBeUndefined();
    });
  });
});

// ── The "add a gateway URL" action (D12/D13) ────────────────────────────────
// The config algebra is unit-tested in `lib/__tests__/gateway-action.test.ts`;
// these pin the rendered surface: the inline rules, the disabled save, the
// status row, and that BOTH entry points render the same component.
// Test plan rows: G13 (UI half), G19, F12 (component half).
// See change: config-override-oauth-redirect-base.
describe("GatewayUrlManager", () => {
  function mockConfig(data: Record<string, unknown>) {
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string, init?: RequestInit) => {
      const json = url.toString().endsWith("/api/config") && init?.method !== "PUT"
        ? { success: true, data }
        : { success: true };
      return { ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => json } as Response;
    }) as typeof fetch);
  }

  it("G13: disables OAuth and QR for a http:// URL and states why", async () => {
    mockConfig({});
    render(<GatewayUrlManager />);
    fireEvent.click(await screen.findByTestId("gateway-url-add-open"));
    fireEvent.change(screen.getByTestId("gateway-url-input"), {
      target: { value: "http://10.4.0.9:8000" },
    });
    await waitFor(() => {
      expect((screen.getByTestId("gateway-url-mode-oauth") as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByTestId("gateway-url-mode-pairing") as HTMLInputElement).disabled).toBe(true);
    });
    expect(screen.getByTestId("gateway-url-mode-oauth-reason").textContent).toMatch(/non-TLS/i);
    // No auth mode picked yet → save refused.
    expect((screen.getByTestId("gateway-url-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("G13: enables save once a trusted network is stated for a http:// URL", async () => {
    mockConfig({});
    render(<GatewayUrlManager />);
    fireEvent.click(await screen.findByTestId("gateway-url-add-open"));
    fireEvent.change(screen.getByTestId("gateway-url-input"), {
      target: { value: "http://10.4.0.9:8000" },
    });
    fireEvent.click(screen.getByTestId("gateway-url-mode-trusted-network"));
    await waitFor(() => {
      // G18: the CIDR field is prefilled with the exact host, never a subnet.
      expect((screen.getByTestId("gateway-url-cidr") as HTMLInputElement).value).toBe("10.4.0.9");
      expect((screen.getByTestId("gateway-url-save") as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it("opening Add gateway defaults to the live tailscale MagicDNS URL + exact mesh host", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      const json = url.toString().endsWith("/api/tunnel-readiness")
        ? {
            success: true,
            data: {
              providers: [
                {
                  provider: "tailscale",
                  state: "connected",
                  endpoints: [
                    { kind: "magicdns", url: "http://box.tail1.ts.net:8000", tls: false },
                    { kind: "mesh", url: "http://100.97.246.31:8000", tls: false },
                  ],
                },
              ],
            },
          }
        : { success: true, data: {} };
      return { ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => json } as Response;
    }) as typeof fetch);
    render(<GatewayUrlManager />);
    fireEvent.click(await screen.findByTestId("gateway-url-add-open"));
    await waitFor(() => {
      expect((screen.getByTestId("gateway-url-input") as HTMLInputElement).value).toBe("http://box.tail1.ts.net:8000");
      expect((screen.getByTestId("gateway-url-mode-trusted-network") as HTMLInputElement).checked).toBe(true);
      expect((screen.getByTestId("gateway-url-cidr") as HTMLInputElement).value).toBe("100.97.246.31");
      expect((screen.getByTestId("gateway-url-save") as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it("G19: renders the computed status for a drifted gateway and offers Fix", async () => {
    mockConfig({
      publicBaseUrls: ["https://pi.example.com"],
      cors: { allowedOrigins: [] },
      gateways: [
        {
          url: "https://pi.example.com",
          authModes: ["pairing"],
          wrote: {
            publicBaseUrls: ["https://pi.example.com"],
            corsAllowedOrigins: ["https://pi.example.com"],
          },
        },
      ],
    });
    render(<GatewayUrlManager />);
    const row = await screen.findByTestId("gateway-url-row");
    expect(row.getAttribute("data-status")).toBe("incomplete");
    expect(screen.getByTestId("gateway-url-fix")).toBeDefined();
  });

  it("F12: the first-run guide renders the same manager as the Gateway page", async () => {
    mockConfig({});
    render(<GatewaySetupGuide provider="zrok" />);
    expect(await screen.findByTestId("gateway-url-manager")).toBeDefined();
  });

  // test-plan #F8 — the Host admitted pill follows the live derived hosts
  // (publicBaseUrls ∪ cors.allowedOrigins), independent of data-status: an
  // incomplete row whose public base URL is intact still carries it, and a
  // row whose public URL is the missing delta does not.
  // See change: add-host-allowlist-admission.
  it("F8: Host admitted pill follows the live derived hosts, not data-status", async () => {
    mockConfig({
      publicBaseUrls: ["https://pi.example.com", "https://intact.example"],
      cors: { allowedOrigins: ["https://pi.example.com"] },
      gateways: [
        {
          url: "https://pi.example.com",
          authModes: ["pairing"],
          wrote: { publicBaseUrls: ["https://pi.example.com"], corsAllowedOrigins: ["https://pi.example.com"] },
        },
        {
          url: "https://missing.example",
          authModes: ["pairing"],
          wrote: { publicBaseUrls: ["https://missing.example"], corsAllowedOrigins: ["https://missing.example"] },
        },
        {
          url: "https://intact.example",
          authModes: ["trusted-network"],
          wrote: { publicBaseUrls: ["https://intact.example"], trustedNetworks: ["10.4.0.9"] },
        },
      ],
    });
    render(<GatewayUrlManager />);
    const rows = await screen.findAllByTestId("gateway-url-row");

    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["ok", "incomplete", "incomplete"]);

    const pills = rows.map((r) => r.querySelector('[data-testid="gateway-host-admitted"]'));
    expect(pills[0], "ok row in publicBaseUrls carries the pill").not.toBeNull();
    expect(pills[1], "incomplete row with the public URL missing has no pill").toBeNull();
    expect(pills[2], "incomplete row with an intact public URL still carries the pill").not.toBeNull();

    // Informational only: never a control, title names the hostname.
    for (const pill of [pills[0]!, pills[2]!]) {
      expect(pill.getAttribute("role")).toBeNull();
      expect(pill.closest("button")).toBeNull();
      expect(pill.textContent).toBe("Host admitted");
    }
    expect(pills[0]!.getAttribute("title")).toContain("pi.example.com");
    expect(pills[2]!.getAttribute("title")).toContain("intact.example");
  });

  // The Gateway page embeds the guide AND mounts the manager itself, so the
  // guide must be suppressible or the page renders the control twice.
  it("F12: the guide suppresses its copy when the host already mounts one", () => {
    mockConfig({});
    render(<GatewaySetupGuide provider="zrok" showGatewayUrls={false} />);
    expect(screen.queryByTestId("gateway-url-manager")).toBeNull();
  });
});

describe("GatewayConnectToggle", () => {
  function mockServer(initial: string[]) {
    let connected = initial;
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      const u = url.toString();
      let json: unknown = { ok: true };
      if (u.endsWith("/api/tunnel-connect")) { calls.push("connect"); connected = ["zrok", "tailscale"]; }
      else if (u.endsWith("/api/tunnel-disconnect")) { calls.push("disconnect"); connected = []; }
      else if (u.endsWith("/api/tunnel-status-detail")) json = { status: connected.length ? "active" : "inactive", url: "https://x", serverOs: "darwin", connectedProviders: connected };
      return { ok: true, json: async () => json } as Response;
    }) as typeof fetch);
    return calls;
  }

  it("shows Connect when nothing is connected, and flips to Disconnect after connecting", async () => {
    const calls = mockServer([]);
    const onChanged = vi.fn();
    render(<GatewayConnectToggle onChanged={onChanged} />);
    fireEvent.click(await screen.findByTestId("gateway-connect"));
    expect(await screen.findByTestId("gateway-disconnect")).toBeDefined();
    expect(screen.getByTestId("gateway-connect-state").textContent).toMatch(/zrok, tailscale/);
    expect(calls).toEqual(["connect"]);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("shows Disconnect when connected, and flips back to Connect after disconnecting", async () => {
    const calls = mockServer(["zrok"]);
    render(<GatewayConnectToggle />);
    fireEvent.click(await screen.findByTestId("gateway-disconnect"));
    expect(await screen.findByTestId("gateway-connect")).toBeDefined();
    expect(screen.getByTestId("gateway-connect-state").textContent).toMatch(/Not connected/);
    expect(calls).toEqual(["disconnect"]);
  });

  it("surfaces the server's connect failure inline", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      const json = url.toString().endsWith("/api/tunnel-connect")
        ? { ok: false, error: "zrok not installed" }
        : { status: "inactive", serverOs: "darwin", connectedProviders: [] };
      return { ok: true, json: async () => json } as Response;
    }) as typeof fetch);
    render(<GatewayConnectToggle />);
    fireEvent.click(await screen.findByTestId("gateway-connect"));
    expect((await screen.findByTestId("gateway-connect-error")).textContent).toMatch(/zrok not installed/);
  });

  it("disables Connect with a reason while provider edits are unsaved", async () => {
    mockServer([]);
    render(<GatewayConnectToggle dirty />);
    const btn = (await screen.findByTestId("gateway-connect")) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(true));
    expect(btn.title).toMatch(/save/i);
  });
});

describe("GatewayConnectToggle — per-provider status + live refresh", () => {
  const partial = {
    status: "inactive",
    serverOs: "darwin",
    connectedProviders: ["tailscale"],
    providers: [
      { provider: "zrok", primary: true, state: "failed", error: "POST /share 500 shareInternalServerError" },
      { provider: "tailscale", primary: false, state: "connected" },
    ],
  };

  it("lists each provider with its state and the real failure reason", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => ({ ok: true, json: async () => partial }) as Response) as typeof fetch);
    render(<GatewayConnectToggle />);
    expect((await screen.findByTestId("gateway-provider-row-zrok")).textContent).toMatch(/failed.*500 shareInternalServerError/i);
    expect(screen.getByTestId("gateway-provider-row-zrok").getAttribute("data-state")).toBe("failed");
    expect(screen.getByTestId("gateway-provider-row-tailscale").textContent).toMatch(/connected/i);
    expect(screen.getByTestId("gateway-connect-toggle").getAttribute("data-partial")).toBe("true");
  });

  it("re-polls every 5s so a drop shows without clicking", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let body: unknown = { status: "active", url: "https://x", serverOs: "d", connectedProviders: ["zrok"], providers: [{ provider: "zrok", primary: true, state: "connected" }] };
      vi.spyOn(globalThis, "fetch").mockImplementation((async () => ({ ok: true, json: async () => body }) as Response) as typeof fetch);
      render(<GatewayConnectToggle />);
      await screen.findByTestId("gateway-disconnect");
      body = { status: "inactive", serverOs: "d", connectedProviders: [], providers: [{ provider: "zrok", primary: true, state: "dropped", error: "tunnel process exited unexpectedly (code 1)" }] };
      await vi.advanceTimersByTimeAsync(5_100);
      expect(await screen.findByTestId("gateway-connect")).toBeDefined();
      expect(screen.getByTestId("gateway-provider-row-zrok").textContent).toMatch(/dropped.*exited unexpectedly/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the server's real connect error text", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      const json = url.toString().endsWith("/api/tunnel-connect")
        ? { ok: false, error: "zrok: POST /share 500 shareInternalServerError" }
        : { status: "inactive", serverOs: "darwin", connectedProviders: [], providers: [] };
      return { ok: true, json: async () => json } as Response;
    }) as typeof fetch);
    render(<GatewayConnectToggle />);
    fireEvent.click(await screen.findByTestId("gateway-connect"));
    expect((await screen.findByTestId("gateway-connect-error")).textContent).toBe("zrok: POST /share 500 shareInternalServerError");
  });
});
