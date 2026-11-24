/**
 * Duplicate `pi_dash_*` cookie gate — hot-path overhead and log limiter under a hostile flood.
 *
 *  T.P13  hook overhead on the hot path: 100k requests with a realistic ~3 KB Cookie header vs the hook disabled
 *         (same run, interleaved batches); parsing a 16 KB adversarial `pi_dash_` header is linear
 *  T.P14  log limiter under a hostile name flood: 1M refusals with distinct duplicate `pi_dash_<random>` names
 *
 * See change: serve-live-previews-on-capability-origin (D10; test-plan #P13, #P14; Q28, Q48).
 */
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { createDuplicateCookieGate, DuplicateCookieLog, findDuplicateDashboardCookie } from "../auth/duplicate-cookie-gate.js";

const quiet = () => new DuplicateCookieLog(() => {});
const p95 = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
};
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// ─── T.P13 ────────────────────────────────────────────────────────────────────────────────────────────

/** 4 distinct dashboard cookies + 30 foreign cookies, ~3 KB: a browser that has seen a lot of sites on this host. */
function realisticCookie(): string {
  const dash = ["pi_dash_token", "pi_dash_local", "pi_dash_device", "pi_dash_pool_8101"].map((n) => `${n}=${"d".repeat(120)}`);
  const foreign = Array.from({ length: 30 }, (_, i) => `_ga_${i}=${"v".repeat(70)}`);
  // interleave so the dashboard names are not all at the front
  const out: string[] = [];
  for (let i = 0; i < foreign.length; i++) {
    out.push(foreign[i]);
    if (i % 8 === 3) out.push(dash[Math.floor(i / 8)]);
  }
  return out.join("; ");
}

async function mkApp(withHook: boolean): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  if (withHook) app.addHook("onRequest", createDuplicateCookieGate({ tier2: () => false, log: quiet() }));
  app.get("/api/sessions", async () => ({ ok: true }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  return app;
}

/** A keep-alive client over a real loopback socket: the latency a browser actually sees, not an in-process `inject`. */
function client(app: FastifyInstance) {
  const port = (app.server.address() as AddressInfo).port;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  return {
    agent,
    get: (cookie: string) =>
      new Promise<number>((resolve, reject) => {
        const r = http.request({ host: "127.0.0.1", port, path: "/api/sessions", agent, headers: { cookie } }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        });
        r.on("error", reject);
        r.end();
      }),
  };
}

describe("T.P13 — hook overhead on the hot path", () => {
  const apps: FastifyInstance[] = [];
  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a property/soak workload is one flat loop nest by nature; splitting it would hide the invariant
  it("realistic Cookie: p95 per-request latency with the hook ≤ 1.2× the hook-disabled baseline (100k requests each, interleaved)", async () => {
    const cookie = realisticCookie();
    expect(cookie.length).toBeGreaterThan(2500);
    expect(cookie.length).toBeLessThan(4000);
    expect(findDuplicateDashboardCookie(cookie)).toBeNull(); // the realistic jar is NOT a duplicate: the full-scan path

    const base = await mkApp(false);
    const hooked = await mkApp(true);
    apps.push(base, hooked);
    const clients = new Map<FastifyInstance, ReturnType<typeof client>>([
      [base, client(base)],
      [hooked, client(hooked)],
    ]);
    const fire = (app: FastifyInstance) => clients.get(app)!.get(cookie);

    // warm both (JIT, route cache)
    for (let i = 0; i < 3000; i++) {
      await fire(base);
      await fire(hooked);
    }

    const N = 100_000;
    const BATCH = 500;
    const tBase: number[] = [];
    const tHook: number[] = [];
    // alternate batches (and alternate which goes first) so drift, GC and thermal state hit both equally
    for (let done = 0, flip = false; done < N; done += BATCH, flip = !flip) {
      for (const [app, sink] of (flip ? [[hooked, tHook], [base, tBase]] : [[base, tBase], [hooked, tHook]]) as Array<[FastifyInstance, number[]]>) {
        for (let i = 0; i < BATCH; i++) {
          const t0 = process.hrtime.bigint();
          const status = await fire(app);
          sink.push(Number(process.hrtime.bigint() - t0) / 1000);
          if (status !== 200) throw new Error(`unexpected ${status}`);
        }
      }
    }
    const b95 = p95(tBase);
    const h95 = p95(tHook);
    // the metric: ratio in the same run (Q48); absolute µs are recorded, not asserted
    process.stderr.write(`[P13] n=${N} baseline p50=${median(tBase).toFixed(1)}µs p95=${b95.toFixed(1)}µs | hook p50=${median(tHook).toFixed(1)}µs p95=${h95.toFixed(1)}µs | p95 ratio=${(h95 / b95).toFixed(3)}\n`);
    expect(tBase).toHaveLength(N);
    expect(tHook).toHaveLength(N);
    for (const c of clients.values()) c.agent.destroy();
    expect(h95).toBeLessThanOrEqual(b95 * 1.2);
  }, 300_000);

  it("a 15 KB Cookie header (just under Node's 16 KB head limit) is parsed and answered normally", async () => {
    const hooked = await mkApp(true);
    apps.push(hooked);
    const big = `${Array.from({ length: 140 }, (_, i) => `c${i}=${"z".repeat(95)}`).join("; ")}; pi_dash_token=a`;
    expect(big.length).toBeGreaterThan(14_000);
    expect(big.length).toBeLessThan(15_800);
    const c = client(hooked);
    expect(await c.get(big)).toBe(200);
    expect(await c.get(`${big}; pi_dash_token=b`)).toBe(400);
    c.agent.destroy();
  });

  it("no backtracking: parsing adversarial `pi_dash_` repeats is linear in the header size (16 KB → 4 MB)", () => {
    // three adversarial shapes: one huge name, many empty-valued duplicates, many distinct near-names
    const shapes: Record<string, (bytes: number) => string> = {
      "one long pi_dash_ run": (n) => "pi_dash_".repeat(Math.ceil(n / 8)),
      "pi_dash_;pi_dash_; repeats": (n) => "pi_dash_;".repeat(Math.ceil(n / 9)),
      "pi_dash_a=; pi_dash_b=; …": (n) => Array.from({ length: Math.ceil(n / 14) }, (_, i) => `pi_dash_${i.toString(36)}=;`).join(" "),
    };
    const nsPerByte = (header: string): number => {
      // enough repetitions that each measurement is ≥ ~30 ms
      const reps = Math.max(3, Math.ceil(4_000_000 / header.length));
      let best = Number.POSITIVE_INFINITY;
      for (let round = 0; round < 5; round++) {
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < reps; i++) findDuplicateDashboardCookie(header);
        best = Math.min(best, Number(process.hrtime.bigint() - t0) / (reps * header.length));
      }
      return best;
    };
    for (const [label, make] of Object.entries(shapes)) {
      const small = nsPerByte(make(16 * 1024));
      const large = nsPerByte(make(4 * 1024 * 1024));
      // 256× the input: linear ⇒ per-byte cost ~flat; quadratic/backtracking ⇒ ~256× worse. Cache effects allow a few ×.
      expect(large / small, `${label}: ${small.toFixed(2)} → ${large.toFixed(2)} ns/byte`).toBeLessThan(8);
    }
  }, 60_000);
});

// ─── T.P14 ────────────────────────────────────────────────────────────────────────────────────────────

/** A minimal reply that records what the hook did; the gate only calls these. */
function stubReply() {
  const r = { code: () => r, header: () => r, type: () => r, send: () => r };
  return r as never;
}
const stubReq = (name: string) => ({ url: "/api/sessions", headers: { cookie: `${name}=a; ${name}=b`, host: "localhost:8000" } }) as never;

describe("T.P14 — log limiter under a hostile name flood", () => {
  const LOG_MAX_NAMES = 256; // MAX_LOG_HOSTS parity (Q28)

  it("1M refusals with distinct duplicate names: the limiter map stays ≤ 256, ≤ 1 log line per (name, minute), RSS recorded", () => {
    let t = 0;
    const lines: string[] = [];
    // keep only a counter of lines per name, never the flood itself (a leak in the test would mask one in the code)
    const perName = new Map<string, number>();
    let total = 0;
    const log = new DuplicateCookieLog(
      (l) => {
        total++;
        const n = /name=(\S+)/.exec(l)![1];
        perName.set(n, (perName.get(n) ?? 0) + 1);
        if (lines.length < 3) lines.push(l);
      },
      () => t,
    );
    const gate = createDuplicateCookieGate({ tier2: () => false, log });
    const seen = (log as unknown as { seen: Map<string, number> }).seen;

    const rssBefore = process.memoryUsage().rss;
    let maxMap = 0;
    const N = 1_000_000;
    const reply = stubReply();
    const noop = () => {};
    for (let i = 0; i < N; i++) {
      t += 1; // 1 ms per refusal ⇒ the flood spans ~1000 s of simulated time (~16 one-minute windows)
      gate(stubReq(`pi_dash_${crypto.randomBytes(6).toString("hex")}`), reply, noop);
      if ((i & 0xfff) === 0 && seen.size > maxMap) maxMap = seen.size;
    }
    maxMap = Math.max(maxMap, seen.size);
    const rssAfter = process.memoryUsage().rss;
    process.stderr.write(`[P14] ${N} refusals: limiter map max=${maxMap}, log lines=${total}, rss ${(rssBefore / 1048576).toFixed(0)}→${(rssAfter / 1048576).toFixed(0)} MiB (recorded, not asserted)\n`);

    expect(maxMap).toBeLessThanOrEqual(LOG_MAX_NAMES);
    expect(seen.size).toBeLessThanOrEqual(LOG_MAX_NAMES);
    // every name was distinct, so each logs exactly once — never more than once per (name, minute)
    expect([...perName.values()].every((n) => n === 1)).toBe(true);
    expect(total).toBe(perName.size);
    expect(lines[0]).toMatch(/^\[cookie-gate\] refused duplicate cookie name=pi_dash_[0-9a-f]{12} count=2 route=\/api\/sessions$/);
  }, 300_000);

  it("a repeating name set within the limiter's capacity logs once per name per window, then once more after the window", () => {
    let t = 0;
    const perName = new Map<string, number>();
    const log = new DuplicateCookieLog(
      (l) => {
        const n = /name=(\S+)/.exec(l)![1];
        perName.set(n, (perName.get(n) ?? 0) + 1);
      },
      () => t,
    );
    const gate = createDuplicateCookieGate({ tier2: () => false, log });
    const names = Array.from({ length: 200 }, (_, i) => `pi_dash_set${i}`); // ≤ 256: all stay tracked
    const reply = stubReply();
    for (let i = 0; i < 400_000; i++) {
      t = Math.floor(i / 10); // 400k requests over 40 s: inside one 60 s window
      gate(stubReq(names[i % names.length]), reply, () => {});
    }
    expect(perName.size).toBe(200);
    expect([...perName.values()].every((n) => n === 1)).toBe(true);
    t += 61_000; // the window closes
    for (let i = 0; i < 1000; i++) gate(stubReq(names[i % names.length]), reply, () => {});
    expect([...perName.values()].every((n) => n === 2)).toBe(true);
  });
});
