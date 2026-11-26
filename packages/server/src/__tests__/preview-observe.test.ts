/**
 * Preview observability (D13): exact redacted line grammar, refuse/admit rate limiting, drop reasons, no secret in any line.
 * See change: serve-live-previews-on-capability-origin (D13; test-plan #E156, #E157, #P18, #X41).
 */
import { parsePreviewOrigins, resolvePreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { type CapabilityPrincipal, LiveCapabilityStore } from "../live-server/live-capability.js";
import { liveLog } from "../live-server/live-log.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createPreviewObserver, MAX_TRACKED, REFUSE_WINDOW_MS } from "../live-server/preview-observe.js";
import { previewLogHash } from "../live-server/preview-origin.js";
import { PreviewPathStore } from "../live-server/preview-path-store.js";
import { reservePreviewPath } from "../live-server/preview-reserve.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

const H = /^[0-9a-f]{8}$/;
const POLICY = { policy: { egress: "restricted", scripts: false } } as const;

describe("refuse / admit lines (E157, P18)", () => {
  it("one `refuse` per h per 60 s window (boundaries), distinct h each logged, `admit` only for the first request of an entry", () => {
    let t = 0;
    const lines: string[] = [];
    const o = createPreviewObserver({ sink: (l) => lines.push(l), now: () => t });
    for (let i = 0; i < 1000; i++) o.refused("unknown", "abcdef12");
    expect(lines).toEqual(["[live-preview] refuse h=abcdef12 reason=unknown"]);
    t = REFUSE_WINDOW_MS - 1;
    o.refused("unknown", "abcdef12");
    expect(lines).toHaveLength(1); // 59.999 s: still suppressed
    t = REFUSE_WINDOW_MS;
    o.refused("expired", "abcdef12");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("[live-preview] refuse h=abcdef12 reason=expired");
    for (let i = 0; i < 100; i++) o.refused("unknown", i.toString(16).padStart(8, "0"));
    expect(lines).toHaveLength(102); // 100 distinct labels each logged once
    o.admitted("11111111", 1);
    o.admitted("11111111", 1);
    expect(lines.filter((l) => l.includes(" admit "))).toEqual(["[live-preview] admit h=11111111 tier=1"]);
    o.forget("11111111");
    o.admitted("11111111", 1);
    expect(lines.filter((l) => l.includes(" admit "))).toHaveLength(2);
  });
  it("tracked state is bounded (256 hosts / 1024 admits) however many distinct labels arrive", () => {
    const o = createPreviewObserver({ sink: () => {} });
    for (let i = 0; i < 5000; i++) {
      o.refused("unknown", i.toString(16).padStart(8, "0"));
      o.admitted(`a${i.toString(16).padStart(7, "0")}`, 2);
    }
    expect(o.size().refuse).toBeLessThanOrEqual(MAX_TRACKED);
    expect(o.size().admit).toBeLessThanOrEqual(MAX_TRACKED * 4);
  });
  it("a refusal with no label-shaped host is keyed by reason (no `h=` field)", () => {
    const lines: string[] = [];
    const o = createPreviewObserver({ sink: (l) => lines.push(l) });
    o.refused("malformed-host");
    o.refused("malformed-host");
    expect(lines).toEqual(["[live-preview] refuse reason=malformed-host"]);
  });
});

describe("liveLog formatting + redaction (X41)", () => {
  it("bare tokens print bare; anything else is JSON-encoded (no forged second line); capability-shaped paths are redacted", () => {
    const lines: string[] = [];
    liveLog((l) => lines.push(l), "mint", { tier: 1, target: "vite-5173", h: "abcdef12", via: "dash.example.com:8000", peerLocal: true, reason: "first-match" });
    expect(lines[0]).toBe("[live-preview] mint tier=1 target=vite-5173 h=abcdef12 via=dash.example.com:8000 peerLocal=true reason=first-match");
    liveLog((l) => lines.push(l), "x", { note: "a b\n[live-preview] forged", n: undefined });
    expect(lines[1]).not.toContain("\n");
    expect(lines[1]).toContain('note="a b\\n[live-preview] forged"');
    liveLog((l) => lines.push(l), "x", { path: "/live/t/~c/ABCDEFGHIJKLMNOPQRSTUV/x", pid: "/preview/AAAAAAAAAAAAAAAAAAAAAA/y" });
    expect(lines[2]).not.toContain("ABCDEFGHIJKLMNOPQRSTUV");
    expect(lines[2]).not.toContain("AAAAAAAAAAAAAAAAAAAAAA");
  });
});

describe("mint / reserve / drop lines (E156)", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });
  async function mk() {
    const lines: string[] = [];
    const app = Fastify({ logger: false });
    apps.push(app);
    const manager = {
      get: (id: string) => (id === "vite-5173" ? { id, label: id, host: "127.0.0.1", port: 5173 } : undefined),
      getStatic: () => undefined,
      has: (id: string) => id === "vite-5173",
      use: () => {},
      list: () => [],
    } as unknown as LiveServerManager;
    app.decorateRequest("isAuthenticated", false);
    registerLiveServerRoutes(app, manager, {
      networkGuard: async () => undefined,
      capabilities: new LiveCapabilityStore({ isTargetLive: () => true }),
      previewOrigins: () => resolvePreviewOrigins(parsePreviewOrigins({ enabled: true }).value, { port: 8000, piPort: 9999, allowedHosts: [], publicBaseUrls: [], corsOrigins: [] }),
      previewPaths: new PreviewPathStore(),
      log: (l) => lines.push(l),
    });
    await app.ready();
    const mint = (accept: unknown) =>
      app.inject({ method: "POST", url: "/api/live-server/vite-5173/capability", remoteAddress: "127.0.0.1", headers: { host: "localhost:8000", origin: "http://localhost:8000" }, payload: { accept } });
    return { lines, mint };
  }
  it("mint lines carry tier, target, hash8, via, peerLocal, reason — and no raw label, pid or token", async () => {
    const { lines, mint } = await mk();
    const t1 = (await mint(["origin"])).json();
    const t5 = (await mint(["preview"])).json();
    const legacy = (await mint(undefined)).json();
    const label = new URL(t1.origin).hostname.split(".")[0];
    const pid = t5.path.split("/")[2];
    const token = legacy.path.split("/")[4];
    expect(lines).toEqual([
      `[live-preview] mint tier=1 target=vite-5173 h=${previewLogHash(label)} via=localhost:8000 peerLocal=true reason=first-match`,
      `[live-preview] mint tier=5 target=vite-5173 h=${previewLogHash(pid)} via=localhost:8000 peerLocal=true reason=first-match`,
      `[live-preview] mint tier=legacy target=vite-5173 via=localhost:8000 peerLocal=true reason=no-accept`,
    ]);
    const all = lines.join("\n");
    for (const secret of [label, pid, token, t1.origin]) expect(all).not.toContain(secret);
    for (const l of lines) expect(l).toMatch(new RegExp(`h=${H.source.slice(1, -1)}|tier=legacy`));
  });
  it("reserve and `pid dropped` lines (reasons: expired / target-removed / holder-revoked / adoption-refused)", () => {
    const lines: string[] = [];
    let now = 1_000_000;
    let allowed = true;
    const alive = new Set(["t"]);
    const live = new Set<string>(["a"]);
    const drops: string[] = [];
    const store = new PreviewPathStore({
      now: () => now,
      targetIdForPort: (p) => (p === 5299 ? "t" : undefined),
      isTargetLive: (id) => alive.has(id),
      isPortAllowed: () => allowed,
      isPrincipalLive: (p) => live.has(String(p.deviceId)),
      onDrop: (reason, pid) => drops.push(`${reason} h=${previewLogHash(pid)}`),
    });
    const dev = (id: string): CapabilityPrincipal => ({ kind: "device", tier: "control", deviceId: id });
    const deps = { store, hasTier5Viewer: () => true, portRefusal: () => null, log: (l: string) => lines.push(l) };
    const out = reservePreviewPath(deps, 5299, { key: "k1", principal: dev("a") }, "r1", "sess-1");
    expect(out.kind).toBe("ok");
    const pid = out.kind === "ok" ? out.path.split("/")[2] : "";
    expect(lines).toEqual([`[live-preview] reserve port=5299 session=sess-1 h=${previewLogHash(pid)}`]);
    expect(lines.join()).not.toContain(pid);
    // adoption refused
    allowed = false;
    store.mint("t", dev("a"), { ...POLICY, port: 5299 });
    expect(drops).toEqual([`adoption-refused h=${previewLogHash(pid)}`]);
    allowed = true;
    // minted pid: holder revoked, then target removed, then expiry
    const m1 = store.mint("t", dev("a"), POLICY);
    live.delete("a");
    store.sweep();
    expect(drops[1]).toMatch(/^holder-revoked h=/);
    live.add("a");
    const m2 = store.mint("t", dev("a"), POLICY);
    alive.delete("t");
    store.sweep();
    expect(drops[2]).toMatch(/^target-removed h=/);
    alive.add("t");
    store.mint("t", dev("a"), POLICY);
    now += 13 * 3_600_000;
    store.sweep();
    expect(drops[3]).toMatch(/^expired h=/);
    expect(m1.ok && m2.ok).toBe(true);
    // unbound reservation expiry
    store.reserve(6000, { key: "k2", principal: dev("a") });
    now += 11 * 60_000;
    store.sweep();
    expect(drops.at(-1)).toMatch(/^expired h=/);
  });
});
