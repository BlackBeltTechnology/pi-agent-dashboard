import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayEndpoints } from "../GatewayEndpoints.js";
import { GatewayProviderSection } from "../GatewayProviderSection.js";
import { GatewaySetupGuide } from "../GatewaySetupGuide.js";

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

  it("PUTs the FULL pairing object (read-modify-write) when adding an https URL", async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.endsWith("/api/config") && init?.method === "PUT") {
        return { ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ success: true }) } as Response;
      }
      if (url.endsWith("/api/config")) {
        // GET current config — has a sibling pairing field that must survive.
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ success: true, data: { pairing: { publicBaseUrls: [], enabled: true } } }),
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
      const body = put?.body as { pairing: { publicBaseUrls: string[]; enabled?: boolean } };
      expect(body.pairing.publicBaseUrls).toContain("https://new.example");
      // Sibling field preserved (full-object write, not shallow clobber).
      expect(body.pairing.enabled).toBe(true);
    });
  });
});
