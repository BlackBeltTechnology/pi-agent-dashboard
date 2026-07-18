import { describe, expect, it } from "vitest";
import { isCorsOriginAllowed } from "../auth/cors-origin.js";

/**
 * Tests the REAL CORS origin decision (`cors-origin.ts`), imported directly —
 * no hand-mirrored copy to drift out of sync. `server.ts` calls the same
 * function, so these assertions pin the exact production behavior.
 */

function allowed(
  origin: string | undefined,
  opts: { configured?: string[]; trusted?: string[]; tunnelUrl?: string | null } = {},
): boolean {
  return isCorsOriginAllowed(origin, {
    configuredOrigins: opts.configured ?? [],
    trustedNetworks: opts.trusted ?? [],
    getTunnelUrl: () => opts.tunnelUrl ?? null,
  });
}

describe("CORS origin validation", () => {
  it("allows requests with no origin (same-origin)", () => {
    expect(allowed(undefined)).toBe(true);
  });

  it("allows localhost on any port", () => {
    expect(allowed("http://localhost:3000")).toBe(true);
    expect(allowed("http://localhost:5173")).toBe(true);
    expect(allowed("https://localhost:8443")).toBe(true);
  });

  it("allows 127.0.0.1 on any port", () => {
    expect(allowed("http://127.0.0.1:3000")).toBe(true);
  });

  it("allows configured origins", () => {
    expect(allowed("https://dashboard.example.com", { configured: ["https://dashboard.example.com"] })).toBe(true);
  });

  it("allows the neutral static PWA shell", () => {
    expect(allowed("https://pi-dashboard.dev")).toBe(true);
  });

  it("rejects the opaque `Origin: null` (sandboxed live-server iframe, D7)", () => {
    expect(allowed("null")).toBe(false);
    // Even if someone mis-configured it, the explicit guard wins.
    expect(allowed("null", { configured: ["null"] })).toBe(false);
  });

  it("rejects unknown origins", () => {
    expect(allowed("https://evil.example.com")).toBe(false);
    expect(allowed("https://evil.example.com", { configured: ["https://good.example.com"] })).toBe(false);
  });

  it("rejects non-localhost remote origins without config", () => {
    expect(allowed("http://192.168.1.100:3000")).toBe(false);
  });

  describe("zrok tunnel origins (browser module-script regression)", () => {
    it("allows the currently-active tunnel URL", () => {
      const tunnelUrl = "https://cwanni9wce66.share.zrok.io";
      expect(allowed(tunnelUrl, { tunnelUrl })).toBe(true);
    });

    it("allows any *.share.zrok.io origin (URL rotation, stale tabs)", () => {
      expect(allowed("https://tgbdzzvlar6b.share.zrok.io")).toBe(true);
      expect(allowed("https://anyothershare123.share.zrok.io")).toBe(true);
    });

    it("does not allow non-zrok sibling hosts", () => {
      expect(allowed("https://share.zrok.io.attacker.com")).toBe(false);
      expect(allowed("https://evil.io")).toBe(false);
    });
  });

  // Trusted-network origins for LAN-to-LAN switching.
  // See change: fix-remote-connect-cors-gates.
  describe("trusted-network origins (LAN-to-LAN switching)", () => {
    it("allows an origin whose host is in a trusted CIDR", () => {
      expect(allowed("http://192.168.16.242:8000", { trusted: ["192.168.16.0/24"] })).toBe(true);
    });

    it("allows an exact-IP trusted entry", () => {
      expect(allowed("http://10.0.0.5:8000", { trusted: ["10.0.0.5"] })).toBe(true);
    });

    it("allows a wildcard trusted entry", () => {
      expect(allowed("http://192.168.7.31:8000", { trusted: ["192.168.*.*"] })).toBe(true);
    });

    it("rejects an origin host NOT in any trusted network", () => {
      expect(allowed("http://192.168.99.5:8000", { trusted: ["192.168.16.0/24"] })).toBe(false);
    });

    it("preserves the null-origin refusal even with a permissive trusted network", () => {
      expect(allowed("null", { trusted: ["0.0.0.0/0"] })).toBe(false);
    });

    it("empty trusted networks preserves prior behavior (LAN origin denied)", () => {
      expect(allowed("http://192.168.16.242:8000", { trusted: [] })).toBe(false);
    });

    it("does not treat a DNS hostname as a trusted-network match", () => {
      // isBypassedHost matches IPs; a DNS name in a trusted CIDR does not match.
      expect(allowed("http://myhost.local:8000", { trusted: ["192.168.16.0/24"] })).toBe(false);
    });
  });
});
