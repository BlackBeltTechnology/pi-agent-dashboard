/**
 * `fetchAutomations` reports failure; `listAutomations` keeps swallowing it.
 * See change: fix-ui-status-indicators (#1155; test-plan #S45, #S46, #S27).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAutomations, listAutomations } from "../client/api.js";

afterEach(() => vi.unstubAllGlobals());

const stubFetch = (impl: () => Promise<unknown>) => vi.stubGlobal("fetch", vi.fn(impl));

describe("fetchAutomations", () => {
  it.each([503, 403])("HTTP %s is { ok: false }, not an empty list", async (status) => {
    stubFetch(async () => ({ ok: false, status, json: async () => ({}) }));
    const res = await fetchAutomations("/r");
    expect(res.ok).toBe(false);
  });

  it("a network reject is { ok: false } with the error message", async () => {
    stubFetch(async () => {
      throw new Error("boom");
    });
    expect(await fetchAutomations("/r")).toEqual({ ok: false, error: "boom" });
  });

  it("a 200 with a non-JSON body is { ok: false }", async () => {
    stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));
    expect((await fetchAutomations("/r")).ok).toBe(false);
  });

  it("a 200 with automations is { ok: true }; a missing array is an empty success", async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ automations: [{ name: "a" }] }) }));
    expect(await fetchAutomations("/r")).toEqual({ ok: true, automations: [{ name: "a" }] });
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    expect(await fetchAutomations("/r")).toEqual({ ok: true, automations: [] });
  });

  it("scopes the request to the cwd", async () => {
    const f = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => ({ automations: [] }) }));
    vi.stubGlobal("fetch", f);
    await fetchAutomations("/a b");
    expect(String(f.mock.calls[0]?.[0])).toContain("cwd=%2Fa%20b");
  });
});

describe("listAutomations (unchanged for FolderAutomationSection)", () => {
  it("still swallows a 503 and a reject into []", async () => {
    stubFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    expect(await listAutomations("/r")).toEqual([]);
    stubFetch(async () => {
      throw new Error("down");
    });
    expect(await listAutomations("/r")).toEqual([]);
  });
});
