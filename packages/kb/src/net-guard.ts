// SSRF guard for KB remote sources (change: harden-untrusted-content-ingestion,
// design D2/D3). Zero deps — kb stays self-contained.
//
//  - `isNonPublicAddress`: one canonical classifier (net.BlockList) incl. every
//    IPv6-embedded IPv4 form.
//  - `guardedLookup`: dns.lookup that rejects non-public answers; passed as the
//    `lookup` option of https.request so the check is on the address the socket
//    actually uses (closes DNS rebinding).
//  - `guardedFetch`: https-only fetch with manual, re-validated redirects, a
//    cumulative byte/time budget, bounded decompression, 2xx-only.

import dns from "node:dns";
import type { IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate, createInflateRaw } from "node:zlib";

// ── address classifier ───────────────────────────────────────────────────────

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const V6_BLOCKED: [string, number][] = [
  ["::", 128], ["::1", 128], ["100::", 64], ["2001:2::", 48], ["2001:10::", 28], ["2001:20::", 28],
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
  // RFC 8215 local-use NAT64: /48 layout splits the IPv4 around the `u` octet, so
  // extraction would be wrong — and the prefix is never public-internet. Block whole.
  ["64:ff9b:1::", 48],
];
const v4List = new BlockList();
for (const [a, p] of V4_BLOCKED) v4List.addSubnet(a, p, "ipv4");
const v6List = new BlockList();
for (const [a, p] of V6_BLOCKED) v6List.addSubnet(a, p, "ipv6");

/** Expand a (valid) IPv6 literal into 8 16-bit groups. Handles `::` and a trailing dotted quad. */
function v6Groups(ip: string): number[] | null {
  let s = ip;
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[1].split(".").map(Number);
    if (o.some((n) => n > 255)) return null;
    s = `${s.slice(0, -dotted[1].length) + ((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}
const v4Of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * True when `ip` is anything but a public-internet unicast address. Fails
 * closed: an unparseable value is non-public. Deliberately NOT named
 * `isBlockedAddress` (server webhook-url.ts applies a different policy).
 */
export function isNonPublicAddress(input: string): boolean {
  let ip = input.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  const fam = isIP(ip);
  if (fam === 4) return v4List.check(ip, "ipv4");
  if (fam !== 6) return true;
  const g = v6Groups(ip);
  if (!g) return true;
  if (v6List.check(ip, "ipv6")) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  const embedded: string[] = [];
  const low = v4Of(g6, g7);
  const upperZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0;
  if (upperZero && g4 === 0 && g5 === 0xffff) embedded.push(low); // IPv4-mapped ::ffff:0:0/96
  if (upperZero && g4 === 0xffff && g5 === 0) embedded.push(low); // IPv4-translated ::ffff:0:0:0/96
  if (upperZero && g4 === 0 && g5 === 0) embedded.push(low); // IPv4-compatible ::/96
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) embedded.push(low); // NAT64 64:ff9b::/96
  if (g0 === 0x2002) embedded.push(v4Of(g1, g2)); // 6to4
  if (g0 === 0x2001 && g1 === 0) {
    embedded.push(v4Of(g2, g3)); // Teredo server
    embedded.push(v4Of(g6 ^ 0xffff, g7 ^ 0xffff)); // Teredo client (obfuscated)
  }
  return embedded.some((v4) => v4List.check(v4, "ipv4"));
}

// ── guarded lookup ───────────────────────────────────────────────────────────

export type LookupAll = (hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, addrs: dns.LookupAddress[]) => void) => void;

export interface GuardOptions {
  /** Test seam: DNS resolver (default `dns.lookup`, called with `all:true`). */
  lookup?: LookupAll;
  /** Test seam: address policy, given the address and the host it was reached by (default `isNonPublicAddress`). */
  isBlocked?: (addr: string, host: string) => boolean;
}

function blockedError(host: string, addr: string): NodeJS.ErrnoException {
  const e: NodeJS.ErrnoException = new Error(`refusing to connect to ${host}: ${addr} is a non-public address`);
  e.code = "ESSRF";
  return e;
}

/**
 * Build a `lookup` for https.request: resolves with `all:true`, rejects when ANY
 * answer is blocked, and answers in the shape the caller asked for (`options.all`).
 */
export function makeGuardedLookup(g: GuardOptions = {}): LookupFunction {
  const resolveAll: LookupAll = g.lookup ?? ((h, o, cb) => dns.lookup(h, { ...o, all: true }, cb as never));
  const blocked = g.isBlocked ?? isNonPublicAddress;
  const fn = (hostname: string, options: dns.LookupOptions | number | undefined, cb: (...a: unknown[]) => void) => {
    const opts: dns.LookupOptions = typeof options === "object" && options ? options : typeof options === "number" ? { family: options } : {};
    resolveAll(hostname, { ...opts, all: true }, (err, addrs) => {
      if (err) return cb(err);
      if (!addrs.length) return cb(Object.assign(new Error(`no address for ${hostname}`), { code: "ENOTFOUND" }));
      const bad = addrs.find((a) => blocked(a.address, hostname));
      if (bad) return cb(blockedError(hostname, bad.address));
      if (opts.all) return cb(null, addrs);
      cb(null, addrs[0].address, addrs[0].family);
    });
  };
  return fn as unknown as LookupFunction; // documented cast: array-callback overload
}

/**
 * Resolve `host` and require EVERY answer to be public (IP literals are checked
 * directly). Returns the checked addresses so a caller can pin one (git/curl).
 */
export async function assertPublicHost(host: string, g: GuardOptions = {}): Promise<dns.LookupAddress[]> {
  const blocked = g.isBlocked ?? isNonPublicAddress;
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIP(bare)) {
    if (blocked(bare, bare)) throw blockedError(host, bare);
    return [{ address: bare, family: isIP(bare) }];
  }
  const resolveAll: LookupAll = g.lookup ?? ((h, o, cb) => dns.lookup(h, { ...o, all: true }, cb as never));
  const addrs = await new Promise<dns.LookupAddress[]>((res, rej) =>
    resolveAll(bare, { all: true }, (err, a) => (err ? rej(err) : res(a))),
  );
  if (!addrs.length) throw Object.assign(new Error(`no address for ${host}`), { code: "ENOTFOUND" });
  const bad = addrs.find((a) => blocked(a.address, bare));
  if (bad) throw blockedError(host, bad.address);
  return addrs;
}

// ── guarded fetch ────────────────────────────────────────────────────────────

export interface GuardedFetchOptions extends GuardOptions {
  maxBytes?: number; // default 50 MB (cumulative over the redirect chain, post-decompression)
  timeoutMs?: number; // default 60 s (whole chain)
  maxRedirects?: number; // default 3
  /** Test seam: extra TLS options (e.g. a test CA). */
  tls?: https.RequestOptions;
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/** Reject IP-literal hosts that are non-public (Node never calls `lookup` for literals). */
function checkLiteral(url: URL, blocked: (a: string, host: string) => boolean): void {
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  if (isIP(host) && blocked(host, host)) throw blockedError(url.hostname, host);
}

function pickDecoder(encoding: string | undefined, first: Buffer): Transform | null {
  switch ((encoding ?? "identity").toLowerCase()) {
    case "identity":
    case "":
      return null;
    case "gzip":
    case "x-gzip":
      return createGunzip();
    case "br":
      return createBrotliDecompress();
    case "deflate": {
      // zlib header: CMF/FLG with (CMF*256+FLG) % 31 == 0 and CM == 8.
      const zlibWrapped = first.length >= 2 && (first[0] & 0x0f) === 8 && ((first[0] << 8) | first[1]) % 31 === 0;
      return zlibWrapped ? createInflate() : createInflateRaw();
    }
    default:
      throw new Error(`unsupported content-encoding: ${encoding}`);
  }
}

/** GET `rawUrl` over https, returning the (decoded) body. */
export async function guardedFetch(rawUrl: string, opts: GuardedFetchOptions = {}): Promise<Buffer> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? 3;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const blocked = opts.isBlocked ?? isNonPublicAddress;
  const lookup = makeGuardedLookup(opts);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`timed out after ${timeoutMs} ms fetching ${rawUrl}`)), timeoutMs);
  const budget = maxBytes;
  try {
    let current = new URL(rawUrl);
    for (let hop = 0; ; hop++) {
      if (current.protocol !== "https:") throw new Error(`only https:// sources are allowed (got ${current.protocol}//)`);
      checkLiteral(current, blocked);
      const res = await new Promise<IncomingMessage>((resolve, reject) => {
        const req = https.request(
          current,
          { method: "GET", headers: { "accept-encoding": "identity", "user-agent": "pi-kb" }, lookup, signal: ac.signal, agent: false, ...opts.tls },
          resolve,
        );
        req.on("error", reject);
        req.end();
      });
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.on("error", () => {}); // destroy() below must not raise an unhandled event
        res.destroy(); // never read a 3xx body
        if (hop >= maxRedirects) throw new Error(`too many redirects (max ${maxRedirects}) fetching ${rawUrl}`);
        current = new URL(res.headers.location, current);
        continue;
      }
      if (status < 200 || status >= 300) {
        res.on("error", () => {});
        res.destroy();
        throw new Error(`HTTP ${status} fetching ${current.href}`);
      }
      return await readBody(res, budget, ac.signal, maxBytes);
    }
  } catch (e) {
    if (ac.signal.aborted && ac.signal.reason instanceof Error) throw ac.signal.reason;
    throw e;
  } finally {
    clearTimeout(timer);
    ac.abort(); // tear down any lingering socket
  }
}

function readBody(res: IncomingMessage, budget: number, signal: AbortSignal, maxBytes: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0; // decoded bytes
    let wire = 0; // compressed bytes
    let decoder: Transform | null = null;
    let started = false;
    let done = false;
    const fail = (e: Error) => {
      if (done) return;
      done = true;
      res.destroy();
      decoder?.destroy();
      reject(e);
    };
    const finish = () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    };
    const sink = (c: Buffer) => {
      total += c.length;
      if (total > budget) return fail(new Error(`response exceeds ${maxBytes} bytes`));
      chunks.push(c);
    };
    signal.addEventListener("abort", () => fail(signal.reason instanceof Error ? signal.reason : new Error("aborted")), { once: true });
    res.on("error", fail);
    res.on("aborted", () => fail(new Error("connection closed before the response completed")));
    res.on("data", (c: Buffer) => {
      if (done) return;
      wire += c.length;
      if (wire > budget) return fail(new Error(`response exceeds ${maxBytes} bytes`));
      if (!started) {
        started = true;
        try {
          decoder = pickDecoder(res.headers["content-encoding"] as string | undefined, c);
        } catch (e) {
          return fail(e as Error);
        }
        if (decoder) {
          decoder.on("data", sink);
          decoder.on("end", finish);
          decoder.on("error", fail);
        }
      }
      if (decoder) decoder.write(c);
      else sink(c);
    });
    res.on("end", () => {
      if (decoder) decoder.end();
      else finish();
    });
  });
}
