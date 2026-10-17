/**
 * repairMermaidWithAi fetch helper + client config hydration
 * (test-plan #F11, #F10). See change: add-mermaid-ai-repair.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MermaidRepairError, repairMermaidWithAi } from "../api/mermaid-repair-api.js";
import {
  getMermaidRepairClientConfig,
  hydrateMermaidRepairConfig,
  setMermaidRepairClientConfig,
} from "../preview/mermaid-repair-config.js";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("repairMermaidWithAi (F11)", () => {
  it("POSTs JSON, forwards the signal, returns { code, model } on 200", async () => {
    const f = mockFetch(200, { success: true, data: { code: "graph TD\nA-->B", model: "a/b" } });
    vi.stubGlobal("fetch", f);
    const ac = new AbortController();
    const out = await repairMermaidWithAi("graph TD\nA-->", "Parse error", ac.signal);
    expect(out).toEqual({ code: "graph TD\nA-->B", model: "a/b" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/mermaid/repair");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ code: "graph TD\nA-->", error: "Parse error" });
    expect(init.signal).toBe(ac.signal);
  });

  it("rejects with the envelope's machine code and human text on 429 busy", async () => {
    vi.stubGlobal("fetch", mockFetch(429, { success: false, code: "busy", error: "Another AI repair is running" }));
    const err = await repairMermaidWithAi("x", "e").catch((e) => e);
    expect(err).toBeInstanceOf(MermaidRepairError);
    expect(err.code).toBe("busy");
    expect(err.message).toBe("Another AI repair is running");
  });

  it("rethrows aborts untouched and wraps other network failures", async () => {
    const ac = new AbortController();
    ac.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    await expect(repairMermaidWithAi("x", "e", ac.signal)).rejects.toMatchObject({ name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(repairMermaidWithAi("x", "e")).rejects.toMatchObject({ code: "network" });
  });
});

describe("client config hydration (F10)", () => {
  beforeEach(() => setMermaidRepairClientConfig(undefined));

  it("reads mermaidRepair from a GET /api/config response", () => {
    expect(getMermaidRepairClientConfig().enabled).toBe(false);
    hydrateMermaidRepairConfig({ success: true, data: { mermaidRepair: { enabled: true, model: "a/b", maxChars: 1 } } });
    expect(getMermaidRepairClientConfig()).toEqual({ enabled: true, model: "a/b" });
  });

  it("anything unusable resolves to disabled", () => {
    hydrateMermaidRepairConfig({ success: true, data: { mermaidRepair: { enabled: true, model: "a/b" } } });
    hydrateMermaidRepairConfig({ success: true, data: { mermaidRepair: { enabled: false, disabledReason: "no_model" } } });
    expect(getMermaidRepairClientConfig().enabled).toBe(false);
    hydrateMermaidRepairConfig({ success: true, data: { mermaidRepair: { enabled: true } } });
    expect(getMermaidRepairClientConfig().enabled).toBe(false);
  });
});
