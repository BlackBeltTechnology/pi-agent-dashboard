/**
 * `knownServers` persistence: legacy + routes shapes, collapse on load, host/port
 * mirror, malformed routes, rollback to the previous parser, no startup rewrite.
 *
 * See change: group-servers-by-identity (test-plan #E10, #E11; tasks 2.1, 2.2).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type KnownServer,
  knownServersNeedMigration,
  loadConfig,
  parseKnownServers,
  rawKnownServersNeedMigration,
  toStoredKnownServer,
  toStoredKnownServers,
} from "../config.js";

const t = "2026-01-01T00:00:00.000Z";
const F = "sha256:F";
const G = "sha256:G";

const route = (host: string, port: number, scheme: "http" | "https" = "http", source = "saved") => ({ host, port, scheme, source });

/** Snapshot of the PREVIOUS build's parser (config.ts before this change) — the rollback fixture. */
function previousParseKnownServers(raw: any): Array<{ host: string; port: number; label?: string; addedAt: string; fingerprint?: string }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Array<{ host: string; port: number; label?: string; addedAt: string; fingerprint?: string }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || typeof entry.host !== "string" || typeof entry.port !== "number") continue;
    const fingerprint =
      typeof entry.fingerprint === "string" && /^sha256:.+/.test(entry.fingerprint) ? entry.fingerprint : undefined;
    if (fingerprint) {
      const key = `${fingerprint}|${entry.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push({
      host: entry.host,
      port: entry.port,
      ...(typeof entry.label === "string" ? { label: entry.label } : {}),
      addedAt: typeof entry.addedAt === "string" ? entry.addedAt : new Date().toISOString(),
      ...(fingerprint ? { fingerprint } : {}),
    });
  }
  return out;
}

describe("parseKnownServers — reading (#E10)", () => {
  it("a legacy entry reads as one http route with source saved", () => {
    const [e] = parseKnownServers([{ host: "h", port: 8000, addedAt: t }]);
    expect(e.routes).toEqual([route("h", 8000, "http")]);
    expect(e).toMatchObject({ host: "h", port: 8000, addedAt: t });
  });

  it("a legacy entry on port 443 reads as https", () => {
    const [e] = parseKnownServers([{ host: "lab.example.org", port: 443, addedAt: t }]);
    expect(e.routes).toEqual([route("lab.example.org", 443, "https")]);
    expect(e).toMatchObject({ host: "lab.example.org", port: 443 });
  });

  it("a routes-shape entry keeps its routes in order; the mirror is the first http route", () => {
    const [e] = parseKnownServers([
      { host: "x", port: 443, addedAt: t, fingerprint: F, routes: [route("X", 443, "https", "pairing"), route("Y", 8000, "http", "mdns")] },
    ]);
    expect(e.routes.map((r) => r.host)).toEqual(["X", "Y"]);
    expect(e.routes.map((r) => r.source)).toEqual(["pairing", "mdns"]);
    expect(e).toMatchObject({ host: "Y", port: 8000 });
  });

  it("an https-only entry mirrors its https host and port", () => {
    const [e] = parseKnownServers([{ host: "stale", port: 1, addedAt: t, routes: [route("lab.example.org", 443, "https")] }]);
    expect(e).toMatchObject({ host: "lab.example.org", port: 443 });
  });

  it("an entry without a fingerprint still loads", () => {
    const [e] = parseKnownServers([{ host: "h", port: 8000, addedAt: t, routes: [route("h", 8000)] }]);
    expect(e.fingerprint).toBeUndefined();
    expect(e.routes).toHaveLength(1);
  });

  it("an unknown or missing source reads as saved; extra route fields are not kept", () => {
    const [e] = parseKnownServers([{ host: "h", port: 8000, addedAt: t, routes: [{ ...route("h", 8000), source: "weird", extra: 1 }] }]);
    expect(e.routes).toEqual([route("h", 8000, "http", "saved")]);
  });

  it("collapse: same fingerprint + same http port → first survives, routes unioned without loss or duplicate, label taken from the later entry when the survivor has none", () => {
    const out = parseKnownServers([
      { host: "a", port: 8000, addedAt: t, fingerprint: F, label: "", routes: [route("a", 8000), route("b", 8000)] },
      { host: "b", port: 8000, addedAt: t, fingerprint: F, label: "Lab", routes: [route("b", 8000), route("c", 8000)] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].routes.map((r) => r.host)).toEqual(["a", "b", "c"]);
    expect(out[0].host).toBe("a");
  });

  it("collapse keeps the survivor's own label, and takes the later one only when absent", () => {
    const keep = parseKnownServers([
      { host: "a", port: 8000, addedAt: t, fingerprint: F, label: "First" },
      { host: "b", port: 8000, addedAt: t, fingerprint: F, label: "Second" },
    ]);
    expect(keep[0].label).toBe("First");
    const take = parseKnownServers([
      { host: "a", port: 8000, addedAt: t, fingerprint: F },
      { host: "b", port: 8000, addedAt: t, fingerprint: F, label: "Lab" },
    ]);
    expect(take[0].label).toBe("Lab");
  });

  it("the legacy collapse still applies: the later duplicate (fingerprint, port) is gone, the entry order is stable", () => {
    const out = parseKnownServers([
      { host: "a", port: 1, addedAt: t, fingerprint: "sha256:x" },
      { host: "d", port: 8000, addedAt: t, fingerprint: "sha256:z" },
      { host: "e", port: 8000, addedAt: t, fingerprint: "sha256:z" },
      { host: "f", port: 9, addedAt: t },
    ]);
    expect(out.map((e) => e.host)).toEqual(["a", "d", "f"]);
    expect(out[1].routes.map((r) => r.host)).toEqual(["d", "e"]);
  });

  it("the same fingerprint on port 9000 stays a second entry", () => {
    const out = parseKnownServers([
      { host: "a", port: 8000, addedAt: t, fingerprint: F },
      { host: "a", port: 9000, addedAt: t, fingerprint: F },
    ]);
    expect(out).toHaveLength(2);
  });

  it("two entries with the same fingerprint and only https routes stay two entries (no http port in common)", () => {
    const out = parseKnownServers([
      { host: "a.example", port: 443, addedAt: t, fingerprint: F },
      { host: "b.example", port: 443, addedAt: t, fingerprint: F },
    ]);
    expect(out).toHaveLength(2);
  });

  it("a merge that gives the survivor a port another entry holds collapses that one too", () => {
    const out = parseKnownServers([
      { host: "a", port: 8000, addedAt: t, fingerprint: F },
      { host: "b", port: 9000, addedAt: t, fingerprint: F },
      { host: "c", port: 8000, addedAt: t, fingerprint: F, routes: [route("c", 8000), route("c", 9000)] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].routes.map((r) => `${r.host}:${r.port}`)).toEqual(["a:8000", "c:8000", "c:9000", "b:9000"]);
  });

  it("different fingerprints on the same port are different entries", () => {
    expect(
      parseKnownServers([
        { host: "a", port: 8000, addedAt: t, fingerprint: F },
        { host: "b", port: 8000, addedAt: t, fingerprint: G },
      ]),
    ).toHaveLength(2);
  });

  it("two spellings of one host inside one entry are one route", () => {
    const [e] = parseKnownServers([
      { host: "a", port: 8000, addedAt: t, routes: [route("Home-iMac.LOCAL", 8000), route("home-imac.local.", 8000)] },
    ]);
    expect(e.routes).toHaveLength(1);
  });

  describe("malformed routes never lose an entry (D11)", () => {
    const base = { host: "h", port: 8000, addedAt: t };

    it.each([
      ["routes: []", []],
      ['routes: "x"', "x"],
      ["routes: null", null],
      ["scheme ftp", [route("h", 8000, "ftp" as never)]],
      ["port 0", [route("h", 0)]],
      ["port 65536", [route("h", 65536)]],
      ["port a string", [{ host: "h", port: "8000", scheme: "http", source: "saved" }]],
      ["no host", [{ port: 8000, scheme: "http", source: "saved" }]],
      ["a non-object", ["http://h:8000", 7, null]],
    ])("%s → one legacy route from the mirror", (_label, routes) => {
      const [e] = parseKnownServers([{ ...base, routes }]);
      expect(e.routes).toEqual([route("h", 8000, "http")]);
      expect(e).toMatchObject({ host: "h", port: 8000 });
    });

    it("mirror port 443 → the fallback route is https", () => {
      const [e] = parseKnownServers([{ host: "h", port: 443, addedAt: t, routes: [] }]);
      expect(e.routes).toEqual([route("h", 443, "https")]);
    });

    it("invalid routes are dropped, valid ones kept", () => {
      const [e] = parseKnownServers([{ ...base, routes: [route("h", 0), route("ok", 9000), route("x", 1, "ftp" as never)] }]);
      expect(e.routes).toEqual([route("ok", 9000)]);
      expect(e).toMatchObject({ host: "ok", port: 9000 });
    });

    it("valid routes win over a mirror that disagrees", () => {
      const [e] = parseKnownServers([{ ...base, routes: [route("other", 9000)] }]);
      expect(e.routes).toEqual([route("other", 9000)]);
      expect(e).toMatchObject({ host: "other", port: 9000 });
    });

    it("an entry with neither a valid route nor a valid mirror is skipped; the rest load", () => {
      const out = parseKnownServers([
        { addedAt: t, routes: [route("h", 0)] },
        { host: "m", port: 0, addedAt: t, routes: [] },
        { host: "n", port: "x", addedAt: t },
        null,
        "junk",
        base,
      ]);
      expect(out.map((e) => e.host)).toEqual(["h"]);
    });

    it("a non-array knownServers is empty", () => {
      expect(parseKnownServers(undefined)).toEqual([]);
      expect(parseKnownServers({})).toEqual([]);
    });
  });

  it("a fingerprint that is not sha256: is dropped (existing rule) in both shapes", () => {
    const out = parseKnownServers([
      { host: "a", port: 1, addedAt: t, fingerprint: "md5:y" },
      { host: "b", port: 2, addedAt: t, fingerprint: "sha256:", routes: [route("b", 2)] },
    ]);
    expect(out.every((e) => !("fingerprint" in e))).toBe(true);
  });

  it("a missing addedAt is filled, not dropped (existing rule)", () => {
    const [e] = parseKnownServers([{ host: "h", port: 8000 }]);
    expect(typeof e.addedAt).toBe("string");
  });
});

describe("toStoredKnownServer(s) — the write side (#E10, #E11)", () => {
  it("always emits routes and the host/port mirror of the primary route", () => {
    const entry: KnownServer = {
      host: "stale",
      port: 1,
      addedAt: t,
      fingerprint: F,
      routes: [route("X", 443, "https", "pairing") as never, route("Y", 8000) as never],
    };
    expect(toStoredKnownServer(entry)).toEqual({
      host: "Y",
      port: 8000,
      addedAt: t,
      fingerprint: F,
      routes: [route("X", 443, "https", "pairing"), route("Y", 8000)],
    });
  });

  it("an https-only entry mirrors its https host and 443", () => {
    const stored = toStoredKnownServer({ host: "x", port: 1, addedAt: t, routes: [route("lab.example.org", 443, "https") as never] });
    expect(stored).toMatchObject({ host: "lab.example.org", port: 443 });
  });

  it("stored fields are host, port, scheme and source only — no kind, no derived data", () => {
    const stored = toStoredKnownServer({
      host: "h",
      port: 8000,
      addedAt: t,
      routes: [{ ...route("h", 8000), kind: "lan", latencyMs: 4 } as never],
    });
    expect(Object.keys(stored.routes[0]).sort()).toEqual(["host", "port", "scheme", "source"]);
  });

  it("an entry built the old way (no routes) is written in routes shape from host/port", () => {
    expect(toStoredKnownServer({ host: "h", port: 443, addedAt: t } as never).routes).toEqual([route("h", 443, "https")]);
    expect(toStoredKnownServer({ host: "h", port: 8000, addedAt: t } as never).routes).toEqual([route("h", 8000, "http")]);
  });

  it("keeps label and omits an absent fingerprint", () => {
    const stored = toStoredKnownServer({ host: "h", port: 8000, addedAt: t, label: "Lab", routes: [route("h", 8000) as never] });
    expect(stored.label).toBe("Lab");
    expect("fingerprint" in stored).toBe(false);
  });

  it("round-trips through parseKnownServers unchanged", () => {
    const list = parseKnownServers([
      { host: "a", port: 8000, addedAt: t, fingerprint: F, routes: [route("a", 8000), route("x.example", 443, "https", "pairing")] },
      { host: "b", port: 9000, addedAt: t },
    ]);
    expect(parseKnownServers(JSON.parse(JSON.stringify(toStoredKnownServers(list))))).toEqual(list);
  });
});

describe("rollback to the previous build + no startup rewrite (#E11)", () => {
  let dir: string;
  let file: string;
  let origHome: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ks-routes-"));
    fs.mkdirSync(path.join(dir, ".pi", "dashboard"), { recursive: true });
    file = path.join(dir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME;
    process.env.HOME = dir;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const routesShape = [
    {
      host: "192.168.16.204",
      port: 8000,
      addedAt: t,
      fingerprint: F,
      label: "Home",
      routes: [route("192.168.16.204", 8000), route("home-imac.local", 8000, "http", "mdns"), route("h0me1mac.share.zrok.io", 443, "https", "pairing")],
    },
    { host: "lab.example.org", port: 443, addedAt: t, fingerprint: G, routes: [route("lab.example.org", 443, "https")] },
    { host: "nas", port: 8000, addedAt: t, routes: [route("nas", 8000)] },
  ];

  it("the previous parser lists every entry under its mirror", () => {
    const old = previousParseKnownServers(JSON.parse(JSON.stringify(routesShape)));
    expect(old.map((e) => `${e.host}:${e.port}`)).toEqual(["192.168.16.204:8000", "lab.example.org:443", "nas:8000"]);
    expect(old[0]).toMatchObject({ label: "Home", fingerprint: F });
    // and the new parser's written form is what it reads, mirror included
    const written = toStoredKnownServers(parseKnownServers(routesShape));
    expect(previousParseKnownServers(written).map((e) => `${e.host}:${e.port}`)).toEqual(["192.168.16.204:8000", "lab.example.org:443", "nas:8000"]);
  });

  it("an https-only entry written by the new build loads under the previous parser (scheme is lost there, entry is not)", () => {
    const written = toStoredKnownServers(parseKnownServers([{ host: "x", port: 1, addedAt: t, routes: [route("lab.example.org", 443, "https")] }]));
    const old = previousParseKnownServers(written);
    expect(old).toHaveLength(1);
    expect(old[0]).toMatchObject({ host: "lab.example.org", port: 443 });
    // re-upgrade: what the old build rewrote (no routes) reads back as https for 443
    expect(parseKnownServers(old)[0].routes).toEqual([route("lab.example.org", 443, "https")]);
  });

  it("an https route on another port comes back as http after an old-build rewrite (documented loss)", () => {
    const written = toStoredKnownServers(parseKnownServers([{ host: "x", port: 1, addedAt: t, routes: [route("lab.example.org", 8443, "https")] }]));
    expect(parseKnownServers(previousParseKnownServers(written))[0].routes).toEqual([route("lab.example.org", 8443, "http")]);
  });

  it("loadConfig at startup leaves the file bytes identical (odd whitespace, previous shape and routes shape)", () => {
    const legacy = `{\n\t"port":8000 ,  "knownServers" : [ {"host":"h","port":8000,"addedAt":"${t}"} ,\n  { "host":"lab.example.org","port":443,"addedAt":"${t}"}]\r\n}`;
    fs.writeFileSync(file, legacy);
    const before = fs.readFileSync(file);
    const cfg = loadConfig();
    expect(cfg.knownServers.map((e) => e.routes.length)).toEqual([1, 1]);
    expect(Buffer.compare(before, fs.readFileSync(file))).toBe(0);

    const shaped = JSON.stringify({ knownServers: routesShape }, null, 7);
    fs.writeFileSync(file, shaped);
    const beforeShaped = fs.readFileSync(file);
    expect(loadConfig().knownServers).toHaveLength(3);
    expect(Buffer.compare(beforeShaped, fs.readFileSync(file))).toBe(0);
  });

  it("loadConfig reads the routes shape through to the entries", () => {
    fs.writeFileSync(file, JSON.stringify({ knownServers: routesShape }));
    const [first, second] = loadConfig().knownServers;
    expect(first.routes.map((r) => r.source)).toEqual(["saved", "mdns", "pairing"]);
    expect(second).toMatchObject({ host: "lab.example.org", port: 443 });
  });

  it("knownServersNeedMigration: true while any entry is in the previous shape, false once every entry carries routes", () => {
    fs.writeFileSync(file, JSON.stringify({ knownServers: [{ host: "h", port: 8000, addedAt: t }] }));
    expect(knownServersNeedMigration()).toBe(true);
    fs.writeFileSync(file, JSON.stringify({ knownServers: toStoredKnownServers(loadConfig().knownServers) }));
    expect(knownServersNeedMigration()).toBe(false);
  });

  it("rawKnownServersNeedMigration: only a non-empty list with an entry lacking routes", () => {
    expect(rawKnownServersNeedMigration(undefined)).toBe(false);
    expect(rawKnownServersNeedMigration([])).toBe(false);
    expect(rawKnownServersNeedMigration("x")).toBe(false);
    expect(rawKnownServersNeedMigration(routesShape)).toBe(false);
    expect(rawKnownServersNeedMigration([...routesShape, { host: "h", port: 1, addedAt: t }])).toBe(true);
    expect(rawKnownServersNeedMigration([{ host: "h", port: 1, addedAt: t, routes: [] }])).toBe(true);
  });

  it("knownServersNeedMigration is false with no config file", () => {
    expect(knownServersNeedMigration()).toBe(false);
  });
});
