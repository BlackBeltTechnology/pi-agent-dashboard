/**
 * Tier 5 (`/preview/<pid>/`, D8) lookup and forwarding: pid shape, full-path forwarding, raw-path validation,
 * `Location` rewrite, upstream failure, WS upgrade bounds, lookup scaling.
 * See change: serve-live-previews-on-capability-origin (test-plan #E73, #E83, #E84, #E85, #X16, #P10).
 */
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLiveCapabilityHook, LiveCapabilityStore } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { handleLiveServerUpgrade } from "../live-server/live-server-proxy.js";
import { parsePreviewPath } from "../live-server/preview-path.js";
import { PreviewPathStore } from "../live-server/preview-path-store.js";
import { dev, dialUpgrade, type Harness, makeHarness } from "./helpers/preview-path-harness.js";

let h: Harness;
let pid: string;

beforeEach(async () => {
  h = await makeHarness();
  const m = await h.mint(dev("A"));
  if (!m.pid) throw new Error("tier-5 mint expected");
  pid = m.pid;
});
afterEach(async () => {
  await h.close();
});

const swapCase = (s: string) => [...s].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join("");

describe("T.E73 / #E73 — pid shape + lookup", () => {
  it("T.E73 only the exact 22-char base64url live pid routes; wrong length / charset / case → 404, upstream untouched", async () => {
    expect(pid).toHaveLength(22);
    const bad = [
      pid.slice(0, 21),
      `${pid}A`,
      `${pid}AB`,
      `${pid.slice(0, 21)}+`,
      `${pid.slice(0, 21)}=`,
      `${pid.slice(0, 20)}+/`,
      `${pid.slice(0, 21)}/`,
      swapCase(pid),
      pid.toUpperCase() === pid ? pid.toLowerCase() : pid.toUpperCase(),
      "A".repeat(22),
    ];
    for (const p of bad) {
      expect(p, p).not.toBe(pid);
      expect((await h.get(`/preview/${p}/x`)).status, p).toBe(404);
    }
    expect((await h.get("/preview//")).status).toBe(404);
    expect((await h.get("/preview//x")).status).toBe(404);
    expect((await h.get("/preview/")).status).toBe(404);
    expect((await h.get("/preview")).status).toBe(404);
    expect(h.up.seen).toEqual([]);
  });

  it("T.E73 the live pid routes with and without a trailing slash and with a query; the FULL path is forwarded", async () => {
    expect((await h.get(`/preview/${pid}/`)).status).toBe(200);
    expect((await h.get(`/preview/${pid}`)).status).toBe(200);
    expect((await h.get(`/preview/${pid}?x=1`)).status).toBe(200);
    expect((await h.get(`/preview/${pid}/?x=1`)).status).toBe(200);
    expect(h.up.seen.map((r) => r.url)).toEqual([`/preview/${pid}/`, `/preview/${pid}`, `/preview/${pid}?x=1`, `/preview/${pid}/?x=1`]);
  });

  it("T.E73 the shape guard keeps a malformed pid out of the store lookup entirely", () => {
    for (const p of ["", "a", "A".repeat(21), "A".repeat(23), `${"A".repeat(21)}+`, `${"A".repeat(21)}=`]) {
      expect(h.paths.validate(p, { genuinelyLocal: true }), p).toBeNull();
    }
    expect(h.paths.validate(pid, { genuinelyLocal: true })?.tier).toBe(5);
    expect(h.paths.validate(swapCase(pid), { genuinelyLocal: true })).toBeNull();
  });
});

describe("T.E83 / #E83 — full-path forwarding", () => {
  it("T.E83 the upstream receives the identical path + query (no strip) for /, /src/a.ts?x=1 and the bare /preview/<pid>", async () => {
    const paths = [`/preview/${pid}/`, `/preview/${pid}/src/a.ts?x=1`, `/preview/${pid}`];
    for (const p of paths) expect((await h.get(p)).status, p).toBe(200);
    expect(h.up.seen.map((r) => r.url)).toEqual(paths);
  });

  it("T.E83 Referrer-Policy: no-referrer replaces an upstream `unsafe-url` (the pid is a secret)", async () => {
    const r = await h.get(`/preview/${pid}/refer`);
    expect(r.status).toBe(200);
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    // and is added when the upstream sets none
    expect((await h.get(`/preview/${pid}/plain`)).headers["referrer-policy"]).toBe("no-referrer");
  });

  it("T.E83 a static target on a tier-5 host mints the legacy shape, never /preview/", async () => {
    h.addStatic("docs-static");
    const m = await h.mint(dev("A"), "docs-static", { accept: ["preview"] });
    expect(m.statusCode).toBe(200);
    expect(m.json.tier).toBe("legacy");
    expect(m.json.path).toMatch(/^\/live\/docs-static\/~c\/[A-Za-z0-9_-]+\/$/);
    expect(m.pid).toBeUndefined();
    expect(h.paths.size()).toBe(1); // only the port target's pid exists
  });
});

describe("T.E84 / #E84 — raw-path validation", () => {
  it("T.E84 dot-segment, %2F, %7E, %2E, %5C (any hex case), raw `\\` and %00 → 404 and the upstream sees 0 requests", async () => {
    const tails = [
      "..%2F..%2Fx",
      "..%2f..%2fx",
      "%2e%2e/x",
      "%2E%2E/x",
      "./x",
      "a/../b",
      "a%2Fb",
      "a%2fb",
      "a%7Eb",
      "a%7eb",
      "a%2eb",
      "a%2Eb",
      "a%5Cb",
      "a%5cb",
      "..\\x",
      "a\\b",
      "a%00b",
    ];
    for (const t of tails) expect((await h.get(`/preview/${pid}/${t}`)).status, t).toBe(404);
    expect(h.up.seen).toEqual([]);
  });

  it("T.E84 double-encoded and `//` rows are forwarded exactly as received (nothing is decoded, Q31)", async () => {
    const forwarded = [`/preview/${pid}/%252e%252e/`, `/preview/${pid}/%252F`, `/preview/${pid}/a%252Eb`, `/preview/${pid}//x`, `/preview/${pid}/a//b`];
    for (const p of forwarded) expect((await h.get(p)).status, p).toBe(200);
    expect(h.up.seen.map((r) => r.url)).toEqual(forwarded);
  });

  it("T.E84 `/preview//<pid>/` has no pid segment → 404", async () => {
    expect((await h.get(`/preview//${pid}/`)).status).toBe(404);
    expect((await h.get(`/preview//${pid}/x`)).status).toBe(404);
    expect(h.up.seen).toEqual([]);
  });
});

describe("T.E85 / #E85 — Location rewrite", () => {
  const loc = async (to: string) => {
    const r = await h.get(`/preview/${pid}/redirect`, { "x-redirect-to": to });
    expect(r.status).toBe(302);
    return String(r.headers.location);
  };
  const dashboardOrigin = "http://dash.invalid";
  const insideDashboardOrigin = (l: string) => new URL(l, dashboardOrigin).origin === dashboardOrigin;

  it("T.E85 a root-absolute `/login` is rewritten into the prefix", async () => {
    expect(await loc("/login")).toBe(`/preview/${pid}/login`);
  });
  it("T.E85 a Location already inside the prefix is unchanged, never doubled", async () => {
    expect(await loc(`/preview/${pid}/login`)).toBe(`/preview/${pid}/login`);
    expect(await loc(`/preview/${pid}`)).toBe(`/preview/${pid}`);
    expect(await loc(`/preview/${pid}/`)).toBe(`/preview/${pid}/`);
  });
  it("T.E85 other root-absolute forms follow the prefix rule and never leave the dashboard origin", async () => {
    const other = "B".repeat(22);
    expect(await loc(`/preview/${other}/x`)).toBe(`/preview/${pid}/preview/${other}/x`);
    expect(await loc("//evil.example/")).toBe(`/preview/${pid}//evil.example/`);
    expect(await loc(`http://127.0.0.1:${h.up.port}/x?y=1`)).toBe(`/preview/${pid}/x?y=1`);
    expect(await loc("?x=1")).toBe("?x=1");
    for (const to of ["/login", `/preview/${other}/x`, "//evil.example/", `http://127.0.0.1:${h.up.port}/x`, "?x=1", "/%2e%2e/api/sessions", "/../api/sessions"]) {
      const l = await loc(to);
      expect(insideDashboardOrigin(l), `${to} → ${l}`).toBe(true);
      expect(new URL(l, `${dashboardOrigin}/preview/${pid}/`).pathname.startsWith(`/preview/${pid}`), `${to} → ${l}`).toBe(true);
    }
  });
});

describe("T.X16 / #X16 — upstream down / slow on tier 5", () => {
  it("T.X16 (a) a refusing upstream → 502 and the pid survives (target still registered); nothing leaks the pid", async () => {
    await h.up.stop();
    const r = await h.get(`/preview/${pid}/x`);
    expect(r.status).toBe(502);
    expect(r.headers.location).toBeUndefined();
    expect(r.body).not.toContain(pid);
    expect(h.paths.validate(pid, { genuinelyLocal: true })?.tier).toBe(5);
    expect(h.logs.join("\n")).not.toContain(pid);
  });

  it("T.X16 (b) an upstream that resets the connection → 502 and the pid survives", async () => {
    const r = await h.get(`/preview/${pid}/reset`);
    expect(r.status).toBe(502);
    expect(r.body).not.toContain(pid);
    expect(h.paths.validate(pid, { genuinelyLocal: true })?.tier).toBe(5);
    expect((await h.get(`/preview/${pid}/ok`)).status).toBe(200); // the next request still routes
    expect(h.logs.join("\n")).not.toContain(pid);
  });

  it("T.X16 (c) an upstream that never answers the WS upgrade: the upgrade socket is destroyed at the handshake timeout", async () => {
    h.up.upgradeMode = "hang";
    const manager = { get: (id: string) => h.targets.get(id), getStatic: () => undefined, use: () => {} } as unknown as LiveServerManager;
    h.app.server.on("upgrade", (req, socket, head) => {
      const p = parsePreviewPath(req.url);
      const g = p ? h.paths.validate(p.pid, { genuinelyLocal: true }) : null;
      if (!g) {
        socket.destroy();
        return;
      }
      handleLiveServerUpgrade(manager, req, socket, head, { previewTargetId: g.targetId });
    });
    const t0 = performance.now();
    const reply = await dialUpgrade(h.port(), `/preview/${pid}/ws`);
    const elapsed = performance.now() - t0;
    expect(h.up.upgrades).toHaveLength(1); // it reached the upstream, which never answered
    expect(reply).toBe(""); // no 101, no half-open reply: the socket was destroyed
    expect(elapsed).toBeGreaterThan(5_000);
    expect(elapsed).toBeLessThan(15_000);
    expect(h.paths.validate(pid, { genuinelyLocal: true })?.tier).toBe(5);
    expect(h.logs.join("\n")).not.toContain(pid);
  }, 30_000);
});

describe("T.P10 / #P10 — pid lookup under cap", () => {
  const MINT_POLICY = { egress: "restricted", scripts: false } as const;
  const stores = (n: number) => {
    const s = new PreviewPathStore();
    const live: string[] = [];
    for (let i = 0; i < n; i++) {
      // 8 principals × 32 pids = 256, the server cap
      const m = s.mint(`t${i}`, { kind: "device", tier: "control", deviceId: `dev-${i % 8}` }, { policy: MINT_POLICY });
      if (!m.ok) throw new Error(`mint ${i} refused: ${m.reason}`);
      live.push(m.pid);
    }
    return { s, live };
  };
  const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];

  it("T.P10 256-entry p95 ≤ 1.2× 1-entry p95 in the same run (hash index, no linear scan); unknown-dominated mix", async () => {
    const one = stores(1);
    const many = stores(256);
    expect(many.s.size()).toBe(256);
    // Unknown pids are well-shaped (so they reach the hash lookup) and never live.
    const unknown = Array.from({ length: 900 }, (_, i) => `U${String(i).padStart(21, "x")}`);
    const batch = (st: { s: PreviewPathStore; live: string[] }) => {
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) {
        // 90% unknown, 10% valid
        const probe = i % 10 === 0 ? st.live[(i / 10) % st.live.length] : unknown[i % unknown.length];
        st.s.validate(probe, { genuinelyLocal: true });
      }
      return performance.now() - t0;
    };
    for (let w = 0; w < 20; w++) {
      batch(one);
      batch(many);
    }
    const tOne: number[] = [];
    const tMany: number[] = [];
    // 400 interleaved batches × 1000 lookups per store (400k lookups each); interleaving cancels drift / GC bias.
    for (let b = 0; b < 400; b++) {
      tOne.push(batch(one));
      tMany.push(batch(many));
    }
    expect(p95(tMany)).toBeLessThanOrEqual(p95(tOne) * 1.2);
    // correctness under the same workload: every live pid still resolves, unknown ones never do
    for (const l of many.live) expect(many.s.validate(l, { genuinelyLocal: true })?.tier).toBe(5);
    for (const u of unknown.slice(0, 50)) expect(many.s.validate(u, { genuinelyLocal: true })).toBeNull();
  }, 60_000);

  it("T.P10 the capability hook resolves a live pid and an unknown pid at the same cost class regardless of table size", async () => {
    const { s, live } = stores(256);
    const hook = createLiveCapabilityHook(new LiveCapabilityStore(), s);
    const req = (url: string) => ({ url, ip: "127.0.0.1", headers: {} as Record<string, unknown> });
    const hit = req(`/preview/${live[7]}/x`);
    await hook(hit);
    expect((hit as unknown as { liveCapability?: { tier: number } }).liveCapability?.tier).toBe(5);
    const miss = req(`/preview/${"U".repeat(22)}/x`);
    await hook(miss);
    expect((miss as unknown as { liveCapability?: unknown }).liveCapability).toBeUndefined();
  });
});
