/**
 * Tests for the shared fetchJson transport guard.
 *
 * Pins the contract: parse JSON only when res.ok AND content-type is
 * application/json; otherwise throw a typed ApiHttpError naming the real
 * HTTP status (never a native JSON SyntaxError / `Unexpected token '<'`).
 *
 * See change: guard-client-fetch-json.
 */
import { describe, expect, it, vi } from "vitest";
import { ApiHttpError, fetchJson } from "../api/fetch-json.js";

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    statusText: status === 504 ? "Gateway Timeout" : "",
    headers: { "content-type": "text/html" },
  });
}

describe("fetchJson", () => {
  it("returns parsed JSON on a 2xx application/json response", async () => {
    const payload = { success: true, data: [1, 2, 3] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
    const result = await fetchJson<typeof payload>("/api/git/worktrees");
    expect(result).toEqual(payload);
  });

  it("throws ApiHttpError (not a parse error) on 504 with an HTML body", async () => {
    const html = "<html><head><title>504 Gateway Timeout</title></head></html>";
    const res = htmlResponse(html, 504);
    const jsonSpy = vi.spyOn(res, "json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));

    const err = (await fetchJson("/api/git/worktrees").catch((e) => e)) as ApiHttpError;
    expect(err).toBeInstanceOf(ApiHttpError);
    expect(err.status).toBe(504);
    expect(err.message).toContain("504");
    expect(err.message).not.toContain("Unexpected token");
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it("throws ApiHttpError on a 200 with a non-JSON content-type (SPA fallback / misroute)", async () => {
    const res = htmlResponse("<!doctype html><html>index</html>", 200);
    const jsonSpy = vi.spyOn(res, "json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));

    const err = (await fetchJson("/api/git/head").catch((e) => e)) as ApiHttpError;
    expect(err).toBeInstanceOf(ApiHttpError);
    expect(err.contentType).toContain("text/html");
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it("throws ApiHttpError (not a SyntaxError) on an empty 502 body", async () => {
    const res = new Response("", { status: 502, statusText: "Bad Gateway" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));

    const err = (await fetchJson("/api/git/branches").catch((e) => e)) as ApiHttpError;
    expect(err).toBeInstanceOf(ApiHttpError);
    expect(err).not.toBeInstanceOf(SyntaxError);
    expect(err.message).toContain("502");
  });

  it("bounds bodySnippet to ~200 chars on a large HTML error page", async () => {
    const big = `<html>${"x".repeat(10_000)}</html>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(htmlResponse(big, 500)));

    const err = (await fetchJson("/api/git/worktrees").catch((e) => e)) as ApiHttpError;
    expect(err).toBeInstanceOf(ApiHttpError);
    expect(err.bodySnippet.length).toBeLessThanOrEqual(210);
  });
});
