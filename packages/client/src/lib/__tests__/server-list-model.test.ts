/**
 * Identity-merged list model — saved ∪ discovered ∪ Electron keyring, best route,
 * pair action, paired state per client, refused routes, pre-routes server.
 * See change: group-servers-by-identity (task 5.5; test-plan #E3-#E5, #E7, #F9, #X5, #X18 model side).
 */
import type { KnownServerListEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { routeKey } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { describe, expect, it } from "vitest";
import { buildServerList, type ServerListInput } from "../server-list-model.js";
import type { RouteCheck } from "../server-route-check.js";

const F = `sha256:${"A".repeat(43)}`;
const G = `sha256:${"B".repeat(43)}`;
const H = `sha256:${"C".repeat(43)}`;

const http = (host: string, port = 8000, source: "saved" | "mdns" | "pairing" = "saved") => ({ host, port, scheme: "http" as const, source });
const https = (host: string, port = 443, source: "saved" | "mdns" | "pairing" = "saved") => ({ host, port, scheme: "https" as const, source });
const entry = (over: Partial<KnownServerListEntry> & { host: string; port: number }): KnownServerListEntry => ({
  addedAt: "2026-01-01T00:00:00Z",
  routes: [http(over.host, over.port)],
  ...over,
});

const proven = (ms = 5, access: "ok" | "network-not-allowed" | "unavailable" = "ok", fingerprint = F): RouteCheck => ({ kind: "proven", fingerprint, latencyMs: ms, access });
const checksOf = (pairs: Array<[{ host: string; port: number; scheme: "http" | "https" }, RouteCheck]>) =>
  new Map(pairs.map(([r, c]) => [routeKey(r), c] as const));

const base = (over: Partial<ServerListInput> = {}): ServerListInput => ({ client: "browser", saved: [], ...over });

describe("grouping: saved ∪ discovered", () => {
  it("one entry per identity: a saved LAN route, a saved tunnel route and an advertised alias are one row with three routes", () => {
    const m = buildServerList(
      base({
        saved: [entry({ host: "192.168.16.204", port: 8000, label: "Home iMac", fingerprint: F, routes: [http("192.168.16.204"), https("h0me1mac.share.zrok.io")] })],
        discovered: [{ host: "home-imac.local", port: 8000, fingerprint: F, name: "home-imac" }],
      }),
    );
    expect(m.entries).toHaveLength(1);
    const e = m.entries[0];
    expect(e.title).toBe("Home iMac");
    expect(e.routes.map((r) => [r.host, r.scheme, r.source, r.kind])).toEqual([
      ["192.168.16.204", "http", "saved", "lan"],
      ["h0me1mac.share.zrok.io", "https", "saved", "tunnel"],
      ["home-imac.local", "http", "mdns", "mdns"],
    ]);
    expect(e.routes.map((r) => r.discovered)).toEqual([false, false, true]);
    expect(e.saved).toBe(true);
  });

  it("a saved route that is also discovered keeps its saved source and is flagged discovered", () => {
    const m = buildServerList(
      base({ saved: [entry({ host: "192.168.16.77", port: 8000, fingerprint: F })], discovered: [{ host: "192.168.16.77", port: 8000, fingerprint: F }] }),
    );
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].routes).toHaveLength(1);
    expect(m.entries[0].routes[0]).toMatchObject({ source: "saved", discovered: true });
  });

  it("a discovered server with no advertised fingerprint is its own entry, never merged", () => {
    const m = buildServerList(
      base({ saved: [entry({ host: "192.168.16.204", port: 8000, fingerprint: F })], discovered: [{ host: "nas.local", port: 8000, name: "nas" }] }),
    );
    expect(m.entries).toHaveLength(2);
    expect(m.entries[1]).toMatchObject({ saved: false, title: "nas" });
    expect(m.entries[1]).not.toHaveProperty("fingerprint");
  });

  it("the same identity on another http port is a second row, each labelled 'same identity as' the other", () => {
    const m = buildServerList(
      base({
        saved: [
          entry({ host: "192.168.16.204", port: 8000, label: "Dev A", fingerprint: F }),
          entry({ host: "192.168.16.204", port: 9000, label: "Dev B", fingerprint: F }),
        ],
      }),
    );
    expect(m.entries).toHaveLength(2);
    expect(m.entries[0].sameIdentityAs).toEqual([{ key: m.entries[1].key, title: "Dev B" }]);
    expect(m.entries[1].sameIdentityAs).toEqual([{ key: m.entries[0].key, title: "Dev A" }]);
  });

  it("entries keep the stored order; discovered-only ones follow", () => {
    const m = buildServerList(
      base({
        saved: [entry({ host: "b.local", port: 8000, label: "B" }), entry({ host: "a.local", port: 8000, label: "A" })],
        discovered: [{ host: "c.local", port: 8000, name: "C" }],
      }),
    );
    expect(m.entries.map((e) => e.title)).toEqual(["B", "A", "C"]);
  });

  it("the current dashboard is appended once when nothing holds it, and never duplicated (loopback aliases are one host)", () => {
    const missing = buildServerList(base({ current: { host: "192.168.16.31", port: 8000, label: "This" } }));
    expect(missing.entries).toHaveLength(1);
    expect(missing.entries[0]).toMatchObject({ isCurrent: true, saved: false, pairedState: "this-dashboard", title: "This" });
    const held = buildServerList(base({ saved: [entry({ host: "localhost", port: 8000 })], current: { host: "127.0.0.1", port: 8000 } }));
    expect(held.entries).toHaveLength(1);
    expect(held.entries[0].isCurrent).toBe(true);
  });
});

describe("paired state per client (D9)", () => {
  const saved = [entry({ host: "192.168.16.204", port: 8000, fingerprint: F, label: "Home" }), entry({ host: "192.168.16.77", port: 8000, fingerprint: G, label: "Studio" })];

  it("browser: 'Unknown in this tab' for every origin but the current one", () => {
    const m = buildServerList(base({ saved, current: { host: "192.168.16.204", port: 8000 } }));
    expect(m.entries.map((e) => e.pairedState)).toEqual(["this-dashboard", "unknown-in-this-tab"]);
  });

  it("Electron keyring: usable → paired, lost → needs-pairing, missing → not-paired", () => {
    const m = buildServerList({
      client: "electron",
      saved: [...saved, entry({ host: "10.0.0.9", port: 8000, fingerprint: H, label: "Lab" })],
      electron: {
        paired: [
          { fingerprint: F, label: "Home", state: "paired", host: "192.168.16.204:8000" },
          { fingerprint: G, label: "Studio", state: "needs-pairing", host: "192.168.16.77:8000" },
        ],
        discovered: [],
      },
    });
    expect(m.entries.map((e) => e.pairedState)).toEqual(["paired", "needs-pairing", "not-paired"]);
  });

  it("a keyring-only server (not saved on the dashboard) is listed with its keyring route", () => {
    const m = buildServerList({
      client: "electron",
      saved: [],
      electron: { paired: [{ fingerprint: F, label: "Away", state: "paired", host: "away.example.org:443" }], discovered: [] },
    });
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0]).toMatchObject({ title: "Away", saved: false, pairedState: "paired", fingerprint: F });
    expect(m.entries[0].routes[0]).toMatchObject({ host: "away.example.org", port: 443, scheme: "https", inKeyring: true });
  });

  it("the paired state never carries a credential: the model only ever holds the renderer-safe shape", () => {
    const m = buildServerList({
      client: "electron",
      saved,
      electron: { paired: [{ fingerprint: F, label: "Home", state: "paired", host: "192.168.16.204:8000" }], discovered: [] },
    });
    expect(JSON.stringify(m)).not.toMatch(/bearer|token|cookie/i);
  });
});

describe("best route and refused routes (D2, D3)", () => {
  const two = entry({ host: "192.168.16.204", port: 8000, fingerprint: F, routes: [http("192.168.16.204"), https("h0me1mac.share.zrok.io")] });
  const lan = http("192.168.16.204");
  const tunnel = https("h0me1mac.share.zrok.io");

  it("browser: https wins at similar latency (50 ms inclusive), http otherwise", () => {
    const at = (ms: number) =>
      buildServerList(base({ saved: [two], checks: checksOf([[lan, proven(4)], [tunnel, proven(ms)]]) })).entries[0].best?.scheme;
    expect(at(54)).toBe("https");
    expect(at(55)).toBe("http");
  });

  it("Electron paired: stored https beats a faster stored http (the bearer is never downgraded)", () => {
    const m = buildServerList({
      client: "electron",
      saved: [two],
      checks: checksOf([[lan, proven(3)], [tunnel, proven(130)]]),
      electron: { paired: [{ fingerprint: F, label: "Home", state: "paired", host: "192.168.16.204:8000" }], discovered: [] },
    });
    expect(m.entries[0].best).toMatchObject({ scheme: "https", used: true });
  });

  it("a refused route is never ranked: different identity names what it proved, and the other route is used", () => {
    const m = buildServerList(base({ saved: [two], checks: checksOf([[lan, { kind: "different-identity", fingerprint: G }], [tunnel, proven(80)]]) }));
    const e = m.entries[0];
    expect(e.routes[0]).toMatchObject({ state: "different-identity", refused: true, usable: false, provenFingerprint: G });
    expect(e.best?.host).toBe("h0me1mac.share.zrok.io");
    expect(e.status).toBe("available");
  });

  it("all routes refused → no best route, status refused (the row is blocked)", () => {
    const m = buildServerList(base({ saved: [two], checks: checksOf([[lan, { kind: "different-identity", fingerprint: G }], [tunnel, { kind: "invalid-proof" }]]) }));
    expect(m.entries[0].best).toBeNull();
    expect(m.entries[0].status).toBe("refused");
  });

  it("proven but 'Network not allowed' is never the route to open", () => {
    const m = buildServerList(base({ saved: [two], checks: checksOf([[lan, proven(4, "network-not-allowed")], [tunnel, { kind: "unreachable" }]]) }));
    expect(m.entries[0].best).toBeNull();
    expect(m.entries[0].routes[0]).toMatchObject({ state: "network-not-allowed", usable: false, refused: false });
    expect(m.entries[0].status).toBe("network-not-allowed");
  });

  it("status precedence: unchecked while any route is unchecked; can't prove (older server); unreachable", () => {
    const one = (c?: RouteCheck) => buildServerList(base({ saved: [entry({ host: "10.0.0.1", port: 8000, fingerprint: F })], checks: c ? checksOf([[http("10.0.0.1"), c]]) : undefined })).entries[0].status;
    expect(one()).toBe("unchecked");
    expect(one({ kind: "cant-prove" })).toBe("cant-prove");
    expect(one({ kind: "cant-prove-in-browser" })).toBe("cant-prove-in-browser");
    expect(one({ kind: "unreachable" })).toBe("unreachable");
  });

  it("X5: an advert claiming F for a route that proves G is shown under F as refused and never offered a pair action", () => {
    const advertised = http("192.168.16.204");
    const m = buildServerList(
      base({
        saved: [entry({ host: "10.0.0.5", port: 8000, fingerprint: F, label: "Real F" })],
        discovered: [{ host: "192.168.16.204", port: 8000, fingerprint: F }],
        checks: checksOf([[advertised, { kind: "different-identity", fingerprint: G }]]),
      }),
    );
    const e = m.entries[0];
    expect(e.routes.find((r) => r.host === "192.168.16.204")).toMatchObject({ refused: true, discovered: true, usable: false });
    expect(e.best).toBeNull();
    // The only on-link route left is the saved 10.0.0.5, so the action is for it, not the refused address.
    expect(e.pairAction).toMatchObject({ kind: "request-access", url: "http://10.0.0.5:8000/pair?request" });
    const onlyRefused = buildServerList(
      base({
        discovered: [{ host: "192.168.16.204", port: 8000, fingerprint: F }],
        checks: checksOf([[advertised, { kind: "different-identity", fingerprint: G }]]),
      }),
    );
    // Nothing on-link is left to knock at: only the code flow (which contacts nothing at the refused address).
    expect(onlyRefused.entries[0].pairAction).toEqual({ kind: "pair-with-code" });
  });
});

describe("pair action per client (D8, E7 model side)", () => {
  it("browser: request access for an on-link route, pair with code for a tunnel-only server, none when current", () => {
    const m = buildServerList(
      base({
        saved: [
          entry({ host: "192.168.16.77", port: 8000, fingerprint: G, label: "Studio" }),
          entry({ host: "b0x7.share.zrok.io", port: 443, fingerprint: H, label: "Build", routes: [https("b0x7.share.zrok.io")] }),
          entry({ host: "192.168.16.204", port: 8000, fingerprint: F, label: "Home" }),
        ],
        current: { host: "192.168.16.204", port: 8000 },
      }),
    );
    expect(m.entries.map((e) => e.pairAction?.kind ?? null)).toEqual(["request-access", "pair-with-code", null]);
  });

  it("Electron: verify-and-request for an advertised server without fingerprint; none when paired", () => {
    const m = buildServerList({
      client: "electron",
      saved: [entry({ host: "192.168.16.204", port: 8000, fingerprint: F, label: "Home" })],
      discovered: [{ host: "nas.local", port: 8000, name: "nas" }],
      electron: { paired: [{ fingerprint: F, label: "Home", state: "paired", host: "192.168.16.204:8000" }], discovered: [] },
    });
    expect(m.entries.map((e) => e.pairAction?.kind ?? null)).toEqual([null, "verify-and-request"]);
  });

  it("Electron: a keyring on-link route offers request access; a lost credential is not 'held'", () => {
    const m = buildServerList({
      client: "electron",
      saved: [entry({ host: "192.168.16.77", port: 8000, fingerprint: G })],
      electron: { paired: [{ fingerprint: G, label: "Studio", state: "needs-pairing", host: "192.168.16.77:8000" }], discovered: [] },
    });
    expect(m.entries[0].pairedState).toBe("needs-pairing");
    expect(m.entries[0].pairAction?.kind).toBe("request-access");
  });
});

describe("a dashboard server older than this change (X18, D6)", () => {
  const legacy = [
    { host: "192.168.16.204", port: 8000, label: "Old", addedAt: "2026-01-01T00:00:00Z", fingerprint: F },
    { host: "box.example.org", port: 443, addedAt: "2026-01-01T00:00:00Z" },
  ] as KnownServerListEntry[];

  it("entries with no routes are pre-routes: one synthesized http route (even on 443) and no https add is offered", () => {
    const m = buildServerList(base({ saved: legacy }));
    expect(m.offerHttpsAdd).toBe(false);
    expect(m.entries.every((e) => e.preRoutes)).toBe(true);
    expect(m.entries[1].routes).toEqual([expect.objectContaining({ host: "box.example.org", port: 443, scheme: "http", source: "saved" })]);
  });

  it("a current server that lists routes (or an empty list) offers the https add", () => {
    expect(buildServerList(base({ saved: [entry({ host: "a.local", port: 8000 })] })).offerHttpsAdd).toBe(true);
    expect(buildServerList(base()).offerHttpsAdd).toBe(true);
  });

  it("movedTo of the primary route is carried through", () => {
    const m = buildServerList(base({ saved: [{ ...legacy[0], movedTo: { host: "new.local", port: 8000 } }] }));
    expect(m.entries[0].movedTo).toEqual({ host: "new.local", port: 8000 });
  });
});
