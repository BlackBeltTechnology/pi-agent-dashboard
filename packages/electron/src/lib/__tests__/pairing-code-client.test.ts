/**
 * In-app "Pair with code": decode → refuse wrong identity before any request → prove at the first
 * payload https URL that proves the pin → redeem → wait for approval → store under keyring rules.
 * See change: group-servers-by-identity (D8; test-plan X11, X12, X14, F14 logic half).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectingState } from "../pairing-client.js";
import { decodePairingText, startCodePairing } from "../pairing-code-client.js";
import { type CryptoPort, loadKeyring, type ServerKeyring } from "../server-keyring.js";

const F = `sha256:${"A".repeat(43)}`;
const G = `sha256:${"B".repeat(43)}`;
const BEARER = "BEARER-ZZ9";
const CONFIRM = "48217730";
const PAIR_CODE = "PAIR-ZZ9";
const U1 = "https://one.share.zrok.io";
const U2 = "https://two.share.zrok.io";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const payload = (over: Partial<{ id: string; code: string; urls: string[] }> = {}) => ({ v: 1, id: F, code: PAIR_CODE, urls: [U1], ...over });
const copyString = (p: unknown) => `pi:pair:v1.${b64url(p)}`;

let dir: string;
let keyring: ServerKeyring;
let logs: string[];
let states: ConnectingState[];

const okCrypto: CryptoPort = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s).reverse(),
  decryptString: (b) => Buffer.from(b).reverse().toString(),
};

const mkKeyring = (crypto: CryptoPort = okCrypto) => loadKeyring({ dir, crypto, log: (l) => logs.push(l) });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "codepair-"));
  logs = [];
  states = [];
  keyring = mkKeyring();
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

function stubFetch(opts: { redeem?: () => Response; polls?: Array<{ status: string; token?: string; routes?: unknown }> } = {}) {
  const polls = [...(opts.polls ?? [{ status: "pending" }, { status: "approved", token: BEARER }])];
  const f = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/pair/redeem")) return (opts.redeem ?? (() => json(200, { success: true, data: { pendingId: "p1", confirmCode: CONFIRM } })))();
    if (u.endsWith("/api/pair/poll")) return json(200, { success: true, data: polls.shift() ?? { status: "pending" } });
    return json(404, {});
  });
  vi.stubGlobal("fetch", f);
  return f;
}

type Prove = Parameters<typeof startCodePairing>[1]["prove"];
const proveMap =
  (m: Record<string, string | "throw" | "refuse">): Prove =>
  async (url) => {
    const v = m[url];
    if (v === "throw") throw new Error("ECONNREFUSED");
    if (v === undefined || v === "refuse") return { refused: "challenge answered 404" };
    return { proven: v, publicKey: "PUBKEY" };
  };

function start(prove: Prove, over: { fingerprint?: string; label?: string; keyring?: ServerKeyring } = {}) {
  return startCodePairing(
    { fingerprint: over.fingerprint ?? F, label: over.label ?? "build-box", deviceName: "my-mac" },
    { prove, keyring: over.keyring ?? keyring, log: (l) => logs.push(l), onState: (s) => states.push(s), sleep: async () => {} },
  );
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const redeemUrls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map(([u]) => String(u)).filter((u) => u.endsWith("/api/pair/redeem"));

describe("decodePairingText", () => {
  it.each([
    ["copy-string", copyString(payload())],
    ["deep link", `https://one.share.zrok.io/pair#${copyString(payload())}`],
    ["bare base64url", b64url(payload())],
    ["raw JSON", JSON.stringify(payload())],
  ])("accepts the %s form", (_n, text) => {
    expect(decodePairingText(text)).toEqual({ id: F, code: PAIR_CODE, urls: [U1] });
  });

  it.each([["empty", ""], ["garbage", "%%%"], ["json without id", b64url({ code: "x", urls: [] })], ["urls not an array", b64url({ id: F, code: "x", urls: "u" })], ["huge", "A".repeat(40_000)]])("rejects %s", (_n, text) => {
    expect(decodePairingText(text)).toBeNull();
  });
});

describe("refusals before any request (#X11)", () => {
  it("#X11: a payload for another server is refused with zero network calls", async () => {
    const f = stubFetch();
    const prove = vi.fn(proveMap({ [U1]: F }));
    const s = start(prove);
    await settle();
    expect(states.at(-1)).toMatchObject({ phase: "code", mode: "code" });
    s.submitCode(copyString(payload({ id: G })));
    expect(await s.done).toEqual({ status: "mismatch" });
    expect(prove).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({ phase: "mismatch", expectedShort: `sha256:${"A".repeat(16)}`, provenShort: `sha256:${"B".repeat(16)}` });
  });

  it("#X11: text that is not a pairing payload is refused with zero network calls", async () => {
    const f = stubFetch();
    const prove = vi.fn(proveMap({}));
    const s = start(prove);
    await settle();
    s.submitCode("not a pairing code");
    expect(await s.done).toEqual({ status: "refused" });
    expect(f).not.toHaveBeenCalled();
    expect(prove).not.toHaveBeenCalled();
    expect(states.at(-1)?.message).toMatch(/pairing code/i);
  });

  it("#X11: only wss:// and http:// urls ⇒ refused, nothing contacted", async () => {
    const f = stubFetch();
    const prove = vi.fn(proveMap({}));
    const s = start(prove);
    await settle();
    s.submitCode(copyString(payload({ urls: ["wss://one.share.zrok.io", "http://192.168.16.204:8000", "https://10.0.0.5"] })));
    expect(await s.done).toEqual({ status: "refused" });
    expect(f).not.toHaveBeenCalled();
    expect(prove).not.toHaveBeenCalled();
  });
});

describe("prove at the first url that proves the pin (#X11)", () => {
  it("#X11: [u1 proves G, u2 proves F] ⇒ redeem is posted to u2 only", async () => {
    const f = stubFetch();
    const s = start(proveMap({ [U1]: G, [U2]: F }));
    await settle();
    s.submitCode(copyString(payload({ urls: [U1, U2] })));
    expect(await s.done).toEqual({ status: "approved", fingerprint: F });
    expect(redeemUrls(f)).toEqual([`${U2}/api/pair/redeem`]);
    expect(f.mock.calls.every(([u]) => String(u).startsWith(U2))).toBe(true);
  });

  it("#X11: [u1 proves G, u2 unreachable] ⇒ the code is not redeemed, identity mismatch shown", async () => {
    const f = stubFetch();
    const s = start(proveMap({ [U1]: G, [U2]: "throw" }));
    await settle();
    s.submitCode(copyString(payload({ urls: [U1, U2] })));
    expect(await s.done).toEqual({ status: "mismatch" });
    expect(f).not.toHaveBeenCalled();
    expect(keyring.list()).toEqual([]);
  });

  it("#X11: every url unreachable ⇒ not redeemed, unreachable shown", async () => {
    const f = stubFetch();
    const s = start(proveMap({ [U1]: "throw" }));
    await settle();
    s.submitCode(copyString(payload()));
    expect(await s.done).toEqual({ status: "unreachable" });
    expect(f).not.toHaveBeenCalled();
    expect(states.at(-1)?.message).toMatch(/could not verify|reach/i);
  });
});

describe("redeem, approval and storage", () => {
  it("#X11: success ⇒ waiting shows the compare code, the bearer lands in the keyring with the proven https host (source pairing), no window state beyond the connecting states", async () => {
    stubFetch({ polls: [{ status: "pending" }, { status: "approved", token: BEARER }] });
    const s = start(proveMap({ [U1]: F }));
    await settle();
    s.submitCode(copyString(payload()));
    expect(await s.done).toEqual({ status: "approved", fingerprint: F });
    expect(states.find((x) => x.phase === "waiting")).toMatchObject({ confirmCode: CONFIRM, mode: "code", unencrypted: false });
    expect(states.map((x) => x.phase)).toEqual(["code", "proving", "proving", "waiting", "approved"]); // 2nd proving = verified host shown
    expect(keyring.bearerFor(F)).toBe(BEARER);
    expect(keyring.get(F)).toMatchObject({ label: "build-box", pinnedPubkey: "PUBKEY", needsPairing: false, remembered: true });
    expect(keyring.get(F)!.lastHosts).toEqual([{ scheme: "https", host: "one.share.zrok.io", port: 443, source: "pairing" }]);
  });

  it("#X11: delivered routes (and other payload urls) are recorded only after they prove F, at most 3 in all", async () => {
    stubFetch({ polls: [{ status: "approved", token: BEARER, routes: ["https://d1.share.zrok.io", "https://d2.share.zrok.io", "https://d3.share.zrok.io"] }] });
    const prove = proveMap({ [U1]: F, [U2]: F, "https://d1.share.zrok.io": G, "https://d2.share.zrok.io": F, "https://d3.share.zrok.io": F });
    const s = start(prove);
    await settle();
    s.submitCode(copyString(payload({ urls: [U1, U2] })));
    await s.done;
    const hosts = keyring.get(F)!.lastHosts.map((h) => h.host);
    expect(hosts).toEqual(["two.share.zrok.io", "d2.share.zrok.io", "one.share.zrok.io"]); // U1 (redeemed) + 2 more = 3 in all
    expect(logs.some((l) => l.includes("identity-mismatch") && l.includes("d1.share.zrok.io:443"))).toBe(true);
  });

  it("#X11: the redeem answered with a refusal ⇒ nothing stored, the window says so", async () => {
    stubFetch({ redeem: () => json(400, { success: false, error: "invalid_or_expired" }) });
    const s = start(proveMap({ [U1]: F }));
    await settle();
    s.submitCode(copyString(payload()));
    expect(await s.done).toEqual({ status: "refused" });
    expect(states.at(-1)?.message).toMatch(/new (pairing )?code/i);
    expect(keyring.list()).toEqual([]);
  });

  it("#X11: a rate-limited redeem is reported as such", async () => {
    stubFetch({ redeem: () => json(429, { success: false, error: "rate_limited" }) });
    const s = start(proveMap({ [U1]: F }));
    await settle();
    s.submitCode(copyString(payload()));
    expect(await s.done).toEqual({ status: "refused" });
    expect(states.at(-1)?.message).toMatch(/too many/i);
  });

  it("#X11: operator rejects ⇒ nothing stored", async () => {
    stubFetch({ polls: [{ status: "pending" }, { status: "rejected" }] });
    const s = start(proveMap({ [U1]: F }));
    await settle();
    s.submitCode(copyString(payload()));
    expect(await s.done).toEqual({ status: "rejected" });
    expect(keyring.list()).toEqual([]);
  });

  it("closing the window before pasting resolves stopped; a second submission is ignored", async () => {
    const f = stubFetch();
    const s = start(proveMap({}));
    await settle();
    s.stop();
    s.submitCode(copyString(payload()));
    expect(await s.done).toEqual({ status: "stopped" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("encryption unavailable (#X12, code path)", () => {
  it("#X12: the code-redeemed bearer stays off disk, memory-only for this run, entry not remembered", async () => {
    const k = mkKeyring({ ...okCrypto, isEncryptionAvailable: () => false });
    stubFetch();
    const s = start(proveMap({ [U1]: F }), { keyring: k });
    await settle();
    s.submitCode(copyString(payload()));
    expect(await s.done).toEqual({ status: "approved", fingerprint: F });
    expect(k.bearerFor(F)).toBe(BEARER);
    expect(k.get(F)).toMatchObject({ remembered: false });
    expect(fs.readFileSync(path.join(dir, "server-keyring.json"), "utf8")).not.toContain(BEARER);
  });
});

describe("no secrets in logs or renderer messages (#X14)", () => {
  it("#X14: the pasted text, the pairing code, the bearer and the confirm code are in no log line; states carry the confirm code only while waiting", async () => {
    stubFetch({ polls: [{ status: "approved", token: BEARER, routes: ["https://d2.share.zrok.io", "https://user:pw@evil.example"] }] });
    const text = copyString(payload({ urls: [U1] }));
    const s = start(proveMap({ [U1]: F, "https://d2.share.zrok.io": G }));
    await settle();
    s.submitCode(text);
    await s.done;
    const all = logs.join("\n");
    for (const secret of [text, text.slice(11), PAIR_CODE, BEARER, CONFIRM, "pw@", "A".repeat(43)]) expect(all, secret).not.toContain(secret);
    expect(all).toContain("sha256:AAAAAAAAAAAAAAAA");
    const rendered = JSON.stringify(states.map(({ confirmCode: _c, ...rest }) => rest));
    for (const secret of [text, text.slice(11), PAIR_CODE, BEARER, CONFIRM]) expect(rendered, secret).not.toContain(secret);
    expect(states.filter((x) => x.confirmCode).map((x) => x.phase)).toEqual(["waiting"]);
  });

  it("#X14: refusals (wrong server, junk text, wrong redeem) log no text either", async () => {
    stubFetch({ redeem: () => json(400, { success: false, error: "x" }) });
    for (const text of [copyString(payload({ id: G })), "junk PAIR-ZZ9 text", copyString(payload())]) {
      const s = start(proveMap({ [U1]: F }));
      await settle();
      s.submitCode(text);
      await s.done;
      expect(logs.join("\n")).not.toContain(text);
      expect(logs.join("\n")).not.toContain(PAIR_CODE);
    }
  });
});
