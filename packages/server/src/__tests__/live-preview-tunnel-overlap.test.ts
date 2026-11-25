/**
 * D12 overlap set is LIVE: a connected tunnel origin (or a TLS-listener certificate name) that is label-shaped under the
 * tier-2 suffix disables tier 2 on the next read — one log line naming `wildcard.suffix` and the source, no more mint of
 * tier 2, the host is no longer preview-shaped (dashboard host gate admits it as `live-tunnel`), and a live tier-2 entry
 * on that suffix is revoked `config-changed`.
 *
 * See change: serve-live-previews-on-capability-origin (D12; test-plan #E53).
 */
import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyAdmittedHostname, type HostAdmissionOptions } from "../auth/host-admission.js";
import {
  getResolvedPreviewOrigins,
  notifyPreviewOriginsRuntimeChanged,
  resetConfigSnapshot,
  setPreviewOriginsRuntime,
} from "../config-snapshot.js";
import { type CapabilityDeleteReason, LiveCapabilityStore } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createPreviewDispatch } from "../live-server/preview-dispatch.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

const A26 = "a".repeat(26);
const SUFFIX = "preview.example.com";
const WILDCARD = { suffix: SUFFIX, forHosts: ["dash.example.com"] };
const ACCEPT = ["origin", "preview"];

let tmp: string;
let origHome: string | undefined;
let tunnels: string[];
let tlsNames: string[];
const cfgFile = () => path.join(tmp, ".pi", "dashboard", "config.json");

const fakeReq = (host: string) => ({ headers: { host }, socket: {}, rawHeaders: ["Host", host] }) as unknown as http.IncomingMessage;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lp-e53-"));
  origHome = process.env.HOME;
  process.env.HOME = tmp;
  resetConfigSnapshot();
  tunnels = [];
  tlsNames = [];
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify({ liveServer: { previewOrigins: { wildcard: WILDCARD } } }), { mode: 0o600 });
  // Same runtime wiring as server.ts: live tunnel origins, TLS names and the static-admission classifier.
  const admission = (): HostAdmissionOptions => ({ getLiveTunnelOrigins: () => tunnels, tlsListenerNames: () => tlsNames });
  setPreviewOriginsRuntime({
    tunnelOrigins: () => tunnels,
    tlsNames: () => tlsNames,
    classifyAdmittedHostname: (hostname) => classifyAdmittedHostname(hostname, admission()),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  setPreviewOriginsRuntime({});
  process.env.HOME = origHome;
  resetConfigSnapshot();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("T.E53 / #E53 — live-tunnel origin overlapping a label-shaped host", () => {
  async function build() {
    const reasons: CapabilityDeleteReason[] = [];
    const store = new LiveCapabilityStore({
      isTargetLive: () => true,
      onDelete: (_e, r) => reasons.push(r),
      getPreviewConfig: () => getResolvedPreviewOrigins(),
    });
    const manager = {
      get: (id: string) => (id === "vite-5173" ? { id, label: id, host: "127.0.0.1", port: 5173 } : undefined),
      getStatic: () => undefined,
      has: (id: string) => id === "vite-5173",
      use: () => {},
      list: () => [],
    } as unknown as LiveServerManager;
    const app: FastifyInstance = Fastify({ logger: false });
    app.decorateRequest("isAuthenticated", false);
    registerLiveServerRoutes(app, manager, { networkGuard: async () => undefined, capabilities: store, log: () => {} });
    await app.ready();
    const mintTier2 = () =>
      app.inject({
        method: "POST",
        url: "/api/live-server/vite-5173/capability",
        remoteAddress: "127.0.0.1",
        headers: { host: "dash.example.com", origin: "https://dash.example.com" },
        payload: { accept: ACCEPT },
      });
    const dispatch = createPreviewDispatch({ store, manager, isPeerLocal: () => true });
    return { app, store, reasons, mintTier2, dispatch };
  }

  it("tunnel connect: tier 2 off with ONE log line naming wildcard.suffix and the tunnel; mint is not tier 2; live tier-2 entry revoked `config-changed`; host no longer preview-shaped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { app, store, reasons, mintTier2, dispatch } = await build();
    try {
      // --- before: tier 2 active, a live tier-2 entry exists, the label host is preview-shaped
      expect(getResolvedPreviewOrigins().tiers).toContain(2);
      const first = (await mintTier2()).json();
      expect(first.tier).toBe(2);
      expect(first.origin).toMatch(new RegExp(`^https://[a-z2-7]{26}\\.${SUFFIX.replace(/\./g, "\\.")}$`));
      expect(store.size()).toBe(1);
      expect(dispatch.isPreviewRequest(fakeReq(`${A26}.${SUFFIX}`))).toBe(true);
      const overlapLines = () => warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("wildcard.suffix"));
      expect(overlapLines()).toHaveLength(0);

      // --- connect a tunnel whose origin is label-shaped under the suffix
      tunnels = [`https://${A26}.${SUFFIX}`];
      const after = getResolvedPreviewOrigins();
      expect(after.tiers).not.toContain(2);
      expect(after.wildcard).toBeUndefined();
      for (let i = 0; i < 50; i++) getResolvedPreviewOrigins(); // steady state: no re-log
      expect(overlapLines()).toHaveLength(1);
      expect(overlapLines()[0]).toContain("wildcard.suffix");
      expect(overlapLines()[0]).toContain(`"${SUFFIX}"`);
      expect(overlapLines()[0]).toContain("live tunnel origins");
      expect(overlapLines()[0]).toContain("tier 2");

      // the tunnel host is dashboard-routed now (static admission as `live-tunnel`), not preview-shaped
      expect(classifyAdmittedHostname(`${A26}.${SUFFIX}`, { getLiveTunnelOrigins: () => tunnels })).toBe("live-tunnel");
      expect(dispatch.isPreviewRequest(fakeReq(`${A26}.${SUFFIX}`))).toBe(false);

      // --- mint no longer returns tier 2 (and the mint's sweep revokes the stale tier-2 entry)
      const second = (await mintTier2()).json();
      expect(second.tier).not.toBe(2);
      expect(second.origin).toBeUndefined();
      expect(reasons).toEqual(["config-changed"]);
      expect(store.size()).toBe(1); // only the fresh non-tier-2 entry
      expect(store.isAdmittedHost(new URL(first.origin).host)).toBe(false);

      // --- disconnect: re-evaluated on the next read, tier 2 returns (no restart)
      tunnels = [];
      expect(getResolvedPreviewOrigins().tiers).toContain(2);
    } finally {
      await app.close();
      await dispatch.close();
      store.close();
    }
  });

  it("certificate change: a TLS-listener name in the overlap set disables tier 2 on the notification, and re-enables when it goes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(getResolvedPreviewOrigins().tiers).toContain(2);
    tlsNames = [`${A26}.${SUFFIX}`];
    notifyPreviewOriginsRuntimeChanged();
    const r = getResolvedPreviewOrigins();
    expect(r.tiers).not.toContain(2);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("wildcard.suffix"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("TLS listener names");
    tlsNames = [];
    notifyPreviewOriginsRuntimeChanged();
    expect(getResolvedPreviewOrigins().tiers).toContain(2);
  });

  it("a tunnel under a DIFFERENT suffix, or a non-label-shaped name under this one, leaves tier 2 alone", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    tunnels = ["https://abc.share.zrok.io", `https://dash.${SUFFIX}`, `https://${"a".repeat(25)}.${SUFFIX}`];
    expect(getResolvedPreviewOrigins().tiers).toContain(2);
  });
});
