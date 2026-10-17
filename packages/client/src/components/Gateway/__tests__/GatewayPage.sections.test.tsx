/**
 * GatewayPage gains the sections that lived only in the deleted GatewayDialog:
 * readiness board (with Make-primary), reserved name, degraded banner.
 * Test-plan #F11. See change: add-remote-access-wizard (design D2).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayPage } from "../GatewayPage.js";

vi.mock("wouter", () => ({ useLocation: () => ["/settings/gateway", vi.fn()] }));
vi.mock("../GatewayPairQR.js", () => ({ GatewayPairQR: () => null }));
vi.mock("../GatewayEndpoints.js", () => ({ GatewayEndpoints: () => null }));
vi.mock("../GatewayUrlManager.js", () => ({ GatewayUrlManager: () => null }));
vi.mock("../GatewayConnectToggle.js", () => ({ GatewayConnectToggle: () => null }));
vi.mock("../GatewaySetupGuide.js", () => ({ GatewaySetupGuide: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const jsonRes = (body: unknown) =>
  ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body }) as Response;

describe("GatewayPage sections", () => {
  it("F11: readiness rows, Make-primary, reserved-name input and degraded banner are present", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("/api/tunnel-readiness")) {
        return jsonRes({
          success: true,
          data: {
            providers: [
              { provider: "zrok", state: "connected", endpoints: [{ kind: "public", url: "https://robson-home.shares.zrok.io", tls: true }] },
              { provider: "tailscale", state: "connected", endpoints: [{ kind: "public", url: "https://ts.example.com", tls: true }] },
            ],
          },
        });
      }
      if (u.includes("/api/tunnel-status-detail")) {
        return jsonRes({
          status: "active",
          url: "https://tmp.shares.zrok.io",
          serverOs: "darwin",
          connectedProviders: ["zrok", "tailscale"],
          degraded: { configuredName: "robson-home", effectiveName: "tmp" },
        });
      }
      if (u.includes("/api/config")) {
        return jsonRes({
          success: true,
          data: { tunnel: { provider: "zrok", mode: "public", zrok: { reservedName: "robson-home", persistent: true } }, gateways: [] },
        });
      }
      return jsonRes({ success: true, data: {} });
    }) as typeof fetch);

    render(<GatewayPage />);

    expect(await screen.findByTestId("gateway-readiness-tailscale")).toBeDefined();
    expect(screen.getByTestId("gateway-readiness-zrok")).toBeDefined();
    expect(await screen.findByTestId("gateway-make-primary-tailscale")).toBeDefined();
    expect(await screen.findByTestId("gateway-degraded-banner")).toBeDefined();
    expect(await screen.findByTestId("gateway-reserved-input")).toBeDefined();
  });
});
