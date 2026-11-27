/**
 * `host.localRequest`: allowlist, request hygiene, proof binding, caps and typed errors. The real-guard
 * end-to-end (strict `requireLocalProof`, real listener) lives in the agent-teams plugin's inject test.
 * See change: add-agent-teams-openspec (design D4/D8).
 */
import { canonicalBinding, httpPurpose, LOCAL_PROOF_HEADER, mintProof, PROOF_WINDOW_MS } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { describe, expect, it, vi } from "vitest";
import { createHostLocalRequest, LOCAL_REQUEST_MAX_BODY_BYTES, LOCAL_REQUEST_MAX_RESPONSE_BYTES } from "../plugin-local-request.js";

const TOKEN = "super-secret-local-token";

interface Seen { url: string; init: RequestInit }
function setup(answer: () => Response | Promise<Response> = () => new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } }), over: { port?: number; token?: string | null; host?: string } = {}) {
  const seen: Seen[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as unknown as typeof fetch;
  const request = createHostLocalRequest({ getToken: () => (over.token === undefined ? TOKEN : over.token), host: over.host ?? "0.0.0.0", getPort: () => over.port ?? 8123, fetchImpl });
  return { request, seen, fetchImpl };
}

describe("host.localRequest — happy path", () => {
  it("dials the loopback literal with ONE proof bound to endpoint + method + target; sends no token, no caller headers", async () => {
    const { request, seen } = setup();
    const res = await request({ method: "POST", url: "/api/git/worktree", body: { cwd: "/r" } });
    expect(res).toEqual({ ok: true, statusCode: 200, body: { success: true } });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("http://127.0.0.1:8123/api/git/worktree");
    const h = seen[0].init.headers as Record<string, string>;
    expect(Object.keys(h).sort()).toEqual(["content-type", LOCAL_PROOF_HEADER].sort());
    expect(seen[0].init.redirect).toBe("manual");
    expect(seen[0].init.body).toBe(JSON.stringify({ cwd: "/r" }));
    // the proof is exactly what the verifier recomputes for this endpoint/method/target
    const [, ts, nonce, mac] = h[LOCAL_PROOF_HEADER].split(".");
    const again = mintProof({ token: TOKEN, binding: canonicalBinding("127.0.0.1", 8123), purpose: httpPurpose("POST", "/api/git/worktree"), now: Number(ts), nonce });
    expect(again.mac).toBe(mac);
    expect(Math.abs(Date.now() - Number(ts))).toBeLessThan(PROOF_WINDOW_MS);
    expect(JSON.stringify(seen)).not.toContain(TOKEN);
  });

  it("every call mints a fresh nonce (single-use proofs)", async () => {
    const { request, seen } = setup();
    await request({ method: "GET", url: "/api/openspec/tasks?cwd=%2Fr&change=x" });
    await request({ method: "GET", url: "/api/openspec/tasks?cwd=%2Fr&change=x" });
    const n = seen.map((s) => (s.init.headers as Record<string, string>)[LOCAL_PROOF_HEADER].split(".")[2]);
    expect(new Set(n).size).toBe(2);
  });

  it("returns a non-JSON body as text and passes a guard refusal through as ok:true with the status", async () => {
    const t = setup(() => new Response("plain", { status: 200 }));
    expect(await t.request({ method: "GET", url: "/api/openspec/tasks" })).toEqual({ ok: true, statusCode: 200, body: "plain" });
    const r = setup(() => new Response(JSON.stringify({ reason: "local_proof_required" }), { status: 403 }));
    expect(await r.request({ method: "POST", url: "/api/openspec/tasks/toggle", body: {} })).toMatchObject({ ok: true, statusCode: 403 });
  });
});

describe("host.localRequest — negative controls (nothing is sent)", () => {
  const cases: Array<[string, { method: "GET" | "POST"; url: string; body?: unknown }, string]> = [
    ["absolute URL", { method: "GET", url: "http://evil.example/api/openspec/tasks" }, "invalid_request"],
    ["protocol-relative", { method: "GET", url: "//evil.example/api/openspec/tasks" }, "invalid_request"],
    ["dot-dot segment", { method: "POST", url: "/api/git/worktree/../../x" }, "invalid_request"],
    ["encoded dot-dot", { method: "POST", url: "/api/git/%2e%2e/worktree" }, "invalid_request"],
    ["backslash", { method: "POST", url: "/api/git\\worktree" }, "invalid_request"],
    ["fragment", { method: "GET", url: "/api/openspec/tasks#x" }, "invalid_request"],
    ["CRLF", { method: "GET", url: "/api/openspec/tasks\r\nHost: evil" }, "invalid_request"],
    ["not /api/", { method: "GET", url: "/health" }, "invalid_request"],
    ["non-allowlisted path", { method: "POST", url: "/api/shutdown" }, "path_not_allowed"],
    ["prefix of an allowlisted path", { method: "POST", url: "/api/git/worktree/other" }, "path_not_allowed"],
    ["allowlisted path, wrong method", { method: "GET", url: "/api/git/worktree" }, "path_not_allowed"],
    ["query on a no-query entry", { method: "POST", url: "/api/git/worktree?x=1" }, "path_not_allowed"],
    ["unsupported method", { method: "DELETE" as never, url: "/api/git/worktree" }, "path_not_allowed"],
    ["body on GET", { method: "GET", url: "/api/openspec/tasks", body: {} }, "invalid_request"],
    ["oversize body", { method: "POST", url: "/api/git/worktree", body: { x: "a".repeat(LOCAL_REQUEST_MAX_BODY_BYTES) } }, "body_too_large"],
    ["unserialisable body", { method: "POST", url: "/api/git/worktree", body: { n: 1n } }, "invalid_request"],
  ];
  for (const [name, input, code] of cases) {
    it(`refuses ${name} → ${code}`, async () => {
      const { request, fetchImpl } = setup();
      expect(await request(input)).toEqual({ ok: false, code });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  }
});

describe("host.localRequest — failures are typed and never leak the proof", () => {
  it("no token / no listener port → unavailable, nothing sent", async () => {
    const a = setup(undefined, { token: null });
    expect(await a.request({ method: "GET", url: "/api/openspec/tasks" })).toEqual({ ok: false, code: "unavailable" });
    const b = setup(undefined, { port: 0 });
    expect(await b.request({ method: "GET", url: "/api/openspec/tasks" })).toEqual({ ok: false, code: "unavailable" });
    expect(a.fetchImpl).not.toHaveBeenCalled();
    expect(b.fetchImpl).not.toHaveBeenCalled();
  });

  it("a name-bound host with no literal still dials 127.0.0.1 (never a name)", async () => {
    const { request, seen } = setup(undefined, { host: "my.box.local" });
    await request({ method: "GET", url: "/api/openspec/tasks" });
    expect(seen[0].url.startsWith("http://127.0.0.1:8123/")).toBe(true);
  });

  it("transport failure → unreachable; the error carries only the code (no url, header, proof or token)", async () => {
    const { request } = setup(() => { throw new Error(`connect ECONNREFUSED proof=${TOKEN}`); });
    const res = await request({ method: "POST", url: "/api/git/worktree", body: {} });
    expect(res).toEqual({ ok: false, code: "unreachable" });
    expect(JSON.stringify(res)).not.toMatch(/ECONNREFUSED|proof|v1\.|secret/);
  });

  it("timeout → timeout", async () => {
    const fetchImpl = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch;
    const request = createHostLocalRequest({ getToken: () => TOKEN, host: undefined, getPort: () => 8123, fetchImpl });
    expect(await request({ method: "GET", url: "/api/openspec/tasks", timeoutMs: 20 })).toEqual({ ok: false, code: "timeout" });
  });

  it("an oversize response (declared or streamed) → response_too_large", async () => {
    const big = "x".repeat(LOCAL_REQUEST_MAX_RESPONSE_BYTES + 1);
    const a = setup(() => new Response(big, { status: 200 }));
    expect(await a.request({ method: "GET", url: "/api/openspec/tasks" })).toEqual({ ok: false, code: "response_too_large" });
    const b = setup(() => new Response(big, { status: 200, headers: { "content-length": String(big.length) } }));
    expect(await b.request({ method: "GET", url: "/api/openspec/tasks" })).toEqual({ ok: false, code: "response_too_large" });
  });

  it("never writes to the console", async () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { request } = setup(() => { throw new Error("boom"); });
    await request({ method: "GET", url: "/api/openspec/tasks" });
    await request({ method: "GET", url: "http://evil/" });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    for (const s of spies) s.mockRestore();
  });
});
