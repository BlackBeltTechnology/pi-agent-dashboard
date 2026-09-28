import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayReadinessBoard } from "../GatewayReadinessBoard.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockReadiness(approvalUrl?: string) {
  vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
    const json = url.toString().includes("/api/tunnel-readiness")
      ? {
          success: true,
          data: {
            providers: [
              {
                provider: "tailscale",
                state: "connected",
                endpoints: [{ kind: "mesh", url: "http://100.97.246.31:8000", tls: false }],
                ...(approvalUrl ? { approvalUrl } : {}),
              },
            ],
          },
        }
      : { success: true, data: {} };
    return { ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => json } as Response;
  }) as typeof fetch);
}

describe("GatewayReadinessBoard — admin approval gate", () => {
  it("links to the tailnet approval page when Serve is not enabled", async () => {
    mockReadiness("https://login.tailscale.com/f/serve?node=X");
    render(<GatewayReadinessBoard open primary="zrok" />);
    const link = (await screen.findByTestId("gateway-readiness-tailscale-approval")) as HTMLAnchorElement;
    expect(link.href).toBe("https://login.tailscale.com/f/serve?node=X");
    expect(link.target).toBe("_blank");
    expect(link.rel).toMatch(/noopener/);
  });

  it("renders no link for a non-allowlisted URL", async () => {
    mockReadiness("https://evil.example/f/serve");
    render(<GatewayReadinessBoard open primary="zrok" />);
    await screen.findByTestId("gateway-readiness-tailscale");
    expect(screen.queryByTestId("gateway-readiness-tailscale-approval")).toBeNull();
  });
});
