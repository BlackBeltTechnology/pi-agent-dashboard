/**
 * Dynamic host admission is EXACT (D3), inside the REAL dashboard server: with live preview entries the operator-visible
 * surfaces (`GET /api/host-gate`, `GET /api/config`) carry ONE pattern row and never a label / origin; only the exact
 * minted `originHost` is admitted (sibling labels, prefixes/suffixes and other ports are refused); the row is present whenever
 * previews are enabled even with zero live entries, and absent when `enabled:false` (Q23).
 *
 * See change: serve-live-previews-on-capability-origin (D3; test-plan #E50).
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConfigSnapshot } from "../config-snapshot.js";
import { proofFetch } from "../test-support/local-credential-stamp.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;
const upstreams: http.Server[] = [];
let configFile: string;
let tick = 0;

beforeEach(() => {
  const dir = path.join(process.env.HOME!, ".pi", "dashboard");
  fs.mkdirSync(dir, { recursive: true });
  configFile = path.join(dir, "config.json");
  fs.writeFileSync(configFile, JSON.stringify({}));
  resetConfigSnapshot();
});
afterEach(async () => {
  await handle?.stop();
  handle = undefined;
  for (const u of upstreams.splice(0)) await new Promise<void>((r) => { u.closeAllConnections?.(); u.close(() => r()); });
  fs.rmSync(configFile, { force: true });
  resetConfigSnapshot();
});

function writeConfig(raw: object): void {
  fs.writeFileSync(configFile, JSON.stringify(raw));
  tick += 2;
  const t = new Date(1_700_000_000_000 + tick * 1000);
  fs.utimesSync(configFile, t, t);
}

async function startUpstream(): Promise<number> {
  const s = http.createServer((_req, res) => res.end("upstream-body"));
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  upstreams.push(s);
  return (s.address() as AddressInfo).port;
}

const rawGet = (port: number, host: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/", headers: { host }, setHost: false, agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });

const api = async (port: number, urlPath: string) => {
  const r = await proofFetch(`http://127.0.0.1:${port}${urlPath}`, { headers: { host: `localhost:${port}` } });
  return { status: r.status, text: await r.text() };
};
const startTarget = async (port: number, upstreamPort: number): Promise<string> => {
  const r = await proofFetch(`http://127.0.0.1:${port}/api/live-server/start`, {
    method: "POST",
    headers: { "content-type": "application/json", host: `localhost:${port}` },
    body: JSON.stringify({ host: "127.0.0.1", port: upstreamPort }),
  });
  return ((await r.json()) as { data: { id: string } }).data.id;
};
const mint = async (port: number, id: string) => {
  const r = await proofFetch(`http://127.0.0.1:${port}/api/live-server/${id}/capability`, {
    method: "POST",
    headers: { "content-type": "application/json", host: `localhost:${port}`, origin: `http://localhost:${port}` },
    body: JSON.stringify({ accept: ["origin"] }),
  });
  return (await r.json()) as { tier: number; origin: string };
};

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const flip = (label: string, at: number): string => label.slice(0, at) + BASE32[(BASE32.indexOf(label[at]) + 1) % 32] + label.slice(at + 1);

describe("T.E50 / #E50 — dynamic host admission is exact", () => {
  it("3 live entries: ONE `live-preview` pattern row, no label/origin in host-gate or config; only the exact originHost is admitted", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    // the pattern row is there BEFORE any entry exists
    const empty = await api(port, "/api/host-gate");
    expect(empty.status).toBe(200);
    expect(JSON.parse(empty.text).admitted.filter((r: { source: string }) => r.source === "live-preview")).toEqual([
      { host: "live preview capability hosts", source: "live-preview" },
    ]);

    const origins: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await startTarget(port, await startUpstream());
      const m = await mint(port, id);
      expect(m.tier).toBe(1);
      origins.push(m.origin);
    }
    const hosts = origins.map((o) => new URL(o).host); // `<label>.localhost:<port>`
    const labels = hosts.map((h) => h.split(".")[0]);
    expect(new Set(labels).size).toBe(3);

    const gate = await api(port, "/api/host-gate");
    expect(gate.status).toBe(200);
    const rows = JSON.parse(gate.text).admitted as { host: string; source: string }[];
    expect(rows.filter((r) => r.source === "live-preview")).toEqual([{ host: "live preview capability hosts", source: "live-preview" }]);
    const config = await api(port, "/api/config");
    expect(config.status).toBe(200);
    for (const surface of [gate.text, config.text]) {
      for (const l of labels) expect(surface).not.toContain(l);
      for (const o of origins) expect(surface).not.toContain(o);
      expect(surface).not.toMatch(/\b[a-z2-7]{26}\.localhost/);
    }

    // exact admission: the three minted hosts are served; every near-miss is refused (opaque 403)
    for (const h of hosts) expect((await rawGet(port, h)).body, h).toBe("upstream-body");
    const label = labels[0];
    const probes = [
      `${flip(label, 0)}.localhost:${port}`, // sibling label, first char flipped
      `${flip(label, 13)}.localhost:${port}`, // …middle char
      `${flip(label, 25)}.localhost:${port}`, // …last char
      `${label.slice(1)}.localhost:${port}`, // prefix cut: 25 chars is not a label
      `${label}a.localhost:${port}`, // suffix extended: 27 chars
      `x${label}.localhost:${port}`,
      `${label}.localhost:${port + 1}`, // right label, other port
      `${label}.localhost`, // right label, no port
      `sub.${label}.localhost:${port}`, // extra label
      `${label}.localhost.evil.example:${port}`, // parent-domain trick
    ];
    for (const h of probes) {
      const r = await rawGet(port, h);
      expect(r.status, h).not.toBe(200);
      expect(r.body, h).not.toBe("upstream-body");
    }
    // a wildcard-looking Host never admits anything
    expect((await rawGet(port, `*.localhost:${port}`)).body).not.toBe("upstream-body");
    // …and the admitted hosts still work afterwards (the probes revoked nothing)
    for (const h of hosts) expect((await rawGet(port, h)).body, h).toBe("upstream-body");
  }, 60_000);

  it("`enabled:false`: the `live-preview` row is absent (and every label host is refused); flipping back restores the row", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    const id = await startTarget(port, await startUpstream());
    const m = await mint(port, id);
    const host = new URL(m.origin).host;
    expect((await rawGet(port, host)).body).toBe("upstream-body");
    const hasRow = async () => JSON.parse((await api(port, "/api/host-gate")).text).admitted.some((r: { source: string }) => r.source === "live-preview");
    expect(await hasRow()).toBe(true);

    writeConfig({ liveServer: { previewOrigins: { enabled: false } } });
    expect(await hasRow()).toBe(false);
    expect((await rawGet(port, host)).status).toBe(403);

    writeConfig({ liveServer: { previewOrigins: { enabled: true } } });
    expect(await hasRow()).toBe(true);
  }, 60_000);
});
