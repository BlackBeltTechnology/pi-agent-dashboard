import { describe, expect, it } from "vitest";
import {
  PROVIDER_KIND,
  PROVIDER_MODES,
  providerSupportsMode,
  type TunnelEndpoint,
  type TunnelProvider,
} from "../tunnel-provider.js";

describe("tunnel-provider types + capability matrix", () => {
  it("exports the provider mode matrix with the four providers", () => {
    expect(Object.keys(PROVIDER_MODES).sort()).toEqual(["ngrok", "tailscale", "zerotier", "zrok"]);
  });

  it("public-only providers reject private", () => {
    expect(providerSupportsMode("zrok", "public")).toBe(true);
    expect(providerSupportsMode("zrok", "private")).toBe(false);
    expect(providerSupportsMode("ngrok", "public")).toBe(true);
    expect(providerSupportsMode("ngrok", "private")).toBe(false);
  });

  it("zerotier is private-only", () => {
    expect(providerSupportsMode("zerotier", "private")).toBe(true);
    expect(providerSupportsMode("zerotier", "public")).toBe(false);
  });

  it("tailscale supports both modes", () => {
    expect(providerSupportsMode("tailscale", "public")).toBe(true);
    expect(providerSupportsMode("tailscale", "private")).toBe(true);
  });

  it("child vs daemon kind is fixed per provider", () => {
    expect(PROVIDER_KIND.zrok).toBe("child");
    expect(PROVIDER_KIND.ngrok).toBe("child");
    expect(PROVIDER_KIND.tailscale).toBe("daemon");
    expect(PROVIDER_KIND.zerotier).toBe("daemon");
  });

  it("interface shape is implementable (compile-time smoke)", () => {
    const ep: TunnelEndpoint = { kind: "public", url: "https://x.example", tls: true };
    const fake: TunnelProvider = {
      id: "zrok",
      kind: "child",
      supportsMode: (m) => providerSupportsMode("zrok", m),
      detectBinary: () => true,
      isEnrolled: () => true,
      connect: async () => ({ endpoints: [ep] }),
      disconnect: async () => {},
      status: () => ({ active: true, endpoints: [ep] }),
    };
    expect(fake.id).toBe("zrok");
    expect(fake.supportsMode("private")).toBe(false);
  });
});
