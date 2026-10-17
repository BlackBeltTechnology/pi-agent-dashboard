/**
 * `pi-dashboard pair list | approve | deny` (test-plan #E29–#E38, #E44, #E45, #X1–#X5, #X20–#X26).
 * See change: fix-pairing-approval-credential (D2, D3, D9, D12).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  canonicalBinding,
  deriveKey,
  httpPurpose,
  parseProof,
  verifyProofMac,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdPair, type PairDeps } from "../cli.js";

const T = "tok-SECRET-value-for-tests";
const pend = (id: string, extra: Record<string, unknown> = {}) => ({
  pendingId: id,
  provenance: "qr",
  createdAt: 0,
  expiresAt: 240_000,
  attemptsLeft: 5,
  ...extra,
});

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

type Answer = { status: number; body: unknown };
const DEFAULT_APPROVE: Answer = { status: 200, body: { success: true, data: { id: "d1", label: "Phone", tier: "control" } } };
const DEFAULT_DENY: Answer = { status: 200, body: { success: true } };

/** Fake server: `GET /api/pair/pending` + the two POST routes, each answerable per test. */
function fakeServer(over: { pending?: unknown[]; approve?: Answer; deny?: Answer; list?: Answer } = {}) {
  const calls: Call[] = [];
  const answers: Record<string, Answer> = {
    "/api/pair/pending": over.list ?? { status: 200, body: { success: true, data: over.pending ?? [] } },
    "/api/pair/approve-pending": over.approve ?? DEFAULT_APPROVE,
    "/api/pair/deny": over.deny ?? DEFAULT_DENY,
  };
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const answer = answers[new URL(url).pathname];
    if (!answer) throw new Error(`unexpected ${url}`);
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl, posts: () => calls.filter((c) => c.method === "POST") };
}

function harness(server: ReturnType<typeof fakeServer>, extra: Partial<PairDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: PairDeps = {
    fetchImpl: server.fetchImpl,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    localToken: T,
    stdin: Object.assign(Readable.from([]), { isTTY: false }),
    ...extra,
  };
  return { out, err, deps, all: () => [...out, ...err].join("\n") };
}

const tty = (): PairDeps["stdin"] => Object.assign(Readable.from([]), { isTTY: true });
const piped = (text: string): PairDeps["stdin"] => Object.assign(Readable.from(text === "" ? [] : [text]), { isTTY: false });
const cfg = { port: 8000 };

describe("approve — pendingId resolution (#E29)", () => {
  it("no id with exactly one pending: reads the code then POSTs that id", async () => {
    const s = fakeServer({ pending: [pend("only-1")] });
    const prompt = vi.fn(async () => "12345678");
    const h = harness(s, { stdin: tty(), prompt });
    expect(await cmdPair(["approve"], cfg, h.deps)).toBe(0);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(s.posts()).toHaveLength(1);
    expect(s.posts()[0].url).toBe("http://127.0.0.1:8000/api/pair/approve-pending");
    expect(s.posts()[0].body).toMatchObject({ pendingId: "only-1", confirmCode: "12345678" });
  });

  it("no id with zero pending: list printed, exit 2, no POST, no prompt", async () => {
    const s = fakeServer({ pending: [] });
    const prompt = vi.fn(async () => "12345678");
    const h = harness(s, { stdin: tty(), prompt });
    expect(await cmdPair(["approve"], cfg, h.deps)).toBe(2);
    expect(s.posts()).toHaveLength(0);
    expect(prompt).not.toHaveBeenCalled();
    expect(h.err.join("\n")).toContain("no pending");
  });

  it("no id with two pending: both listed in full, exit 2, no POST", async () => {
    const s = fakeServer({ pending: [pend("id-aaa"), pend("id-bbb")] });
    const h = harness(s);
    expect(await cmdPair(["approve"], cfg, h.deps)).toBe(2);
    expect(s.posts()).toHaveLength(0);
    expect(h.out).toContain("id-aaa");
    expect(h.out).toContain("id-bbb");
  });
});

describe("approve — tier and name (#E38)", () => {
  it("forwards --tier operate on the body; omits tier when not given; --name becomes label", async () => {
    const s = fakeServer();
    const withTier = harness(s);
    expect(await cmdPair(["approve", "k1", "--code", "12345678", "--tier", "operate", "--name", "Laptop"], cfg, withTier.deps)).toBe(0);
    expect(s.posts()[0].body).toEqual({ pendingId: "k1", confirmCode: "12345678", label: "Laptop", tier: "operate" });
    const noTier = harness(s);
    expect(await cmdPair(["approve", "k1", "--code", "12345678"], cfg, noTier.deps)).toBe(0);
    expect(s.posts()[1].body).toEqual({ pendingId: "k1", confirmCode: "12345678" });
    expect(Object.hasOwn(s.posts()[1].body!, "tier")).toBe(false);
  });

  it("--tier root: exit 2, no request", async () => {
    const s = fakeServer();
    const h = harness(s);
    expect(await cmdPair(["approve", "k1", "--code", "12345678", "--tier", "root"], cfg, h.deps)).toBe(2);
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("approve — code shape (#E30 #E31 #E32)", () => {
  it.each(["1234567", "123456789", "12a45678"])("--code %s: exit 2 naming 8 digits, zero requests", async (bad) => {
    const s = fakeServer();
    const h = harness(s);
    expect(await cmdPair(["approve", "p1", "--code", bad], cfg, h.deps)).toBe(2);
    expect(h.err.join("\n")).toContain("8 digits");
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(h.all()).not.toContain(bad);
  });

  it.each(["1234 5678", "1234-5678"])("prompt input %j is normalised to 12345678", async (typed) => {
    const s = fakeServer();
    const h = harness(s, { stdin: tty(), prompt: async () => typed });
    expect(await cmdPair(["approve", "p1"], cfg, h.deps)).toBe(0);
    expect(s.posts()[0].body?.confirmCode).toBe("12345678");
  });

  it("a malformed prompt answer is refused locally with exit 2", async () => {
    const s = fakeServer();
    const h = harness(s, { stdin: tty(), prompt: async () => "1234" });
    expect(await cmdPair(["approve", "p1"], cfg, h.deps)).toBe(2);
    expect(s.posts()).toHaveLength(0);
  });
});

describe("approve — non-TTY stdin (#E34 #E35)", () => {
  it("reads only the first line", async () => {
    const s = fakeServer();
    const h = harness(s, { stdin: piped("12345678\n99999999\n") });
    expect(await cmdPair(["approve", "p1"], cfg, h.deps)).toBe(0);
    expect(s.posts()).toHaveLength(1);
    expect(s.posts()[0].body?.confirmCode).toBe("12345678");
  });

  it("EOF with no bytes → exit 2, no POST", async () => {
    const s = fakeServer();
    const h = harness(s, { stdin: piped("") });
    expect(await cmdPair(["approve", "p1"], cfg, h.deps)).toBe(2);
    expect(s.posts()).toHaveLength(0);
  });

  it("an empty first line → exit 2, no POST", async () => {
    const s = fakeServer();
    const h = harness(s, { stdin: piped("\n") });
    expect(await cmdPair(["approve", "p1"], cfg, h.deps)).toBe(2);
    expect(s.posts()).toHaveLength(0);
  });
});

describe("the confirm code never reaches out/err (#E33 #E36 #E37)", () => {
  it("success and mismatch with --code: out/err never contain it, the body carries it once", async () => {
    const ok = fakeServer();
    const h1 = harness(ok);
    await cmdPair(["approve", "p1", "--code", "12345678"], cfg, h1.deps);
    expect(h1.all()).not.toContain("12345678");
    expect(JSON.stringify(ok.calls).match(/12345678/g)).toHaveLength(1);

    const bad = fakeServer({ approve: { status: 400, body: { success: false, error: "mismatch", attemptsLeft: 3 } } });
    const h2 = harness(bad);
    expect(await cmdPair(["approve", "p1", "--code", "12345678"], cfg, h2.deps)).toBe(3);
    expect(h2.all()).not.toContain("12345678");
  });

  it("an interactive prompt code is never echoed", async () => {
    const s = fakeServer();
    const h = harness(s, { stdin: tty(), prompt: async () => "2468 1357" });
    await cmdPair(["approve", "p1"], cfg, h.deps);
    expect(h.all()).not.toMatch(/24681357|2468 1357/);
  });

  it("a pending payload erroneously carrying confirmCode is never printed, in text or --json", async () => {
    const s = fakeServer({ pending: [pend("p-leak", { confirmCode: "87654321", code: "87654321", requesterName: "Phone" })] });
    const text = harness(s);
    expect(await cmdPair(["list"], cfg, text.deps)).toBe(0);
    expect(text.all()).not.toContain("87654321");
    const json = harness(s);
    expect(await cmdPair(["list", "--json"], cfg, json.deps)).toBe(0);
    expect(json.all()).not.toContain("87654321");
    const rows = JSON.parse(json.out.join("\n")) as Record<string, unknown>[];
    expect(Object.keys(rows[0]).sort()).toEqual(["attemptsLeft", "createdAt", "expiresAt", "pendingId", "provenance", "requesterName"]);
  });
});

describe("credential (#E44 #E45)", () => {
  it.each([undefined, "127.0.0.1", "::1"])("host %s: every request carries a proof bound to the dialled URL + method, never the token", async (host) => {
    const s = fakeServer({ pending: [pend("p1")] });
    const h = harness(s);
    const o = { port: 8000, host };
    expect(await cmdPair(["list"], o, h.deps)).toBe(0);
    expect(await cmdPair(["approve", "p1", "--code", "12345678"], o, harness(s).deps)).toBe(0);
    expect(await cmdPair(["deny", "p1"], o, harness(s).deps)).toBe(0);
    expect(s.calls).toHaveLength(3);
    const dial = host === "::1" ? "[::1]" : "127.0.0.1";
    for (const c of s.calls) {
      expect(c.url.startsWith(`http://${dial}:8000/`)).toBe(true);
      const u = new URL(c.url);
      const proof = parseProof(c.headers["X-Pi-Local-Proof"]);
      expect(proof).toBeDefined();
      expect(verifyProofMac(deriveKey(T), proof!, canonicalBinding(u.hostname, 8000), httpPurpose(c.method, u.pathname + u.search))).toBe(true);
      expect(JSON.stringify(c.headers)).not.toContain(T);
      expect(Object.keys(c.headers).map((k) => k.toLowerCase())).not.toContain("x-pi-local-token");
    }
  });
});

describe("credential failures never touch the network or the disk (#X1 #X2 #X3 #X5 #X26)", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp.splice(0)) {
      fs.chmodSync(d, 0o700);
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
  const mk = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pair-tok-"));
    tmp.push(d);
    return d;
  };

  it("X1: injected token dir absent → exit 1 naming the path, no fetch, dir still absent", async () => {
    const dir = path.join(mk(), "nope");
    for (const argv of [["list"], ["approve", "p1", "--code", "12345678"], ["deny", "p1"]]) {
      const s = fakeServer();
      const h = harness(s, { localToken: undefined, tokenDir: dir });
      expect(await cmdPair(argv, cfg, h.deps)).toBe(1);
      expect(h.err.join("\n")).toContain(path.join(dir, "token"));
      expect(s.fetchImpl).not.toHaveBeenCalled();
      expect(fs.existsSync(dir)).toBe(false);
    }
  });

  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")("X2: token file mode 000 / a directory → exit 1, file untouched", async () => {
    const dir = mk();
    const file = path.join(dir, "token");
    fs.writeFileSync(file, T, { mode: 0o600 });
    fs.chmodSync(file, 0o000);
    const s = fakeServer();
    const h = harness(s, { localToken: undefined, tokenDir: dir });
    expect(await cmdPair(["list"], cfg, h.deps)).toBe(1);
    expect(fs.statSync(file).mode & 0o777).toBe(0);
    fs.chmodSync(file, 0o600);
    fs.rmSync(file);
    fs.mkdirSync(file);
    const h2 = harness(s, { localToken: undefined, tokenDir: dir });
    expect(await cmdPair(["list"], cfg, h2.deps)).toBe(1);
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(fs.statSync(file).isDirectory()).toBe(true);
  });

  it("X3: a zero-byte token file → exit 1, file left empty", async () => {
    const dir = mk();
    const file = path.join(dir, "token");
    fs.writeFileSync(file, "");
    const s = fakeServer();
    const h = harness(s, { localToken: undefined, tokenDir: dir });
    expect(await cmdPair(["list"], cfg, h.deps)).toBe(1);
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, "utf-8")).toBe("");
  });

  it("X5: a host-name config.host → exit 1 naming it, nothing sent, any verb", async () => {
    for (const argv of [["list"], ["approve", "p1", "--code", "12345678"], ["deny", "p1"]]) {
      const s = fakeServer();
      const h = harness(s);
      expect(await cmdPair(argv, { port: 8000, host: "myhost.local" }, h.deps)).toBe(1);
      expect(h.err.join("\n")).toContain("myhost.local");
      expect(s.fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("X26: unknown verb / missing verb → usage text + exit 2, fetch 0", async () => {
    for (const argv of [["frob"], []]) {
      const s = fakeServer();
      const h = harness(s);
      expect(await cmdPair(argv, cfg, h.deps)).toBe(2);
      expect(h.err.join("\n")).toContain("usage: pi-dashboard pair");
      expect(s.fetchImpl).not.toHaveBeenCalled();
    }
  });
});

describe("server refusals → exit 3 (#X20 #X21 #X22 #X23)", () => {
  const run = async (status: number, body: unknown, argv = ["approve", "p1", "--code", "12345678"]) => {
    const s = fakeServer({ approve: { status, body }, deny: { status, body } });
    const h = harness(s);
    const code = await cmdPair(argv, cfg, h.deps);
    return { code, text: h.err.join("\n") };
  };

  it("X20 mismatch prints attempts left", async () => {
    const r = await run(400, { success: false, error: "mismatch", attemptsLeft: 3 });
    expect(r.code).toBe(3);
    expect(r.text).toContain("3 attempts left");
  });
  it("X21 locked_out", async () => {
    const r = await run(429, { success: false, error: "locked_out" });
    expect(r.code).toBe(3);
    expect(r.text).toContain("locked out");
  });
  it("X22 expired", async () => {
    const r = await run(400, { success: false, error: "expired" });
    expect(r.code).toBe(3);
    expect(r.text).toContain("expired");
  });
  it("X23 no_pending for approve and deny", async () => {
    for (const argv of [["approve", "p1", "--code", "12345678"], ["deny", "p1"]]) {
      const r = await run(404, { success: false, error: "no_pending" }, argv);
      expect(r.code).toBe(3);
      expect(r.text).toContain("no such pending request");
    }
  });
  it("distinct messages per outcome", async () => {
    const texts = new Set([
      (await run(400, { error: "mismatch", attemptsLeft: 1 })).text,
      (await run(429, { error: "locked_out" })).text,
      (await run(400, { error: "expired" })).text,
      (await run(404, { error: "no_pending" })).text,
    ]);
    expect(texts.size).toBe(4);
  });
});

describe("credential rejected / unreachable (#X24 #X4 #X25)", () => {
  it("X24/X4: a 401 for list, approve and deny → exit 3 'credential rejected'", async () => {
    const body = { success: false, error: "operator credential required" };
    const s = fakeServer({ list: { status: 401, body }, approve: { status: 401, body }, deny: { status: 401, body } });
    for (const argv of [["list"], ["approve", "p1", "--code", "12345678"], ["deny", "p1"]]) {
      const h = harness(s);
      expect(await cmdPair(argv, cfg, h.deps)).toBe(3);
      expect(h.err.join("\n")).toContain("credential rejected");
    }
  });

  it("a rejected token creates no file under an injected token dir", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pair-rej-"));
    try {
      fs.writeFileSync(path.join(dir, "token"), "different-token");
      const s = fakeServer({ list: { status: 401, body: { success: false, error: "x" } } });
      const h = harness(s, { localToken: undefined, tokenDir: dir });
      expect(await cmdPair(["list"], cfg, h.deps)).toBe(3);
      expect(fs.readdirSync(dir)).toEqual(["token"]);
      expect(fs.readFileSync(path.join(dir, "token"), "utf-8")).toBe("different-token");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ECONNREFUSED → exit 4 'server not running'", async () => {
    const down = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:8000");
    }) as unknown as typeof fetch;
    for (const argv of [["list"], ["approve", "p1", "--code", "12345678"], ["deny", "p1"]]) {
      const h = harness(fakeServer(), { fetchImpl: down });
      expect(await cmdPair(argv, cfg, h.deps)).toBe(4);
      expect(h.err.join("\n")).toContain("server not running");
    }
  });

  it("X25: a fetch stalling past the bound → exit 4; the bound defaults to the 5000 ms CLI timeout", async () => {
    const stalled = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason))),
    ) as unknown as typeof fetch;
    const h = harness(fakeServer(), { fetchImpl: stalled, timeoutMs: 20 });
    expect(await cmdPair(["list"], cfg, h.deps)).toBe(4);
    expect(h.err.join("\n")).toContain("server not running");

    const spy = vi.spyOn(AbortSignal, "timeout");
    try {
      const h2 = harness(fakeServer(), { fetchImpl: vi.fn(async () => { throw new Error("x"); }) as unknown as typeof fetch });
      await cmdPair(["list"], cfg, h2.deps);
      expect(spy).toHaveBeenCalledWith(5000);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("list", () => {
  it("prints each pending request and 'no pending' when empty", async () => {
    const full = harness(fakeServer({ pending: [pend("p-1", { requesterName: "Phone", userAgent: "UA/1", remoteAddress: "10.0.0.2", viaHost: "h" })] }));
    expect(await cmdPair(["list"], cfg, full.deps)).toBe(0);
    expect(full.out[0]).toBe("p-1");
    expect(full.out.join("\n")).toContain("name: Phone");
    const empty = harness(fakeServer());
    expect(await cmdPair(["list"], cfg, empty.deps)).toBe(0);
    expect(empty.out.join("\n")).toContain("no pending");
  });

  it("strips terminal escapes the server passed through", async () => {
    const h = harness(fakeServer({ pending: [pend("p-1", { userAgent: "Mozilla\u001b[2J\u202Eevil" })] }));
    await cmdPair(["list"], cfg, h.deps);
    expect(h.out.join("\n")).not.toMatch(/[\u001b\u202E]/);
  });

  it("usage errors: --json on approve, unknown option, pendingId on list → exit 2", async () => {
    for (const argv of [["approve", "p1", "--json"], ["list", "--bogus"], ["list", "p1"], ["deny"], ["approve", "--code"]]) {
      const s = fakeServer();
      const h = harness(s);
      expect(await cmdPair(argv, cfg, h.deps)).toBe(2);
      expect(s.fetchImpl).not.toHaveBeenCalled();
    }
  });
});
