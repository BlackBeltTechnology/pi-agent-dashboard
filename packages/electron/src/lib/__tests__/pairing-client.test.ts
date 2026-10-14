/**
 * Pairing client: prove → confirm → knock → poll, identity gates, logging hygiene.
 * See change: add-electron-server-windows (test-plan E2–E4, X7, X8, X10, X11, X12).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ConnectingState, type PairingTarget, startPairing } from "../pairing-client.js";
import { loadKeyring, type ServerKeyring } from "../server-keyring.js";

const F = `sha256:${"A".repeat(43)}`;
const G = `sha256:${"B".repeat(43)}`;
const H = `sha256:${"C".repeat(43)}`;
const BEARER = "BEARER-secret-token";
const CODE = "48217730";
const ref = { scheme: "http" as const, host: "192.168.16.204", port: 8000 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

let dir: string;
let keyring: ServerKeyring;
let logs: string[];
let states: ConnectingState[];

const crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s).reverse(),
  decryptString: (b: Buffer) => Buffer.from(b).reverse().toString(),
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pairing-"));
  logs = [];
  states = [];
  keyring = loadKeyring({ dir, crypto, log: (l) => logs.push(l) });
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

const target = (over: Partial<PairingTarget> = {}): PairingTarget => ({
  label: "home-imac",
  ref,
  deviceName: "my-mac",
  ...over,
});

function routeFetch(opts: { request?: () => Response; polls?: Array<{ status: string; token?: string }> } = {}) {
  const polls = [...(opts.polls ?? [{ status: "pending" }, { status: "approved", token: BEARER }])];
  const f = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/pair/request"))
      return (opts.request ?? (() => json(200, { success: true, data: { pendingId: "p1", confirmCode: CODE, expiresAt: 1_000_000, fingerprint: F } })))();
    if (u.endsWith("/api/pair/poll")) return json(200, { success: true, data: polls.shift() ?? { status: "pending" } });
    return json(404, {});
  });
  vi.stubGlobal("fetch", f);
  return f;
}
const posts = (f: ReturnType<typeof vi.fn>, suffix: string) => f.mock.calls.filter(([u]) => String(u).endsWith(suffix));

function run(t: PairingTarget, prove: Parameters<typeof startPairing>[1]["prove"], extra: Partial<Parameters<typeof startPairing>[1]> = {}) {
  return startPairing(t, {
    prove,
    keyring,
    log: (l) => logs.push(l),
    onState: (s) => states.push(s),
    now: () => 0,
    sleep: async () => {},
    ...extra,
  });
}
const phases = () => states.map((s) => s.phase);
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("manual URL — trust on first use (E2)", () => {
  it("shows the full proven fingerprint, sends nothing until sendRequest(), pins only after approval", async () => {
    const f = routeFetch();
    const s = run(target(), async () => ({ proven: F, publicKey: "PUBKEY" }));
    await settle();
    expect(phases()).toEqual(["proving", "confirm"]);
    expect(states.at(-1)).toMatchObject({ tofu: true, fullFp: F, deviceName: "my-mac", unencrypted: true });
    expect(posts(f, "/api/pair/request")).toHaveLength(0);
    expect(keyring.has(F)).toBe(false);

    s.send("Laptop");
    const res = await s.done;
    expect(res).toEqual({ status: "approved", fingerprint: F });
    expect(posts(f, "/api/pair/request")).toHaveLength(1);
    expect(JSON.parse(String(posts(f, "/api/pair/request")[0]![1]!.body))).toEqual({ name: "Laptop" });
    expect(phases()).toContain("waiting");
    expect(states.find((x) => x.phase === "waiting")).toMatchObject({ confirmCode: CODE });
    expect(keyring.get(F)).toMatchObject({ pinnedPubkey: "PUBKEY", label: "home-imac", needsPairing: false });
    expect(keyring.bearerFor(F)).toBe(BEARER);
  });

  it("an advertised fingerprint is not TOFU: no full fingerprint prompt", async () => {
    routeFetch();
    const s = run(target({ advertFp: F }), async () => ({ proven: F }));
    await settle();
    expect(states.at(-1)).toMatchObject({ phase: "confirm", tofu: false });
    expect(states.at(-1)?.fullFp).toBeUndefined();
    s.stop();
    expect((await s.done).status).toBe("stopped");
  });

  it("empty device name ⇒ request body {}", async () => {
    const f = routeFetch();
    const s = run(target({ advertFp: F }), async () => ({ proven: F }));
    await settle();
    s.send("   ");
    await s.done;
    expect(JSON.parse(String(posts(f, "/api/pair/request")[0]![1]!.body))).toEqual({});
  });
});

describe("stop() while still proving (review)", () => {
  it("resolves `done` as stopped, never emits confirm, sends nothing", async () => {
    const f = routeFetch();
    let release!: (v: { proven: string }) => void;
    const s = run(target({ advertFp: F }), () => new Promise((r) => (release = r as typeof release)));
    await settle();
    s.stop(); // window closed during `proving`
    release({ proven: F });
    expect(await s.done).toEqual({ status: "stopped" });
    expect(phases()).not.toContain("confirm");
    expect(posts(f, "/api/pair/request")).toHaveLength(0);
    expect(keyring.list()).toEqual([]);
  });
});

describe("identity gates (E3, E4, X7, X8)", () => {
  it("E3: pin F, advert G ⇒ mismatch naming both shorts; no network at all", async () => {
    const f = routeFetch();
    const prove = vi.fn(async () => ({ proven: F }));
    const s = run(target({ pinnedFp: F, advertFp: G }), prove);
    expect(await s.done).toEqual({ status: "mismatch" });
    expect(prove).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
    const st = states.at(-1)!;
    expect(st).toMatchObject({ phase: "mismatch", expectedShort: `sha256:${"A".repeat(16)}`, provenShort: `sha256:${"B".repeat(16)}` });
    expect(logs.filter((l) => l.includes("identity-mismatch"))).toHaveLength(1);
  });

  it("X7: advert F, challenge proves G ⇒ mismatch, zero knock POSTs, keyring unchanged, one log line", async () => {
    const f = routeFetch();
    const s = run(target({ advertFp: F }), async () => ({ proven: G }));
    expect(await s.done).toEqual({ status: "mismatch" });
    expect(posts(f, "/api/pair/request")).toHaveLength(0);
    expect(keyring.list()).toEqual([]);
    expect(states.at(-1)).toMatchObject({ phase: "mismatch", expectedShort: expect.stringContaining("AAAA"), provenShort: expect.stringContaining("BBBB") });
    expect(logs.filter((l) => l.includes("identity-mismatch"))).toHaveLength(1);
  });

  it("E4: challenge proves F, knock response fingerprint G ⇒ mismatch(response), poll never called, keyring unchanged", async () => {
    const f = routeFetch({
      request: () => json(200, { success: true, data: { pendingId: "p", confirmCode: CODE, expiresAt: 1_000_000, fingerprint: G } }),
    });
    const s = run(target({ advertFp: F }), async () => ({ proven: F }));
    await settle();
    s.send("x");
    expect(await s.done).toEqual({ status: "mismatch" });
    expect(posts(f, "/api/pair/poll")).toHaveLength(0);
    expect(keyring.list()).toEqual([]);
    expect(logs.some((l) => l.includes("stage=response"))).toBe(true);
  });

  it.each([
    ["404", async () => ({ refused: "challenge answered 404" })],
    ["ECONNREFUSED", async () => { throw new Error("ECONNREFUSED"); }],
  ])("X8: %s ⇒ unverifiable, no knock", async (_n, prove) => {
    const f = routeFetch();
    const s = run(target({ advertFp: F }), prove as never);
    expect(await s.done).toEqual({ status: "unverifiable" });
    expect(posts(f, "/api/pair/request")).toHaveLength(0);
    expect(states.at(-1)?.message).toMatch(/cannot verify/i);
    expect(states.at(-1)?.message).toMatch(/unreachable, or too old/);
  });

  it("X8: a TOFU target whose challenge is refused is unverifiable too", async () => {
    routeFetch();
    const s = run(target(), async () => ({ refused: "challenge answered 404" }));
    expect(await s.done).toEqual({ status: "unverifiable" });
  });
});

describe("terminal phases (X10, X11)", () => {
  it("X10: Stop waiting aborts polling, stores nothing, window text says request remains", async () => {
    let polls = 0;
    let s!: ReturnType<typeof run>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.endsWith("/api/pair/request")) return json(200, { success: true, data: { pendingId: "p", confirmCode: CODE, expiresAt: 1_000_000, fingerprint: F } });
        polls++;
        return json(200, { success: true, data: { status: "pending" } });
      }),
    );
    let sleeps = 0;
    s = run(target({ advertFp: F }), async () => ({ proven: F }), {
      sleep: async () => {
        if (++sleeps === 2) s.stop();
      },
    });
    await settle();
    s.send("x");
    expect(await s.done).toEqual({ status: "stopped" });
    const after = polls;
    await settle();
    expect(polls).toBe(after);
    expect(keyring.list()).toEqual([]);
    expect(states.at(-1)?.message).toMatch(/stays visible on home-imac until it expires/);
  });

  it("X11: rejected ⇒ nothing stored, logged", async () => {
    routeFetch({ polls: [{ status: "pending" }, { status: "rejected" }] });
    const s = run(target({ advertFp: F }), async () => ({ proven: F }));
    await settle();
    s.send("x");
    expect(await s.done).toEqual({ status: "rejected" });
    expect(keyring.list()).toEqual([]);
    expect(logs.some((l) => l.includes("pairing rejected"))).toBe(true);
  });

  it("X11: expiresAt elapsed ⇒ expired, nothing stored", async () => {
    routeFetch({ polls: [] });
    const s = run(target({ advertFp: F }), async () => ({ proven: F }), { now: () => 2_000_000 });
    await settle();
    s.send("x");
    expect(await s.done).toEqual({ status: "expired" });
    expect(keyring.list()).toEqual([]);
    expect(logs.some((l) => l.includes("pairing expired"))).toBe(true);
  });

  it.each([
    ["knock_disabled", /isn't accepting requests from the network.*Gateway/s],
    ["knock_not_lan", /only accepted from the same local network/],
    ["knock_pending", /already waiting/],
    ["knock_busy", /Several devices are already waiting/],
    ["host_not_admitted", /refused the request/],
  ])("refusal %s uses the shared wording and stores nothing", async (code, re) => {
    routeFetch({ request: () => json(403, { success: false, error: code }) });
    const s = run(target({ advertFp: F }), async () => ({ proven: F }));
    await settle();
    s.send("x");
    expect(await s.done).toEqual({ status: "refused" });
    expect(states.at(-1)?.message).toMatch(re);
    expect(states.at(-1)?.noRetry).toBe(code === "knock_not_lan" || code === "knock_pending");
    expect(keyring.list()).toEqual([]);
  });

  it("rate-limited refusal substitutes the retry time", async () => {
    routeFetch({ request: () => json(429, { success: false, error: "knock_rate_limited", retryAfter: 30 }) });
    const s = run(target({ advertFp: F }), async () => ({ proven: F }));
    await settle();
    s.send("x");
    await s.done;
    expect(states.at(-1)?.message).toContain("0:30");
  });
});

describe("observability without secrets (X12)", () => {
  it("no log line contains the bearer, the code or the device name; outcome lines carry a short fp", async () => {
    routeFetch();
    const s = run(target({ advertFp: F }), async () => ({ proven: F }));
    await settle();
    s.send("SecretDeviceName");
    await s.done;
    const all = logs.join("\n");
    for (const secret of [BEARER, CODE, "SecretDeviceName", "my-mac"]) expect(all).not.toContain(secret);
    expect(logs.some((l) => l.includes("pairing approved") && l.includes(`sha256:${"A".repeat(16)}`))).toBe(true);
    // the full fingerprint is never logged either
    expect(all).not.toContain(F);
    // and no state carries the bearer
    expect(JSON.stringify(states)).not.toContain(BEARER);
  });

  it("a mismatch for a TOFU-proven H logs short forms only", async () => {
    routeFetch();
    const s = run(target({ advertFp: H }), async () => ({ proven: G }));
    await s.done;
    expect(logs.join("\n")).not.toContain(G);
    expect(logs.join("\n")).not.toContain(H);
  });
});
