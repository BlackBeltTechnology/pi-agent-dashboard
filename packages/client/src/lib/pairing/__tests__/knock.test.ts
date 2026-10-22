/**
 * Native knock helper: challenge → knock → poll, pinning the discovered identity.
 * See change: add-lan-knock-pairing (D11; test-plan #E32).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type KnockHooks, knockServer } from "../knock.js";

const challengeIdentity = vi.fn();
vi.mock("../pair-protocol.js", () => ({
  challengeIdentity: (...a: unknown[]) => challengeIdentity(...a),
}));

const BASE = "http://192.168.16.204:8000";
const F = "sha256:advertised-F";
const G = "sha256:impostor-G";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const requested = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter(([u]) => String(u).endsWith("/api/pair/request"));

/** Route fetch by path; `polls` is consumed one entry per `/api/pair/poll` call. */
function routeFetch(opts: { request: () => Response; polls?: Array<{ status: string; token?: string }> }) {
  const polls = [...(opts.polls ?? [])];
  const f = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith("/api/pair/request")) return opts.request();
    if (u.endsWith("/api/pair/poll")) return json(200, { success: true, data: polls.shift() ?? { status: "pending" } });
    return json(404, {});
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const knockOk = (fingerprint = F) =>
  json(200, { success: true, data: { pendingId: "p1", confirmCode: "12345678", expiresAt: 1_000_000, fingerprint } });

let hooks: KnockHooks;
beforeEach(() => {
  challengeIdentity.mockReset();
  hooks = { onWaiting: vi.fn(), now: () => 0, sleep: vi.fn(async () => {}) };
});
afterEach(() => vi.unstubAllGlobals());

describe("knockServer (E32)", () => {
  it("challenge proves G ≠ advertised F → identity_mismatch, NO /api/pair/request call", async () => {
    challengeIdentity.mockResolvedValue({ fingerprint: G, publicKey: "pk", verified: true });
    const f = routeFetch({ request: () => knockOk() });
    const out = await knockServer(BASE, F, "Laptop", hooks);
    expect(out).toMatchObject({ status: "identity_mismatch", expected: F, proven: G });
    expect(requested(f)).toHaveLength(0);
    expect(hooks.onWaiting).not.toHaveBeenCalled();
  });

  it("an unverified signature is an identity mismatch too (no knock)", async () => {
    challengeIdentity.mockResolvedValue({ fingerprint: F, publicKey: "pk", verified: false });
    const f = routeFetch({ request: () => knockOk() });
    const out = await knockServer(BASE, F, "Laptop", hooks);
    expect(out.status).toBe("identity_mismatch");
    expect(requested(f)).toHaveLength(0);
  });

  it("proves F, knock response fingerprint F, approved → bearer returned", async () => {
    challengeIdentity.mockResolvedValue({ fingerprint: F, publicKey: "pk", verified: true });
    const f = routeFetch({
      request: () => knockOk(F),
      polls: [{ status: "pending" }, { status: "approved", token: "BEARER" }],
    });
    const out = await knockServer(BASE, F, "Laptop", hooks);
    expect(out).toEqual({ status: "approved", token: "BEARER", fingerprint: F });
    expect(challengeIdentity).toHaveBeenCalledWith(BASE);
    const [url, init] = requested(f)[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/pair/request`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ name: "Laptop" });
    expect(hooks.onWaiting).toHaveBeenCalledWith({ pendingId: "p1", confirmCode: "12345678", expiresAt: 1_000_000 });
  });

  it("proves F but knock response fingerprint G → identity_mismatch, bearer NOT returned", async () => {
    challengeIdentity.mockResolvedValue({ fingerprint: F, publicKey: "pk", verified: true });
    const f = routeFetch({ request: () => knockOk(G), polls: [{ status: "approved", token: "STOLEN" }] });
    const out = await knockServer(BASE, F, "Laptop", hooks);
    expect(out).toMatchObject({ status: "identity_mismatch", expected: F, proven: G });
    expect(JSON.stringify(out)).not.toContain("STOLEN");
    expect(f.mock.calls.some(([u]) => String(u).endsWith("/api/pair/poll"))).toBe(false);
  });

  it("rejected on the device → rejected outcome, no bearer", async () => {
    challengeIdentity.mockResolvedValue({ fingerprint: F, publicKey: "pk", verified: true });
    routeFetch({ request: () => knockOk(), polls: [{ status: "pending" }, { status: "rejected" }] });
    const out = await knockServer(BASE, F, "Laptop", hooks);
    expect(out).toEqual({ status: "rejected" });
  });

  it("a transient transport failure while polling keeps waiting until the outcome (review r1)", async () => {
    challengeIdentity.mockResolvedValue({ fingerprint: F, publicKey: "pk", verified: true });
    let polls = 0;
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/api/pair/request")) return knockOk();
      polls++;
      if (polls === 1) throw new TypeError("Failed to fetch");
      return json(200, { success: true, data: { status: "approved", token: "tok" } });
    });
    vi.stubGlobal("fetch", f);
    const out = await knockServer(BASE, F, "Laptop", hooks);
    expect(out).toMatchObject({ status: "approved", token: "tok" });
    expect(polls).toBe(2);
  });

  it("a transport failure after expiresAt still throws", async () => {
    challengeIdentity.mockResolvedValue({ fingerprint: F, publicKey: "pk", verified: true });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/api/pair/request")) return knockOk();
      throw new TypeError("Failed to fetch");
    }));
    await expect(knockServer(BASE, F, "Laptop", { ...hooks, now: () => 2_000_000 })).rejects.toThrow(TypeError);
  });

  it("poll `unknown` or an elapsed expiresAt → expired", async () => {
    challengeIdentity.mockResolvedValue({ fingerprint: F, publicKey: "pk", verified: true });
    routeFetch({ request: () => knockOk(), polls: [{ status: "unknown" }] });
    expect(await knockServer(BASE, F, "Laptop", hooks)).toEqual({ status: "expired" });

    routeFetch({ request: () => knockOk() }); // endless pending
    const late = { ...hooks, now: () => 2_000_000 };
    expect(await knockServer(BASE, F, "Laptop", late)).toEqual({ status: "expired" });
  });

  it("surfaces a typed refusal with retryAfter", async () => {
    challengeIdentity.mockResolvedValue({ fingerprint: F, publicKey: "pk", verified: true });
    routeFetch({ request: () => json(429, { success: false, error: "knock_rate_limited", retryAfter: 42 }) });
    expect(await knockServer(BASE, F, "Laptop", hooks)).toEqual({
      status: "refused", reason: "knock_rate_limited", retryAfter: 42, httpStatus: 429,
    });

    routeFetch({ request: () => json(403, { error: "untrusted origin" }) }); // no `success` field
    expect(await knockServer(BASE, F, "Laptop", hooks)).toMatchObject({ status: "refused", reason: "untrusted origin" });
  });

  it("aborting stops polling → cancelled", async () => {
    challengeIdentity.mockResolvedValue({ fingerprint: F, publicKey: "pk", verified: true });
    routeFetch({ request: () => knockOk() });
    const ac = new AbortController();
    const sleep = vi.fn(async () => { ac.abort(); });
    expect(await knockServer(BASE, F, "Laptop", { ...hooks, sleep, signal: ac.signal })).toEqual({ status: "cancelled" });
  });
});

// See change: group-servers-by-identity (test-plan #X5).
describe("X5 an advert is a hint: knocking a route that proves another identity sends nothing", () => {
  it("advert claims F, the challenge proves G → no request of any kind (no knock, no poll, no Authorization)", async () => {
    challengeIdentity.mockResolvedValue({ fingerprint: G, publicKey: "pk", verified: true });
    const f = routeFetch({ request: () => knockOk() });
    const out = await knockServer(BASE, F, "Laptop", { onWaiting: vi.fn(), now: () => 0, sleep: vi.fn(async () => {}) });
    expect(out).toMatchObject({ status: "identity_mismatch", expected: F, proven: G });
    expect(f).not.toHaveBeenCalled();
  });
});

// See change: group-servers-by-identity (task 4.3): delivered routes ride the approved outcome only.
describe("approved knock outcome carries validated delivered routes", () => {
  it("keeps valid https origins, drops the rest; absent when none survive", async () => {
    challengeIdentity.mockResolvedValue({ fingerprint: F, publicKey: "pk", verified: true });
    const polls = [{ status: "approved", token: "B", routes: ["https://k3x9p2.share.zrok.io/", "http://evil.example", "https://10.0.0.5"] }];
    routeFetch({ request: () => knockOk(F), polls: polls as never });
    const out = await knockServer(BASE, F, "Laptop", hooks);
    expect(out).toEqual({ status: "approved", token: "B", fingerprint: F, routes: ["https://k3x9p2.share.zrok.io"] });
  });
});
