import { describe, expect, it, vi } from "vitest";
import { createCloudflareSolver } from "../solvers/cloudflare.js";
import type { DnsApi, SolverDeps } from "../types.js";

/**
 * Cloudflare DNS-01 solver: zone lookup, TXT publish/cleanup by record id, credential-failure handling.
 * See change: add-acme-dns01-certs (D2, D6; tests E8, E9, E36).
 */

const TOKEN = "cf-token-0123456789abcdef";
const BASE = "https://cf.test/client/v4";

interface Req {
  method: string;
  path: string;
  body?: unknown;
  auth?: string | null;
}

type Handler = (req: Req) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>;

function setup(handler: Handler, extra: Partial<SolverDeps> = {}) {
  const calls: Req[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const req: Req = {
      method: init?.method ?? "GET",
      path: url.pathname.replace("/client/v4", "") + url.search,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.get("authorization"),
    };
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    calls.push(req);
    const r = await handler(req);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  });
  const deps: SolverDeps = {
    sourceId: "home",
    readSecret: async (label) => (label === "cloudflareToken" ? TOKEN : null),
    redact: (m) => m.split(TOKEN).join("[REDACTED]"),
    cloudflareApiBase: BASE,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    dns: {} as DnsApi,
    ...extra,
  };
  return { deps, calls, fetchImpl };
}

const ok = (result: unknown) => ({ body: { success: true, errors: [], result } });

describe("zone lookup (E8)", () => {
  const zones: Record<string, string> = { "sub.example.com": "zone-sub", "example.com": "zone-root" };
  const handler: Handler = (req) => {
    if (req.method === "GET" && req.path.startsWith("/zones?name=")) {
      const name = new URL(`https://x${req.path}`).searchParams.get("name") ?? "";
      return ok(zones[name] ? [{ id: zones[name], name }] : []);
    }
    if (req.method === "POST") return ok({ id: "rec-1" });
    return ok({});
  };

  it("queries exact names longest-first, stops on match, posts to that zone (TXT TTL 60)", async () => {
    const { deps, calls } = setup(handler);
    const solver = createCloudflareSolver({}, deps);
    const r = await solver.publish("a.sub.example.com", "txt-value");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /zones?name=a.sub.example.com",
      "GET /zones?name=sub.example.com",
      "POST /zones/zone-sub/dns_records",
    ]);
    expect(calls[2].body).toEqual({ type: "TXT", name: "_acme-challenge.a.sub.example.com", content: "txt-value", ttl: 60 });
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(typeof r.ref).toBe("string");
  });

  it("strips a wildcard prefix: *.sub.example.com → owner _acme-challenge.sub.example.com", async () => {
    const { deps, calls } = setup(handler);
    await createCloudflareSolver({}, deps).publish("*.sub.example.com", "v");
    expect(calls[0].path).toBe("/zones?name=sub.example.com");
    expect((calls.at(-1)?.body as { name: string }).name).toBe("_acme-challenge.sub.example.com");
  });

  it("with zoneId set makes no /zones request at all", async () => {
    const { deps, calls } = setup(handler);
    await createCloudflareSolver({ zoneId: "a".repeat(32) }, deps).publish("a.sub.example.com", "v");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST /zones/${"a".repeat(32)}/dns_records`]);
  });

  it("publish for a domain with no matching zone throws a plain error", async () => {
    const { deps } = setup(() => ok([]));
    await expect(createCloudflareSolver({}, deps).publish("a.unknown.test", "v")).rejects.toThrow(/zone/i);
  });
});

describe("cleanup (E9)", () => {
  it("deletes by record id from the ref alone (a fresh solver instance works); 404 is success", async () => {
    const publisher = setup((req) => (req.method === "POST" ? ok({ id: "rec-9" }) : ok([{ id: "z1", name: "example.com" }])));
    const { ref } = await createCloudflareSolver({}, publisher.deps).publish("dash.example.com", "v");

    let deletes = 0;
    const cleaner = setup((req) => {
      if (req.method === "DELETE") {
        deletes++;
        return deletes === 1 ? ok({ id: "rec-9" }) : { status: 404, body: { success: false, errors: [{ code: 81044, message: "Record does not exist" }] } };
      }
      return ok({});
    });
    const solver = createCloudflareSolver({}, cleaner.deps);
    await solver.cleanup({ ref });
    await solver.cleanup({ ref });
    expect(cleaner.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE /zones/z1/dns_records/rec-9", "DELETE /zones/z1/dns_records/rec-9"]);
  });

  it("a non-404 failure rejects with a redacted plain error", async () => {
    const { deps } = setup(() => ({ status: 500, body: { success: false, errors: [{ message: `boom ${TOKEN}` }] } }));
    const err = await createCloudflareSolver({}, deps).cleanup({ ref: "z1/rec" }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(TOKEN);
    expect((err as Error).message).toMatch(/500/);
  });

  it("a malformed ref rejects", async () => {
    const { deps } = setup(() => ok({}));
    await expect(createCloudflareSolver({}, deps).cleanup({ ref: "garbage" })).rejects.toThrow(/ref/i);
  });
});

describe("credential failures", () => {
  for (const status of [401, 403]) {
    it(`publish ${status} → onCredentialFailure + plain redacted Error`, async () => {
      const onCredentialFailure = vi.fn();
      const { deps } = setup(
        () => ({ status, body: { success: false, errors: [{ code: 10000, message: `Authentication error for ${TOKEN}` }] } }),
        { onCredentialFailure },
      );
      const err = await createCloudflareSolver({ zoneId: "b".repeat(32) }, deps).publish("dash.example.com", "v").catch((e: Error) => e);
      expect(onCredentialFailure).toHaveBeenCalledTimes(1);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).constructor).toBe(Error);
      expect((err as Error).message).not.toContain(TOKEN);
      expect((err as Error).message).toContain(String(status));
    });
  }

  it("a 5xx on publish does not flag the credentials", async () => {
    const onCredentialFailure = vi.fn();
    const { deps } = setup(() => ({ status: 503, body: {} }), { onCredentialFailure });
    await expect(createCloudflareSolver({ zoneId: "c".repeat(32) }, deps).publish("d.example.com", "v")).rejects.toThrow(/503/);
    expect(onCredentialFailure).not.toHaveBeenCalled();
  });

  it("a network error is redacted", async () => {
    const { deps } = setup(() => {
      throw new Error(`connect ECONNREFUSED with ${TOKEN}`);
    });
    const err = await createCloudflareSolver({ zoneId: "c".repeat(32) }, deps).publish("d.example.com", "v").catch((e: Error) => e);
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it("an absent token fails without any request", async () => {
    const { deps, calls } = setup(() => ok({}), { readSecret: async () => null });
    await expect(createCloudflareSolver({}, deps).publish("d.example.com", "v")).rejects.toThrow(/token/i);
    expect(calls).toHaveLength(0);
  });
});

describe("check / checkCredentials (E36)", () => {
  const verifyOk = ok({ id: "t", status: "active" });

  it("token verify + zone lookup → ok", async () => {
    const { deps, calls } = setup((req) => (req.path === "/user/tokens/verify" ? verifyOk : ok([{ id: "z", name: "example.com" }])));
    expect(await createCloudflareSolver({}, deps).check("dash.example.com")).toEqual({ ok: true });
    expect(calls[0].path).toBe("/user/tokens/verify");
  });

  it("unknown zone → gate dns-zone with a hint", async () => {
    const { deps } = setup((req) => (req.path === "/user/tokens/verify" ? verifyOk : ok([])));
    const r = await createCloudflareSolver({}, deps).check("a.unknown.test");
    expect(r).toMatchObject({ ok: false, gate: "dns-zone" });
    expect(r.hint).toContain("a.unknown.test");
  });

  it("bad token → gate credentials, no zone lookup", async () => {
    const { deps, calls } = setup(() => ({ status: 401, body: { success: false, errors: [{ message: "Invalid API Token" }] } }));
    const r = await createCloudflareSolver({}, deps).check("dash.example.com");
    expect(r).toMatchObject({ ok: false, gate: "credentials" });
    expect(calls).toHaveLength(1);
  });

  it("inactive token → gate credentials", async () => {
    const { deps } = setup(() => ok({ id: "t", status: "disabled" }));
    expect(await createCloudflareSolver({}, deps).check("dash.example.com")).toMatchObject({ ok: false, gate: "credentials" });
  });

  it("zoneId set → verify only, no zone lookup", async () => {
    const { deps, calls } = setup(() => verifyOk);
    expect(await createCloudflareSolver({ zoneId: "d".repeat(32) }, deps).check("dash.example.com")).toEqual({ ok: true });
    expect(calls.map((c) => c.path)).toEqual(["/user/tokens/verify"]);
  });

  it("a 5xx on verify throws so the caller keeps the last result", async () => {
    const { deps } = setup(() => ({ status: 502, body: {} }));
    await expect(createCloudflareSolver({}, deps).check("dash.example.com")).rejects.toThrow(/502/);
    await expect(createCloudflareSolver({}, deps).checkCredentials()).rejects.toThrow(/502/);
  });

  it("checkCredentials = token verify only", async () => {
    const { deps, calls } = setup(() => verifyOk);
    expect(await createCloudflareSolver({}, deps).checkCredentials()).toEqual({ ok: true });
    expect(calls.map((c) => c.path)).toEqual(["/user/tokens/verify"]);
    const bad = setup(() => ({ status: 403, body: {} }));
    expect(await createCloudflareSolver({}, bad.deps).checkCredentials()).toMatchObject({ ok: false, gate: "credentials" });
  });
});

describe("acquireOrderLock", () => {
  it("resolves immediately with an idempotent no-op release", async () => {
    const { deps } = setup(() => ok({}));
    const solver = createCloudflareSolver({}, deps);
    const a = await solver.acquireOrderLock({ maxWaitMs: 0 });
    const b = await solver.acquireOrderLock({ maxWaitMs: 0 });
    a.release();
    a.release();
    b.release();
    expect(solver.type).toBe("cloudflare");
  });
});
