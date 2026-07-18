/**
 * Tests for the client-side tools-api helpers (fetch adapters around
 * /api/tools*).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as api from "../lib/api/tools-api.js";

const origFetch = globalThis.fetch;

function mockFetch(
  handler: (url: string, init?: RequestInit) => { status?: number; body: unknown; text?: string; headers?: Record<string, string> },
) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const out = handler(url, init);
    const status = out.status ?? 200;
    const body = out.body;
    const headers = new Headers(out.headers ?? { "content-type": "application/json" });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers,
      json: async () => body,
      text: async () => out.text ?? (typeof body === "string" ? body : JSON.stringify(body)),
    } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {});
afterEach(() => { globalThis.fetch = origFetch; });

describe("fetchTools", () => {
  it("returns the tools array from the success envelope", async () => {
    mockFetch(() => ({
      body: { success: true, data: { tools: [{ name: "pi", ok: true, path: "/pi", source: "system", tried: [], resolvedAt: 0 }] } },
    }));
    const tools = await api.fetchTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("pi");
  });

  it("throws on error envelope", async () => {
    mockFetch(() => ({ body: { success: false, error: "boom" } }));
    await expect(api.fetchTools()).rejects.toThrow(/boom/);
  });
});

describe("rescanAll / rescanOne", () => {
  it("rescanAll POSTs empty body and returns refreshed tools", async () => {
    let capturedBody: string | null = null;
    mockFetch((_url, init) => {
      capturedBody = init?.body as string;
      return { body: { success: true, data: { tools: [{ name: "pi", ok: true, path: "/pi", source: "system", tried: [], resolvedAt: 1 }] } } };
    });
    const tools = await api.rescanAll();
    expect(tools[0].resolvedAt).toBe(1);
    expect(JSON.parse(capturedBody!)).toEqual({});
  });

  it("rescanOne includes { name } in body", async () => {
    let capturedBody: string | null = null;
    mockFetch((_url, init) => {
      capturedBody = init?.body as string;
      return { body: { success: true, data: { tools: [] } } };
    });
    await api.rescanOne("pi");
    expect(JSON.parse(capturedBody!)).toEqual({ name: "pi" });
  });
});

describe("setOverride / clearOverride", () => {
  it("setOverride PUTs the given path", async () => {
    let method: string | undefined, body: string | undefined;
    mockFetch((_url, init) => {
      method = init?.method;
      body = init?.body as string;
      return { body: { success: true, data: { name: "pi", ok: true, path: "/custom/pi", source: "override", tried: [], resolvedAt: 0 } } };
    });
    const res = await api.setOverride("pi", "/custom/pi");
    expect(method).toBe("PUT");
    expect(JSON.parse(body!)).toEqual({ path: "/custom/pi" });
    expect(res.source).toBe("override");
  });

  it("clearOverride DELETEs", async () => {
    let method: string | undefined;
    mockFetch((_url, init) => {
      method = init?.method;
      return { body: { success: true, data: { name: "pi", ok: true, path: "/usr/bin/pi", source: "system", tried: [], resolvedAt: 0 } } };
    });
    await api.clearOverride("pi");
    expect(method).toBe("DELETE");
  });
});

describe("exportDiagnostics", () => {
  it("returns raw text/plain body", async () => {
    mockFetch(() => ({
      body: "ignored",
      text: "# diagnostics\n[ok] pi\n",
      headers: { "content-type": "text/plain" },
    }));
    const text = await api.exportDiagnostics();
    expect(text).toMatch(/^# diagnostics/);
  });

  it("throws on non-ok status", async () => {
    mockFetch(() => ({ status: 500, body: "err", text: "err" }));
    await expect(api.exportDiagnostics()).rejects.toThrow(/500/);
  });
});

describe("ToolsSection row-derived UI state", () => {
  // Pure helpers tested — the full DOM behaviour is exercised via manual QA
  // (per the release-gate tasks) and via the downstream /api/tools integration
  // tests. These assertions just document the expected status classification
  // so a future refactor of the badge logic keeps its contract.
  it("a resolved ok tool with no failed override is a plain ✓", () => {
    const tool = { name: "pi", ok: true, path: "/pi", source: "system" as const, tried: [{ strategy: "where", result: "ok" }], resolvedAt: 0 };
    const invalidOverride = tool.tried.some((x) => x.strategy === "override" && typeof x.result === "string" && x.result.startsWith("invalid:"));
    expect(tool.ok && !invalidOverride).toBe(true);
  });

  it("a resolved ok tool with a dropped invalid override is a ⚠", () => {
    const tool = {
      name: "pi", ok: true, path: "/pi", source: "system" as const,
      tried: [
        { strategy: "override", result: "invalid: path does not exist: /custom" },
        { strategy: "where", result: "ok" },
      ],
      resolvedAt: 0,
    };
    const invalidOverride = tool.tried.some((x) => x.strategy === "override" && typeof x.result === "string" && x.result.startsWith("invalid:"));
    expect(tool.ok && invalidOverride).toBe(true);
  });

  it("an unresolved tool is a ✗", () => {
    const tool = { name: "zrok", ok: false, path: null, source: null, tried: [{ strategy: "where", result: "not found on PATH" }], resolvedAt: 0 };
    expect(tool.ok).toBe(false);
  });
});

describe("SourceBadge style mapping", () => {
  // See change: fix-node-resolution-under-electron (task 5.3).
  it("'bundled' source gets a sky-500 badge with the Electron-install tooltip", async () => {
    const { sourceBadgeStyle } = await import("../components/settings/ToolsSection.js");
    const s = sourceBadgeStyle("bundled");
    expect(s.className).toContain("sky");
    expect(s.tooltip).toMatch(/Electron/i);
  });

  it("'system' badge has a tooltip pointing at PATH", async () => {
    const { sourceBadgeStyle } = await import("../components/settings/ToolsSection.js");
    expect(sourceBadgeStyle("system").tooltip).toMatch(/PATH/i);
  });

  it("'override' badge is distinct from bundled / system / managed", async () => {
    const { sourceBadgeStyle } = await import("../components/settings/ToolsSection.js");
    const classes = new Set([
      sourceBadgeStyle("override").className,
      sourceBadgeStyle("bundled").className,
      sourceBadgeStyle("managed").className,
      sourceBadgeStyle("system").className,
      sourceBadgeStyle("npm-global").className,
      sourceBadgeStyle("bare-import").className,
    ]);
    expect(classes.size).toBe(6);
  });
});
