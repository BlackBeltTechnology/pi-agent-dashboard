import { describe, expect, it } from "vitest";
import { collectEndpoints, liveReadinessEndpoints } from "../tunnel/tunnel-endpoints.js";

const MAGIC = { kind: "magicdns" as const, url: "http://box.tail1.ts.net:8000", tls: false };
const MESH = { kind: "mesh" as const, url: "http://100.97.246.31:8000", tls: false };
const ZROK = { kind: "public" as const, url: "https://abc.shares.zrok.io", tls: true };

describe("liveReadinessEndpoints — domain URLs from every connected provider", () => {
  it("takes endpoints of connected providers only, dropping url-less liveness markers", () => {
    const eps = liveReadinessEndpoints([
      { provider: "tailscale", state: "connected", endpoints: [MAGIC, MESH, { kind: "magicdns", url: "", tls: false }] },
      { provider: "zrok", state: "connected", endpoints: [ZROK] },
      { provider: "ngrok", state: "disconnected", endpoints: [{ kind: "public", url: "https://stale.ngrok.app", tls: true }] },
    ]);
    expect(eps.map((e) => e.url)).toEqual([MAGIC.url, MESH.url, ZROK.url]);
  });

  it("feeds collectEndpoints so the QR list carries the MagicDNS name, deduped against LAN", () => {
    const all = collectEndpoints({
      providerEndpoints: liveReadinessEndpoints([{ provider: "tailscale", state: "connected", endpoints: [MAGIC, MESH] }]),
      port: 8000,
      includeLocal: false,
    });
    expect(all.map((e) => e.url)).toEqual([MAGIC.url, MESH.url]);
  });
});
