/**
 * CORS origin denial -> access-grant registry (server-cors spec "An origin
 * denial may be answered by prompt"; tasks 10.65 precondition).
 * See change: add-access-grant-dialog.
 */
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { CorsOriginOptions } from "../../auth/cors-origin.js";
import { createCorsDenialObserver, deniedCorsOrigin } from "../cors-denial.js";

const OPTS: CorsOriginOptions = { trustedNetworks: [], configuredOrigins: ["https://ok.example.com"] };

describe("deniedCorsOrigin", () => {
  it("names an unknown cross-origin Origin", () => {
    expect(deniedCorsOrigin("https://evil.example.com", "localhost:8000", OPTS)).toBe("https://evil.example.com");
  });

  it("keeps a markup-bearing origin exactly as received", () => {
    const o = "https://<img src=x onerror=alert(1)>.example.com";
    expect(deniedCorsOrigin(o, "localhost:8000", OPTS)).toBe(o);
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["opaque null (never relaxed, never prompted)", "null"],
    ["loopback", "http://localhost:5173"],
    ["configured", "https://ok.example.com"],
    ["pwa shell", "https://pi-dashboard.dev"],
  ])("is null for %s", (_label, origin) => {
    expect(deniedCorsOrigin(origin, "localhost:8000", OPTS)).toBeNull();
  });

  it("is null for the dashboard's own page served on a LAN name (same-origin by Host)", () => {
    expect(deniedCorsOrigin("http://mac.local:8000", "mac.local:8000", OPTS)).toBeNull();
  });

  it("is null for a repeated (array) Origin header", () => {
    expect(deniedCorsOrigin(["https://a.example.com", "https://b.example.com"], "h", OPTS)).toBeNull();
  });
});

describe("createCorsDenialObserver", () => {
  async function app(onDenied: (origin: string, ip: string) => void) {
    const f = Fastify();
    f.addHook("onRequest", createCorsDenialObserver(() => OPTS, onDenied));
    f.get("/api/x", async () => ({ ok: true }));
    await f.ready();
    return f;
  }

  it("reports the denied origin and the source ip, and never alters the response", async () => {
    const seen = vi.fn();
    const f = await app(seen);
    const res = await f.inject({
      url: "/api/x",
      headers: { origin: "https://evil.example.com", host: "localhost:8000" },
      remoteAddress: "10.1.2.3",
    });
    expect(res.statusCode).toBe(200);
    expect(seen).toHaveBeenCalledWith("https://evil.example.com", "10.1.2.3");
  });

  it("stays silent for admitted and absent origins", async () => {
    const seen = vi.fn();
    const f = await app(seen);
    await f.inject({ url: "/api/x", headers: { origin: "http://localhost:3000", host: "localhost:8000" } });
    await f.inject({ url: "/api/x" });
    expect(seen).not.toHaveBeenCalled();
  });

  it("a throwing observer never blocks the request", async () => {
    const f = await app(() => {
      throw new Error("boom");
    });
    const res = await f.inject({ url: "/api/x", headers: { origin: "https://evil.example.com", host: "h:1" } });
    expect(res.statusCode).toBe(200);
  });
});
