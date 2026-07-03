import { describe, it, expect } from "vitest";

/**
 * Unit tests for CORS origin validation logic.
 * Mirrors the callback used in server.ts — kept in sync by hand. The tunnel
 * URL is injected via a thunk so tests can simulate an active tunnel without
 * importing the full server.
 */

function isAllowedOrigin(
  origin: string | undefined,
  configuredOrigins: string[],
  getTunnelUrl: () => string | null = () => null,
): boolean {
  if (!origin) return true;
  // Opaque-origin sandboxed iframe (live-server, D7) → reject.
  if (origin === "null") return false;
  try {
    const u = new URL(origin);
    const host = u.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
      return true;
    }
    const tunnelUrl = getTunnelUrl();
    if (tunnelUrl && origin === tunnelUrl) return true;
    if (host.endsWith(".share.zrok.io")) return true;
  } catch { /* ignore */ }
  return configuredOrigins.includes(origin);
}

describe("CORS origin validation", () => {
  it("allows requests with no origin (same-origin)", () => {
    expect(isAllowedOrigin(undefined, [])).toBe(true);
  });

  it("allows localhost on any port", () => {
    expect(isAllowedOrigin("http://localhost:3000", [])).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173", [])).toBe(true);
    expect(isAllowedOrigin("https://localhost:8443", [])).toBe(true);
  });

  it("allows 127.0.0.1 on any port", () => {
    expect(isAllowedOrigin("http://127.0.0.1:3000", [])).toBe(true);
  });

  it("allows configured origins", () => {
    const configured = ["https://dashboard.example.com"];
    expect(isAllowedOrigin("https://dashboard.example.com", configured)).toBe(true);
  });

  it("rejects the opaque `Origin: null` (sandboxed live-server iframe, D7)", () => {
    expect(isAllowedOrigin("null", [])).toBe(false);
    // Even if someone mis-configured it, the explicit guard wins.
    expect(isAllowedOrigin("null", ["null"])).toBe(false);
  });

  it("rejects unknown origins", () => {
    expect(isAllowedOrigin("https://evil.example.com", [])).toBe(false);
    expect(isAllowedOrigin("https://evil.example.com", ["https://good.example.com"])).toBe(false);
  });

  it("rejects non-localhost remote origins without config", () => {
    expect(isAllowedOrigin("http://192.168.1.100:3000", [])).toBe(false);
  });

  // Regression: Vite emits `<script type="module" crossorigin>` which makes
  // browsers send CORS-mode requests even same-origin. When the dashboard is
  // served through a zrok tunnel the Origin header is the tunnel URL, which
  // previously wasn't in the allow list — the server then threw inside the
  // CORS callback, surfacing as HTTP 500 on every asset. These tests pin the
  // fix so that behavior cannot regress.
  describe("zrok tunnel origins (browser module-script regression)", () => {
    it("allows the currently-active tunnel URL", () => {
      const tunnelUrl = "https://cwanni9wce66.share.zrok.io";
      expect(isAllowedOrigin(tunnelUrl, [], () => tunnelUrl)).toBe(true);
    });

    it("allows any *.share.zrok.io origin (URL rotation, stale tabs)", () => {
      expect(isAllowedOrigin("https://tgbdzzvlar6b.share.zrok.io", [])).toBe(true);
      expect(isAllowedOrigin("https://anyothershare123.share.zrok.io", [])).toBe(true);
    });

    it("does not allow non-zrok sibling hosts", () => {
      expect(isAllowedOrigin("https://share.zrok.io.attacker.com", [])).toBe(false);
      expect(isAllowedOrigin("https://evil.io", [])).toBe(false);
    });
  });
});
