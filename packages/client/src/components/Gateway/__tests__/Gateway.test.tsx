import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  // The Gateway page embeds the guide AND mounts the manager itself, so the
  // guide must be suppressible or the page renders the control twice.
  it("F12: the guide suppresses its copy when the host already mounts one", () => {
    mockConfig({});
    render(<GatewaySetupGuide provider="zrok" showGatewayUrls={false} />);
    expect(screen.queryByTestId("gateway-url-manager")).toBeNull();
  });
});
