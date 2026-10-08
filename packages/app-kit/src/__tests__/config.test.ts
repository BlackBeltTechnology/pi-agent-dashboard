import { afterEach, describe, expect, it, vi } from "vitest";
import { AppKitError, apiUrl, configureDashboard, isDashboardOrigin, loadAppConfig, resetAppConfig, wsUrl } from "../config.js";

// Runtime dashboard endpoint (change: extract-standalone-app-kit, design D2).
// jsdom page origin: http://localhost:3000 (vitest default).

const PAGE = window.location.origin;

afterEach(() => {
  resetAppConfig();
  vi.unstubAllGlobals();
});

const res = (body: string, status = 200, type = "application/json") =>
  new Response(body, { status, headers: { "content-type": type } });

describe("apiUrl / wsUrl", () => {
  it("E1: resolves REST and WS paths against a cross-origin https base", () => {
    configureDashboard({ dashboardUrl: "https://dash.example.com" });
    expect(apiUrl("/api/sessions")).toBe("https://dash.example.com/api/sessions");
    expect(wsUrl("/ws")).toBe("wss://dash.example.com/ws");
  });

  it("E2: an http base yields a ws: socket URL", () => {
    configureDashboard({ dashboardUrl: "http://10.0.0.5:8000" });
    expect(wsUrl("/ws")).toBe("ws://10.0.0.5:8000/ws");
  });

  it("E5: an absolute URL passes through unchanged", () => {
    configureDashboard({ dashboardUrl: "https://dash.example.com" });
    expect(wsUrl("wss://other.example.com/ws")).toBe("wss://other.example.com/ws");
    expect(apiUrl("https://other.example.com/x?y=1")).toBe("https://other.example.com/x?y=1");
  });

  it("defaults to the page origin when nothing is configured", () => {
    expect(apiUrl("/api/sessions")).toBe(`${PAGE}/api/sessions`);
    expect(wsUrl("/ws")).toBe(`${PAGE.replace(/^http/, "ws")}/ws`);
  });

  it("compares origins with ws(s) mapped to http(s)", () => {
    configureDashboard({ dashboardUrl: "https://dash.example.com" });
    expect(isDashboardOrigin("wss://dash.example.com/ws")).toBe(true);
    expect(isDashboardOrigin("https://dash.example.com/api")).toBe(true);
    expect(isDashboardOrigin("ws://dash.example.com/ws")).toBe(false);
    expect(isDashboardOrigin("https://evil.example/x")).toBe(false);
    expect(isDashboardOrigin("http://[")).toBe(false);
    expect(isDashboardOrigin("javascript:alert(1)")).toBe(false);
    // A relative path resolves against the dashboard base.
    expect(isDashboardOrigin("/api/x")).toBe(true);
  });
});

describe("configureDashboard", () => {
  it.each(["javascript:alert(1)", "https://u:p@dash.example.com", "ftp://x", "not a url"])(
    "E3: rejects %s with invalid_dashboard_url and issues no request",
    (dashboardUrl) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      expect(() => configureDashboard({ dashboardUrl })).toThrowError(
        expect.objectContaining({ code: "invalid_dashboard_url" }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("a rejected URL leaves the previous base in place", () => {
    configureDashboard({ dashboardUrl: "https://dash.example.com" });
    expect(() => configureDashboard({ dashboardUrl: "javascript:alert(1)" })).toThrow(AppKitError);
    expect(apiUrl("/x")).toBe("https://dash.example.com/x");
  });
});

describe("loadAppConfig (E4 decision table)", () => {
  type Case = { name: string; respond: () => Promise<Response> };
  const sameOrigin: Case[] = [
    { name: "{}", respond: async () => res("{}") },
    { name: '{"dashboardUrl":""}', respond: async () => res('{"dashboardUrl":""}') },
  ];
  const missing: Case[] = [
    { name: "404", respond: async () => res("not found", 404, "text/plain") },
    { name: "200 HTML", respond: async () => res("<!doctype html><html></html>", 200, "text/html") },
  ];
  const broken: Case[] = [
    {
      name: "network error",
      respond: async () => {
        throw new TypeError("failed to fetch");
      },
    },
    { name: "[]", respond: async () => res("[]") },
  ];

  for (const allowMissing of [false, true]) {
    for (const c of sameOrigin) {
      it(`${c.name} → same origin (allowMissing=${allowMissing})`, async () => {
        configureDashboard({ dashboardUrl: "https://stale.example.com" });
        const fetchImpl = vi.fn(c.respond);
        const cfg = await loadAppConfig("/config.json", { allowMissing, fetchImpl });
        expect(cfg.dashboardUrl).toBeUndefined();
        expect(apiUrl("/api/x")).toBe(`${PAGE}/api/x`);
      });
    }
    for (const c of missing) {
      it(`${c.name} → ${allowMissing ? "same origin" : "app_config_unavailable"} (allowMissing=${allowMissing})`, async () => {
        const fetchImpl = vi.fn(c.respond);
        const p = loadAppConfig("/config.json", { allowMissing, fetchImpl });
        if (allowMissing) {
          await expect(p).resolves.toEqual({});
          expect(apiUrl("/api/x")).toBe(`${PAGE}/api/x`);
        } else {
          await expect(p).rejects.toMatchObject({ code: "app_config_unavailable" });
        }
      });
    }
    for (const c of broken) {
      it(`${c.name} → app_config_unavailable (allowMissing=${allowMissing})`, async () => {
        const fetchImpl = vi.fn(c.respond);
        await expect(loadAppConfig("/config.json", { allowMissing, fetchImpl })).rejects.toMatchObject({
          code: "app_config_unavailable",
        });
      });
    }
  }

  it("applies a configured dashboardUrl and fetches the config without credentials", async () => {
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => res('{"dashboardUrl":"https://dash.example.com"}'));
    const cfg = await loadAppConfig(undefined, { fetchImpl });
    expect(cfg).toEqual({ dashboardUrl: "https://dash.example.com" });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("/config.json");
    expect(fetchImpl.mock.calls[0]?.[1]?.credentials).toBe("omit");
    expect(apiUrl("/api/x")).toBe("https://dash.example.com/api/x");
  });

  it("rejects an unsafe dashboardUrl from the config document", async () => {
    const fetchImpl = vi.fn(async () => res('{"dashboardUrl":"javascript:alert(1)"}'));
    await expect(loadAppConfig("/config.json", { fetchImpl })).rejects.toMatchObject({ code: "invalid_dashboard_url" });
  });

  it("rejects a non-string dashboardUrl as app_config_unavailable", async () => {
    const fetchImpl = vi.fn(async () => res('{"dashboardUrl":42}'));
    await expect(loadAppConfig("/config.json", { fetchImpl })).rejects.toMatchObject({ code: "app_config_unavailable" });
  });
});
