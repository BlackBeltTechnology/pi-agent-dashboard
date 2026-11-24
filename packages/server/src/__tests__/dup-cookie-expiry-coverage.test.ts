/**
 * Duplicate `pi_dash_*` cookie refusal — self-heal coverage and refusal size.
 *
 *  T.E116  every cookie path the browser could send is in the expiry set (RFC 6265 §5.1.4 oracle)
 *  T.P15   refusal response size stays under Node's header limit (depth × tier 2 × HTML/JSON × upgrade head)
 *
 * See change: serve-live-previews-on-capability-origin (D10; test-plan #E116, #P15).
 */
import http from "node:http";
import type net from "node:net";
import type { Duplex } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  ancestorDomains,
  buildExpiryLines,
  createDuplicateCookieGate,
  DuplicateCookieLog,
  expiryPaths,
  refuseDuplicateCookieUpgrade,
} from "../auth/duplicate-cookie-gate.js";

// ─── RFC 6265 §5.1.4 path-match, implemented independently of the code under test ───────────────────────

/** Does a cookie stored with `Path=cookiePath` get sent on a request for `requestPath`? */
function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (cookiePath === requestPath) return true;
  if (requestPath.startsWith(cookiePath) && cookiePath.endsWith("/")) return true;
  if (requestPath.startsWith(cookiePath) && requestPath.charAt(cookiePath.length) === "/") return true;
  return false;
}

/** Sanity-check the oracle itself (case-sensitive, boundary-exact). */
describe("T.E116 oracle (RFC 6265 §5.1.4)", () => {
  it("matches exactly the three RFC rules and is case-sensitive", () => {
    expect(pathMatches("/", "/api/x")).toBe(true);
    expect(pathMatches("/api/", "/api/x")).toBe(true);
    expect(pathMatches("/api", "/api/x")).toBe(true);
    expect(pathMatches("/api", "/api")).toBe(true);
    expect(pathMatches("/api", "/apix")).toBe(false);
    expect(pathMatches("/api/", "/api")).toBe(false);
    expect(pathMatches("/API/", "/api/x")).toBe(false);
    expect(pathMatches("/a/b", "/a")).toBe(false);
  });
});

// ─── generators ───────────────────────────────────────────────────────────────────────────────────────

const ALPHABET = ["a", "B", "%2F", ".", ".."] as const;
const MAX_DEPTH = 6;

/** mulberry32 — a seeded PRNG so a failure reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const join = (segs: string[], trailing: boolean) => (segs.length === 0 ? "/" : `/${segs.join("/")}${trailing ? "/" : ""}`);

/** Every segment sequence of length ≤ `depth` over the alphabet. */
function* allSegmentSeqs(depth: number): Generator<string[]> {
  yield [];
  if (depth === 0) return;
  for (const head of ALPHABET) {
    for (const rest of allSegmentSeqs(depth - 1)) yield [head, ...rest];
  }
}

/** The set of `Path=` values the 400 carries for request path `p` (host-only lines). */
function expiredPaths(p: string): Set<string> {
  const lines = buildExpiryLines("pi_dash_token", p, "localhost:8000", false);
  return new Set(lines.map((l) => l.slice(l.indexOf("Path=") + "Path=".length)));
}

describe("T.E116 — expiry covers every cookie the browser could send (property)", () => {
  const CANONICAL = ["/", "/api/", "/auth/"];

  /** The invariant for one (planted Q, request P): matches ⇒ covered; non-matching Q is never sent. */
  function check(q: string, p: string, covered: Set<string>): string | null {
    if (!pathMatches(q, p)) return null; // not sent ⇒ cannot duplicate
    if (covered.has(q) || CANONICAL.includes(q)) return null;
    return `Q=${q} path-matches P=${p} but is not expired (set: ${[...covered].join(" ")})`;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a property/soak workload is one flat loop nest by nature; splitting it would hide the invariant
  it("exhaustive: every Q and P of depth ≤ 3 over {a,B,%2F,.,..} (with and without trailing slash)", () => {
    const paths: string[] = [];
    for (const segs of allSegmentSeqs(3)) {
      paths.push(join(segs, false));
      if (segs.length > 0) paths.push(join(segs, true));
    }
    const failures: string[] = [];
    let matched = 0;
    for (const p of paths) {
      const covered = expiredPaths(p);
      for (const q of paths) {
        if (pathMatches(q, p)) matched++;
        const f = check(q, p, covered);
        if (f) failures.push(f);
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
    // the oracle really exercised matching pairs (guards against a vacuous pass)
    expect(matched).toBeGreaterThan(paths.length);
  });

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a property/soak workload is one flat loop nest by nature; splitting it would hide the invariant
  it("random: depth ≤ 6 requests with Q derived from P's prefixes and from independent noise (seeded)", () => {
    const rand = rng(0x6265);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const seqOf = (maxDepth: number) => Array.from({ length: Math.floor(rand() * (maxDepth + 1)) }, () => pick(ALPHABET));
    const failures: string[] = [];
    let matched = 0;
    for (let i = 0; i < 4000; i++) {
      const segs = seqOf(MAX_DEPTH);
      const p = join(segs, rand() < 0.3);
      const covered = expiredPaths(p);
      for (let k = 0; k < 12; k++) {
        // half the Qs are real prefixes of P (so they match), half are independent noise
        const q = rand() < 0.5 ? join(segs.slice(0, Math.floor(rand() * (segs.length + 1))), rand() < 0.5) : join(seqOf(MAX_DEPTH), rand() < 0.5);
        if (pathMatches(q, p)) matched++;
        const f = check(q, p, covered);
        if (f) failures.push(f);
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
    expect(matched).toBeGreaterThan(10_000);
  });

  it("query string and fragment never widen or narrow the expiry set", () => {
    expect([...expiredPaths("/a/B/%2F?x=/y#z")].sort()).toEqual([...expiredPaths("/a/B/%2F")].sort());
  });

  it("case-sensitive: `/API/` is a different path from `/api/` — a request under one never needs the other", () => {
    const upper = expiredPaths("/API/sessions");
    expect(pathMatches("/API/", "/api/sessions")).toBe(false);
    expect(pathMatches("/api/", "/API/sessions")).toBe(false);
    // /API/ is expired for an /API/ request (it would be sent), /api/ stays covered as a canonical dashboard path
    expect(upper.has("/API/")).toBe(true);
    expect(upper.has("/api/")).toBe(true);
    const lower = expiredPaths("/api/sessions");
    expect(lower.has("/api/")).toBe(true);
    expect(lower.has("/API/")).toBe(false);
  });

  it("every emitted Path is a safe, absolute, CR/LF-free path", () => {
    const rand = rng(7);
    for (let i = 0; i < 500; i++) {
      const p = join(Array.from({ length: Math.floor(rand() * 7) }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]), rand() < 0.5);
      for (const path of expiryPaths(p)) expect(path).toMatch(/^\/[\x21-\x7e]*$/);
    }
  });
});

// ─── T.P15: refusal response size ─────────────────────────────────────────────────────────────────────

/** Node's default maximum total header size (request AND response, the parser enforces both). */
const NODE_HEADER_LIMIT = http.maxHeaderSize;
const DUP = "pi_dash_token=a; pi_dash_token=b";
/** `a.b.c.example.com` has three ancestor domains (`b.c.example.com`, `c.example.com`, `example.com`) = three tier-2 variants. */
const TIER2_HOST = "dash.b.c.example.com";

const open: Array<FastifyInstance | http.Server> = [];
afterEach(async () => {
  await Promise.all(
    open.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          if ("server" in s) void s.close().then(() => resolve());
          else s.close(() => resolve());
        }),
    ),
  );
});

async function mkApp(tier2: boolean) {
  const app = Fastify({ logger: false, maxParamLength: 100_000 });
  open.push(app);
  app.addHook("onRequest", createDuplicateCookieGate({ tier2: () => tier2, log: new DuplicateCookieLog(() => {}) }));
  app.all("/*", async () => ({ ok: true }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  return (app.server.address() as net.AddressInfo).port;
}

interface Seen {
  status: number;
  setCookie: string[];
  headerBytes: number;
  contentType: string | undefined;
  err?: string;
}

function request(port: number, path: string, host: string, accept: string): Promise<Seen> {
  return new Promise((resolve) => {
    const r = http.request({ host: "127.0.0.1", port, path, method: "GET", setHost: false, headers: { host, cookie: DUP, accept } }, (res) => {
      res.resume();
      res.on("end", () => {
        const setCookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
        // wire size of the head as the parser counted it: raw header pairs
        let bytes = 0;
        for (let i = 0; i < res.rawHeaders.length; i += 2) bytes += res.rawHeaders[i].length + res.rawHeaders[i + 1].length + 4;
        resolve({ status: res.statusCode ?? 0, setCookie, headerBytes: bytes, contentType: res.headers["content-type"] });
      });
    });
    r.on("error", (e) => resolve({ status: 0, setCookie: [], headerBytes: 0, contentType: undefined, err: (e as NodeJS.ErrnoException).code ?? String(e) }));
    r.end();
  });
}

const deepPath = (depth: number, segLen = 6) => `/${Array.from({ length: depth }, (_, i) => `${String(i).padStart(2, "0")}${"x".repeat(Math.max(0, segLen - 2))}`).join("/")}`;

describe("T.P15 — refusal response size (HTTP)", () => {
  // 1, 10, 50, 200 segments; tier 2 off and on; HTML and JSON — one real round trip each
  const matrix = [1, 10, 50, 200].flatMap((depth) =>
    [false, true].flatMap((tier2) => [{ depth, tier2, accept: "application/json" }, { depth, tier2, accept: "text/html" }]),
  );

  it.each(matrix)("depth $depth, tier2=$tier2, accept=$accept: 400 received intact, ≤ 64 Set-Cookie lines, head < Node's limit", async ({ depth, tier2, accept }) => {
    const port = await mkApp(tier2);
    const r = await request(port, deepPath(depth), tier2 ? TIER2_HOST : "localhost", accept);
    expect(r.err).toBeUndefined(); // no HPE_HEADER_OVERFLOW / reset on our own response
    expect(r.status).toBe(400); // never 431 on our own response, never a crashed hook
    expect(r.setCookie.length).toBeGreaterThan(0);
    expect(r.setCookie.length).toBeLessThanOrEqual(64);
    expect(r.headerBytes).toBeLessThan(NODE_HEADER_LIMIT);
    expect(r.contentType?.startsWith("text/html")).toBe(accept === "text/html");
  });

  it("self-heal covers prefixes of the first 16 path segments (and not the 17th) on a deep path", async () => {
    const port = await mkApp(false);
    const r = await request(port, deepPath(200), "localhost", "application/json");
    const paths = r.setCookie.map((l) => l.slice(l.indexOf("Path=") + 5));
    const segs = deepPath(200).split("/").slice(1);
    expect(paths).toContain(`/${segs.slice(0, 16).join("/")}`);
    expect(paths).not.toContain(`/${segs.slice(0, 17).join("/")}`);
    expect(paths).toEqual(expect.arrayContaining(["/", "/api/", "/auth/"]));
  });

  it("tier 2 on: the three domain variants ride the same response and stay capped", () => {
    expect(ancestorDomains(TIER2_HOST)).toEqual(["b.c.example.com", "c.example.com", "example.com"]);
    for (const depth of [1, 10, 50, 200]) {
      const lines = buildExpiryLines("pi_dash_token", deepPath(depth), TIER2_HOST, true);
      expect(lines.length).toBeLessThanOrEqual(64);
      const domains = new Set(lines.map((l) => /Domain=(\S+)$/.exec(l)?.[1]).filter(Boolean));
      if (depth === 1) expect(domains.size).toBe(3); // a shallow path: every variant fits under the cap
      expect(domains.size).toBeGreaterThan(0); // deeper paths: the cap truncates variants, never drops tier 2 entirely
    }
  });

  it("URL at the server's maximum length (one long segment, ~half the header limit) still gets a readable 400", async () => {
    const port = await mkApp(true);
    const path = `/${"s".repeat(Math.floor(NODE_HEADER_LIMIT / 2))}`;
    const r = await request(port, path, TIER2_HOST, "application/json");
    expect(r.err).toBeUndefined();
    expect(r.status).toBe(400);
    expect(r.setCookie.length).toBeLessThanOrEqual(64);
    expect(r.headerBytes).toBeLessThan(NODE_HEADER_LIMIT);
  });

  it("a deep path of long segments at the URL limit: the response head still fits the limit", async () => {
    const port = await mkApp(true);
    // ~12 KiB request target: 48 segments × 250 chars. Self-heal prefixes are all long, so size is the hazard.
    const path = deepPath(48, 250);
    expect(Buffer.byteLength(path)).toBeLessThan(NODE_HEADER_LIMIT - 1024);
    const r = await request(port, path, TIER2_HOST, "application/json");
    expect(r.err).toBeUndefined();
    expect(r.status).toBe(400);
    expect(r.setCookie.length).toBeLessThanOrEqual(64);
    expect(r.headerBytes).toBeLessThan(NODE_HEADER_LIMIT);
  });
});

describe("T.P15 — refusal response size (upgrade head)", () => {
  function fakeSocket() {
    const written: string[] = [];
    const socket = { write: (s: string) => written.push(s), destroy: () => {} } as unknown as Duplex;
    return { socket, written };
  }

  it.each([1, 10, 50, 200])("depth %i, tier 2 on: one 400 head, ≤ 64 Set-Cookie lines, well under the header limit", (depth) => {
    const { socket, written } = fakeSocket();
    const request = { headers: { cookie: DUP, host: TIER2_HOST }, url: deepPath(depth) } as never;
    expect(refuseDuplicateCookieUpgrade(request, socket, { tier2: () => true, log: new DuplicateCookieLog(() => {}) })).toBe(true);
    expect(written).toHaveLength(1);
    const head = written[0];
    expect(head.startsWith("HTTP/1.1 400 Bad Request\r\n")).toBe(true);
    expect(head.endsWith("\r\n\r\n")).toBe(true);
    expect(head.match(/^Set-Cookie: /gm)?.length ?? 0).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(head)).toBeLessThan(NODE_HEADER_LIMIT);
  });

  it("a real HTTP client parses the upgrade refusal (no parser overflow) and sees every Set-Cookie", async () => {
    const server = http.createServer();
    open.push(server);
    server.on("upgrade", (req, socket) => {
      refuseDuplicateCookieUpgrade(req, socket, { tier2: () => true, log: new DuplicateCookieLog(() => {}) });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as net.AddressInfo).port;
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const r = http.request({
        host: "127.0.0.1",
        port,
        path: deepPath(50),
        setHost: false,
        headers: { host: TIER2_HOST, connection: "Upgrade", upgrade: "websocket", cookie: DUP },
      });
      r.on("response", resolve);
      r.on("upgrade", () => reject(new Error("unexpected 101")));
      r.on("error", reject);
      r.end();
    });
    expect(res.statusCode).toBe(400);
    expect(([] as string[]).concat(res.headers["set-cookie"] ?? []).length).toBeLessThanOrEqual(64);
    res.resume();
  });
});
