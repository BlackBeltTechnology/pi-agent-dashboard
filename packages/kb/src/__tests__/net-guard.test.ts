import { deflateRawSync, deflateSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { guardedFetch, isNonPublicAddress, type LookupAll, makeGuardedLookup } from "../net-guard.js";
import { startHttpsServer, type TestServer, testFetchOpts } from "./helpers/https-server.js";

describe("isNonPublicAddress", () => {
  it("E20 IPv4 boundaries", () => {
    const blocked = ["10.0.0.0", "10.255.255.255", "100.64.0.0", "172.16.0.0", "172.31.255.255", "198.18.0.0", "192.0.2.1", "203.0.113.9"];
    const open = ["9.255.255.255", "11.0.0.0", "100.63.255.255", "172.15.255.255", "172.32.0.0", "198.17.255.255", "8.8.8.8"];
    for (const ip of blocked) expect(isNonPublicAddress(ip), ip).toBe(true);
    for (const ip of open) expect(isNonPublicAddress(ip), ip).toBe(false);
  });

  it("E21 IPv6 embedded forms", () => {
    const blocked = [
      "::1", "[::ffff:7f00:1]", "::ffff:127.0.0.1", "::ffff:0:a00:5", "::a00:5", "64:ff9b::a00:5",
      "64:ff9b:1::808:808", "2002:a00:5::1",
      // Teredo: server 8.8.8.8 (public), client 10.0.0.5 obfuscated = 0xf5ff:0xfffa
      "2001:0:808:808:0:0:f5ff:fffa",
      "fe80::1", "fd00::1", "2001:db8::1",
    ];
    const open = ["2606:4700:4700::1111", "64:ff9b::808:808"];
    for (const ip of blocked) expect(isNonPublicAddress(ip), ip).toBe(true);
    for (const ip of open) expect(isNonPublicAddress(ip), ip).toBe(false);
  });

  it("fails closed on garbage and strips zone ids", () => {
    expect(isNonPublicAddress("not-an-ip")).toBe(true);
    expect(isNonPublicAddress("fe80::1%en0")).toBe(true);
  });
});

describe("guardedLookup (E24)", () => {
  const mixed: LookupAll = (_h, _o, cb) => cb(null, [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.5", family: 4 }]);
  const single: LookupAll = (_h, _o, cb) => cb(null, [{ address: "8.8.8.8", family: 4 }]);
  const call = (lookup: LookupAll, all: boolean) =>
    new Promise<unknown[]>((resolve) => {
      (makeGuardedLookup({ lookup }) as unknown as (h: string, o: object, cb: (...a: unknown[]) => void) => void)("h", { all }, (...a) => resolve(a));
    });

  it("all:true with any blocked address → error", async () => {
    const [err] = await call(mixed, true);
    expect(err).toBeInstanceOf(Error);
  });
  it("all:true public → array callback", async () => {
    expect(await call(single, true)).toEqual([null, [{ address: "8.8.8.8", family: 4 }]]);
  });
  it("all:false → (null, address, family)", async () => {
    expect(await call(single, false)).toEqual([null, "8.8.8.8", 4]);
  });
  it("all:false still rejects when ANY answer is blocked", async () => {
    const [err] = await call(mixed, false);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("guardedFetch", () => {
  const servers: TestServer[] = [];
  const serve = async (h: Parameters<typeof startHttpsServer>[0]) => {
    const s = await startHttpsServer(h);
    servers.push(s);
    return s;
  };
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  it("returns a 2xx body", async () => {
    const s = await serve((_q, r) => r.end("hello"));
    expect((await guardedFetch(s.url(), testFetchOpts)).toString()).toBe("hello");
  });

  it("E25 follows 3 redirects, rejects the 4th", async () => {
    const chain = (n: number) =>
      serve((q, r) => {
        const hop = Number(q.url!.slice(1) || 0);
        if (hop < n) { r.writeHead(302, { location: `/${hop + 1}` }); r.end(); } else r.end("done");
      });
    const ok = await chain(3);
    expect((await guardedFetch(ok.url(), { ...testFetchOpts, maxRedirects: 3 })).toString()).toBe("done");
    const bad = await chain(4);
    await expect(guardedFetch(bad.url(), { ...testFetchOpts, maxRedirects: 3 })).rejects.toThrow(/too many redirects/);
  });

  it("E26 refuses a redirect to a loopback literal; second server sees 0 connections", async () => {
    const second = await serve((_q, r) => r.end("secret"));
    const first = await serve((_q, r) => { r.writeHead(302, { location: second.literalUrl("/x") }); r.end(); });
    await expect(guardedFetch(first.url(), testFetchOpts)).rejects.toThrow(/non-public/);
    expect(second.connections()).toBe(0);
  });

  it("E26b refuses a hostname that resolves to a blocked address (rebinding shape)", async () => {
    const first = await serve((_q, r) => { r.writeHead(302, { location: "https://rebind.test/x" }); r.end(); });
    const lookup: LookupAll = (h, o, cb) =>
      h === "rebind.test" ? cb(null, [{ address: "10.0.0.5", family: 4 }]) : testFetchOpts.lookup!(h, o, cb);
    await expect(guardedFetch(first.url(), { ...testFetchOpts, lookup })).rejects.toThrow(/non-public/);
  });

  it("E27 byte cap: 1024 ok, 1025 rejects", async () => {
    const s1 = await serve((_q, r) => r.end(Buffer.alloc(1024, 1)));
    expect((await guardedFetch(s1.url(), { ...testFetchOpts, maxBytes: 1024 })).length).toBe(1024);
    const s2 = await serve((_q, r) => r.end(Buffer.alloc(1025, 1)));
    await expect(guardedFetch(s2.url(), { ...testFetchOpts, maxBytes: 1024 })).rejects.toThrow(/exceeds 1024/);
  });

  it("E28 gzip bomb is capped on decompressed bytes", async () => {
    const bomb = gzipSync(Buffer.alloc(10 * 1024 * 1024, 0));
    expect(bomb.length).toBeLessThan(20 * 1024);
    const s = await serve((_q, r) => { r.writeHead(200, { "content-encoding": "gzip" }); r.end(bomb); });
    await expect(guardedFetch(s.url(), { ...testFetchOpts, maxBytes: 1024 * 1024 })).rejects.toThrow(/exceeds/);
  });

  it("E29 deflate: zlib-wrapped and raw both decode", async () => {
    const text = "hello deflate world";
    for (const body of [deflateSync(text), deflateRawSync(text)]) {
      const s = await serve((_q, r) => { r.writeHead(200, { "content-encoding": "deflate" }); r.end(body); });
      expect((await guardedFetch(s.url(), testFetchOpts)).toString()).toBe(text);
    }
  });

  it("E30 rejects unsupported encoding and non-2xx", async () => {
    const z = await serve((_q, r) => { r.writeHead(200, { "content-encoding": "zstd" }); r.end("x"); });
    await expect(guardedFetch(z.url(), testFetchOpts)).rejects.toThrow(/unsupported content-encoding/);
    const nf = await serve((_q, r) => { r.writeHead(404); r.end("nope"); });
    await expect(guardedFetch(nf.url(), testFetchOpts)).rejects.toThrow(/HTTP 404/);
  });

  it("E22 literal metadata URL rejected before any connection", async () => {
    await expect(guardedFetch("https://169.254.169.254/latest/meta-data/")).rejects.toThrow(/non-public/);
  });

  it("E23 non-https refused", async () => {
    await expect(guardedFetch("http://example.com/a.md")).rejects.toThrow(/only https/);
    await expect(guardedFetch("ssh://h/r")).rejects.toThrow(/only https/);
  });

  it("X1 times out when headers never arrive", async () => {
    const s = await serve(() => {});
    const t0 = Date.now();
    await expect(guardedFetch(s.url(), { ...testFetchOpts, timeoutMs: 200 })).rejects.toThrow(/timed out/);
    const dt = Date.now() - t0;
    expect(dt).toBeGreaterThanOrEqual(150);
    expect(dt).toBeLessThan(1000);
  });

  it("X2 never reads a 3xx body (endless) and raises no unhandled error", async () => {
    const target = await serve((_q, r) => r.end("landed"));
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("uncaughtException", onUnhandled);
    const first = await serve((_q, r) => {
      r.writeHead(302, { location: target.url("/t") });
      const iv = setInterval(() => r.write("x".repeat(1024)), 5);
      r.on("close", () => clearInterval(iv));
    });
    try {
      expect((await guardedFetch(first.url(), { ...testFetchOpts, maxBytes: 4096 })).toString()).toBe("landed");
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("uncaughtException", onUnhandled);
    }
  });
});
