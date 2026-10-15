/**
 * Server-side `@fast` resolution (test-plan #E18, #X4; tasks 4.1, D5).
 * See change: add-pending-question-stack.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBriefModelResolver } from "../brief-model.js";

const model = { provider: "anthropic", id: "haiku" };
const registry = (found: unknown = model) => ({ find: vi.fn(async () => found) });

function make(over: Partial<Parameters<typeof createBriefModelResolver>[0]> = {}) {
  return createBriefModelResolver({
    readProviders: async () => JSON.stringify({ roles: { fast: "anthropic/haiku" } }),
    getRegistry: async () => registry(),
    hasStreamFn: () => true,
    ...over,
  });
}

describe("createBriefModelResolver", () => {
  afterEach(() => vi.restoreAllMocks());

  it("bound role + known model → the registry model", async () => {
    const reg = registry();
    const res = await make({ getRegistry: async () => reg })();
    expect(res).toEqual({ ok: true, model });
    expect(reg.find).toHaveBeenCalledWith("anthropic", "haiku");
  });

  it("a thinking-level suffix on the binding is ignored for lookup", async () => {
    const reg = registry();
    await make({ readProviders: async () => JSON.stringify({ roles: { fast: "anthropic/haiku:low" } }), getRegistry: async () => reg })();
    expect(reg.find).toHaveBeenCalledWith("anthropic", "haiku");
  });

  it.each([
    ["no fast role", async () => JSON.stringify({ roles: { default: "a/b" } })],
    ["providers.json absent", async () => undefined],
    ["empty roles", async () => "{}"],
  ])("%s → unavailable", async (_n, readProviders) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await make({ readProviders })();
    expect(res.ok).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a malformed providers.json logs a constant message (never the parser text, which can quote file content)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await make({ readProviders: async () => '{"apiKey": "sk-leakyleakyleakyleaky" oops' })();
    expect(res).toEqual({ ok: false, reason: "providers.json malformed" });
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).not.toContain("sk-leaky");
    expect(logged).not.toMatch(/Unexpected|position|token/i);
  });

  it("fast → unknown model → unavailable", async () => {
    expect((await make({ getRegistry: async () => registry(null) })()).ok).toBe(false);
  });

  it("null registry → unavailable", async () => {
    expect((await make({ getRegistry: async () => null })()).ok).toBe(false);
  });

  it("a registry that throws → unavailable, never throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await make({ getRegistry: async () => { throw new Error("boom"); } })();
    expect(res.ok).toBe(false);
  });

  it("no stream function → unavailable", async () => {
    expect((await make({ hasStreamFn: () => false })()).ok).toBe(false);
  });

  it("malformed providers.json → unavailable, warning logged, no throw (test-plan #X4)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await make({ readProviders: async () => "{not json" })();
    expect(res.ok).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/providers\.json/);
  });

  it("a read error other than ENOENT → unavailable + warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await make({ readProviders: async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); } })();
    expect(res.ok).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});
