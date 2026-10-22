/**
 * Pure route model: kind derivation, host normalisation, grouping (D1),
 * best-route ranking (D3), delivered-route validation (D7), pair action (D8)
 * and the request-page URL guard.
 *
 * See change: group-servers-by-identity (test-plan #E1–#E8, #E14).
 */
import { describe, expect, it } from "vitest";
import {
  buildRequestPageUrl,
  classifyRoute,
  groupRoutes,
  normalizeHost,
  type PairActionInput,
  pairAction,
  primaryRoute,
  type Route,
  type RouteKind,
  rankRoutes,
  SIMILAR_LATENCY_MS,
  validateDeliveredRoutes,
} from "../server-routes.js";

const F = "sha256:F";
const G = "sha256:G";

/** `http://host:port` / `https://host[:port]` → classifier input. */
function parse(url: string): { host: string; scheme: "http" | "https" } {
  const u = new URL(url);
  return { host: u.hostname, scheme: u.protocol === "https:" ? "https" : "http" };
}

const http = (host: string, port = 8000, source: Route["source"] = "saved"): Route => ({ host, port, scheme: "http", source });
const https = (host: string, port = 443, source: Route["source"] = "saved"): Route => ({ host, port, scheme: "https", source });

describe("classifyRoute", () => {
  it.each<[string, RouteKind]>([
    ["http://127.0.0.1:8000", "loopback"],
    ["http://localhost:8000", "loopback"],
    ["http://192.168.16.204:8000", "lan"],
    ["http://100.64.1.5:8000", "lan"],
    ["http://[fd12::4]:8000", "lan"],
    ["http://home-imac.local:8000", "mdns"],
    ["https://k3x9.share.zrok.io", "tunnel"],
    ["https://lab.example.org", "public"],
  ])("#E1 typical %s → %s", (url, kind) => {
    expect(classifyRoute(parse(url))).toBe(kind);
  });

  it.each<[string, RouteKind]>([
    ["https://zrok.io", "tunnel"],
    ["https://evilzrok.io", "public"],
    ["https://zrok.io.evil.com", "public"],
    ["http://k3x9.share.zrok.io", "public"],
    ["https://localhost.evil.com", "public"],
    ["http://nas.local.evil.com", "public"],
    ["http://printer", "lan"],
    ["http://nas.home.arpa", "lan"],
    ["http://x.internal", "lan"],
    ["http://printer.lan.example.com", "public"],
    ["https://8.8.8.8", "public"],
  ])("#E1 hostile %s → %s", (url, kind) => {
    expect(classifyRoute(parse(url))).toBe(kind);
  });

  it.each([
    ["172.15.255.255", "public"],
    ["172.16.0.0", "lan"],
    ["172.31.255.255", "lan"],
    ["172.32.0.0", "public"],
    ["100.63.255.255", "public"],
    ["100.64.0.0", "lan"],
    ["100.127.255.255", "lan"],
    ["100.128.0.0", "public"],
    ["169.253.255.255", "public"],
    ["169.254.0.0", "lan"],
    ["10.0.0.1", "lan"],
    ["192.168.0.1", "lan"],
    ["192.169.0.1", "public"],
    ["fbff::1", "public"],
    ["fc00::1", "lan"],
    ["fdff::1", "lan"],
    ["fe00::1", "public"],
    ["fe7f::1", "public"],
    ["fe80::1", "lan"],
    ["febf::1", "lan"],
    ["fec0::1", "public"],
    ["::1", "loopback"],
    ["127.255.0.1", "loopback"],
  ])("#E2 range edge %s → %s", (host, kind) => {
    expect(classifyRoute({ host, scheme: "http" })).toBe(kind);
  });

  it.each<[string, RouteKind]>([
    ["LOCALHOST", "loopback"],
    ["localhost.", "loopback"],
    ["Home-iMac.LOCAL", "mdns"],
    ["[::ffff:192.168.16.5]", "lan"],
    ["::ffff:c0a8:1005", "lan"],
    ["::ffff:127.0.0.1", "loopback"],
    ["fe80::1%en0", "lan"],
    ["[fe80::1%en0]", "lan"],
  ])("#E14 host spelling %s → %s", (host, kind) => {
    expect(classifyRoute({ host, scheme: "http" })).toBe(kind);
  });

  it("an empty host is public (never a privileged kind)", () => {
    expect(classifyRoute({ host: "", scheme: "http" })).toBe("public");
  });
});

describe("normalizeHost (#E14)", () => {
  it.each([
    ["Home-iMac.LOCAL", "home-imac.local"],
    ["home-imac.local.", "home-imac.local"],
    ["localhost..", "localhost."],
    ["[FD12::4]", "fd12::4"],
    ["fe80::1%en0", "fe80::1"],
    ["[::ffff:192.168.16.5]", "192.168.16.5"],
    ["::ffff:c0a8:1005", "192.168.16.5"],
    ["  Lab.Example.org ", "lab.example.org"],
    ["192.168.16.5", "192.168.16.5"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
  });
});

describe("groupRoutes (D1)", () => {
  const entry = (fingerprint: string | undefined, ...routes: Route[]) => ({ fingerprint, routes });
  /** `null` = the route proved / advertised no fingerprint. */
  const proven = (route: Route, fingerprint: string | null = F) => ({ route, fingerprint: fingerprint ?? undefined });

  it("#E3(a) an https route joins the FIRST entry in stored order, not the other", () => {
    const out = groupRoutes([entry(F, http("a", 9000)), entry(F, http("a", 8000))], [proven(https("lab.example.org"))]);
    expect(out).toHaveLength(2);
    expect(out[0].routes.map((r) => r.host)).toEqual(["a", "lab.example.org"]);
    expect(out[1].routes.map((r) => r.host)).toEqual(["a"]);
  });

  it("#E3(g) reversed stored order → the https route now attaches to the :8000 entry (order decides, not port)", () => {
    const out = groupRoutes([entry(F, http("a", 8000)), entry(F, http("a", 9000))], [proven(https("lab.example.org"))]);
    expect(out[0].routes.map((r) => r.scheme)).toEqual(["http", "https"]);
    expect(out[1].routes.map((r) => r.scheme)).toEqual(["http"]);
  });

  it("#E3(b) an https route with no entry holding F starts a new entry", () => {
    const out = groupRoutes([entry(G, http("a", 8000))], [proven(https("lab.example.org"))]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ fingerprint: F, routes: [{ host: "lab.example.org", scheme: "https" }] });
  });

  it("#E3(c) an http route joins an entry that holds only an https route", () => {
    const out = groupRoutes([entry(F, https("lab.example.org"))], [proven(http("192.168.16.9", 8000))]);
    expect(out).toHaveLength(1);
    expect(out[0].routes.map((r) => r.scheme)).toEqual(["https", "http"]);
  });

  it("#E3(d) an http route on the entry's http port joins without a duplicate route", () => {
    const out = groupRoutes([entry(F, http("a", 8000))], [proven(http("a", 8000, "mdns")), proven(http("b", 8000, "mdns"))]);
    expect(out).toHaveLength(1);
    expect(out[0].routes.map((r) => [r.host, r.source])).toEqual([
      ["a", "saved"],
      ["b", "mdns"],
    ]);
  });

  it("#E3(e) an http route on another port starts a second entry; both are flagged same identity", () => {
    const out = groupRoutes([entry(F, http("a", 8000))], [proven(http("a", 9000, "mdns"))]);
    expect(out).toHaveLength(2);
    expect(out[0].sameIdentityAs).toEqual([1]);
    expect(out[1].sameIdentityAs).toEqual([0]);
    expect(out.every((e) => e.identityAdvertised)).toBe(true);
  });

  it("#E3(f) a route with no fingerprint is a single-route entry, identity not advertised", () => {
    const out = groupRoutes([entry(F, http("a", 8000))], [proven(http("b", 8000, "mdns"), null)]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ routes: [{ host: "b" }], identityAdvertised: false, sameIdentityAs: [] });
    expect(out[1].fingerprint).toBeUndefined();
  });

  it("a fingerprint-less route that equals an existing route is that route, not a new entry", () => {
    const out = groupRoutes([entry(F, http("a", 8000))], [proven(http("A.", 8000, "mdns"), null)]);
    expect(out).toHaveLength(1);
    expect(out[0].routes).toHaveLength(1);
  });

  it("#E14 two spellings of one host are one route in one entry", () => {
    const out = groupRoutes([], [proven(http("Home-iMac.LOCAL", 8000, "mdns")), proven(http("home-imac.local.", 8000, "mdns"))]);
    expect(out).toHaveLength(1);
    expect(out[0].routes).toHaveLength(1);
    expect(out[0].routes[0].host).toBe("Home-iMac.LOCAL");
  });

  it("three addresses of one server prove F and show as one entry", () => {
    const out = groupRoutes(
      [entry(F, http("192.168.16.204", 8000))],
      [proven(http("home-imac.local", 8000, "mdns")), proven(https("h0me1mac.share.zrok.io", 443, "pairing"))],
    );
    expect(out).toHaveLength(1);
    expect(out[0].routes).toHaveLength(3);
  });

  it("records the input index of an existing entry and leaves new entries without one", () => {
    const out = groupRoutes([entry(F, http("a", 8000)), entry(G, http("b", 8000))], [proven(http("c", 9000, "mdns"), "sha256:H")]);
    expect(out.map((e) => e.sourceIndex)).toEqual([0, 1, undefined]);
  });

  it("never mutates its inputs", () => {
    const entries = [entry(F, http("a", 8000))];
    groupRoutes(entries, [proven(https("lab.example.org"))]);
    expect(entries[0].routes).toHaveLength(1);
  });
});

describe("rankRoutes (D3)", () => {
  const p = (route: Route, latencyMs: number, extra: { discovered?: boolean } = {}) => ({ ...route, proven: true, latencyMs, ...extra });
  const refused = (route: Route) => ({ ...route, proven: false });

  it("exposes the named constant", () => {
    expect(SIMILAR_LATENCY_MS).toBe(50);
  });

  it.each([
    [53, "https"],
    [54, "https"],
    [55, "http"],
  ])("#E4 http 4 ms vs https at %i ms → %s (50 ms window inclusive)", (httpsMs, winner) => {
    const lan = p(http("192.168.16.204"), 4);
    const tls = p(https("lab.example.org"), httpsMs);
    expect(rankRoutes([lan, tls], { credentialed: false })?.scheme).toBe(winner);
  });

  it("#E4 https 118 ms vs http 4 ms → http", () => {
    expect(rankRoutes([p(https("h0me1mac.share.zrok.io"), 118), p(http("192.168.16.204"), 4)], { credentialed: false })?.scheme).toBe("http");
  });

  it("#E4 https 40 ms vs http 70 ms → https (it is also the faster one)", () => {
    expect(rankRoutes([p(http("192.168.16.204"), 70), p(https("lab.example.org"), 40)], { credentialed: false })?.scheme).toBe("https");
  });

  it("#E4 the window is measured against the FASTEST http route and the fastest https route wins", () => {
    const best = rankRoutes(
      [p(http("a"), 30), p(http("b"), 4), p(https("slow.example"), 90), p(https("fast.example"), 50)],
      { credentialed: false },
    );
    expect(best?.host).toBe("fast.example");
  });

  it("#E4 a refused route is never returned; all refused → null", () => {
    const only = rankRoutes([refused(https("a.example")), p(http("b"), 400)], { credentialed: false });
    expect(only?.host).toBe("b");
    expect(rankRoutes([refused(https("a.example")), refused(http("b"))], { credentialed: false })).toBeNull();
    expect(rankRoutes([], { credentialed: false })).toBeNull();
  });

  it("returns the caller's own object (extras survive)", () => {
    const route = { ...p(http("a"), 4), tag: "x" };
    expect(rankRoutes([route], { credentialed: false })).toBe(route);
  });

  it("an unmeasured route ranks behind any measured route of its scheme", () => {
    const best = rankRoutes([{ ...http("a"), proven: true }, p(http("b"), 900)], { credentialed: false });
    expect(best?.host).toBe("b");
  });

  describe("credentialed — never downgrade the bearer (#E5)", () => {
    it("stored https 130 ms beats stored http 3 ms", () => {
      expect(rankRoutes([p(http("a"), 3), p(https("lab.example.org"), 130)], { credentialed: true })?.scheme).toBe("https");
    });

    it("stored http: the first in input order (newer) wins over an older, faster one", () => {
      const best = rankRoutes([p(http("newer"), 90), p(http("older"), 2)], { credentialed: true });
      expect(best?.host).toBe("newer");
    });

    it("stored beats discovered even when the discovered route is faster", () => {
      const best = rankRoutes([p(http("disc"), 1, { discovered: true }), p(http("stored"), 80)], { credentialed: true });
      expect(best?.host).toBe("stored");
    });

    it("a refused stored https is skipped; the proven stored http wins", () => {
      const best = rankRoutes([refused(https("g.example")), p(http("a"), 50)], { credentialed: true });
      expect(best?.host).toBe("a");
    });

    it("a discovered route is used only when no stored route proves", () => {
      const best = rankRoutes([refused(http("stored")), p(http("disc"), 5, { discovered: true })], { credentialed: true });
      expect(best?.host).toBe("disc");
    });

    it("order is stored https, stored http, discovered — latency never consulted", () => {
      const routes = [
        p(http("disc", 8000), 1, { discovered: true }),
        p(http("h2", 8000), 2),
        p(https("t1.example"), 500),
        p(http("h1", 8000), 3),
      ];
      const picks: string[] = [];
      let remaining = routes.slice();
      while (remaining.length) {
        const best = rankRoutes(remaining, { credentialed: true });
        if (!best) break;
        picks.push(best.host);
        remaining = remaining.filter((r) => r !== best);
      }
      expect(picks).toEqual(["t1.example", "h2", "h1", "disc"]);
    });

    it("all refused → null", () => {
      expect(rankRoutes([refused(https("a.example"))], { credentialed: true })).toBeNull();
    });
  });
});

describe("validateDeliveredRoutes (D7)", () => {
  const host253 = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(58)}.io`;
  const host254 = `x${host253}`;

  it("host fixtures have the stated lengths", () => {
    expect(host253).toHaveLength(253);
    expect(host254).toHaveLength(254);
  });

  it("#E6 a valid zrok origin passes", () => {
    expect(validateDeliveredRoutes(["https://k3x9p2.share.zrok.io"])).toEqual(["https://k3x9p2.share.zrok.io"]);
  });

  it.each([
    ["IPv4 literal", "https://10.0.0.5"],
    ["IPv6 literal", "https://[fd12::4]"],
    ["localhost", "https://localhost"],
    ["localhost with dot", "https://localhost."],
    [".local name", "https://printer.local"],
    ["userinfo", "https://user:pw@host.example"],
    ["path", "https://host.example/path"],
    ["query", "https://host.example?a=1"],
    ["fragment", "https://host.example#x"],
    ["http scheme", "http://host.example"],
    ["wss scheme", "wss://host.example"],
    ["254-char host", `https://${host254}`],
    ["empty", ""],
    ["not a url", "host.example"],
    ["non-string", 42],
    ["null", null],
    ["space in host", "https://host name.example"],
    ["double slash path", "https://host.example//"],
  ])("#E6 drops %s", (_label, input) => {
    expect(validateDeliveredRoutes([input])).toEqual([]);
  });

  it("#E6 a 253-char host passes", () => {
    expect(validateDeliveredRoutes([`https://${host253}`])).toEqual([`https://${host253}`]);
  });

  it("#E6 the bare trailing-slash origin is accepted and normalised", () => {
    expect(validateDeliveredRoutes(["https://host.example/"])).toEqual(["https://host.example"]);
  });

  it("an explicit port is part of the origin; the default https port is dropped", () => {
    expect(validateDeliveredRoutes(["https://host.example:8443", "https://host2.example:443"])).toEqual([
      "https://host.example:8443",
      "https://host2.example",
    ]);
  });

  it("host case is normalised", () => {
    expect(validateDeliveredRoutes(["https://Host.Example"])).toEqual(["https://host.example"]);
  });

  it("#E6 exactly 8 valid routes pass; 9 → the first 8 in delivery order", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `https://h${i}.example`);
    expect(validateDeliveredRoutes(nine.slice(0, 8))).toEqual(nine.slice(0, 8));
    expect(validateDeliveredRoutes(nine)).toEqual(nine.slice(0, 8));
  });

  it("#E6 9 valid with the first written with a trailing slash → first 8, first normalised, invalid ones not counted", () => {
    const list = [
      "https://k3x9p2.share.zrok.io/",
      "https://host.example?a=1",
      "https://host.example#x",
      ...Array.from({ length: 8 }, (_, i) => `https://h${i}.example`),
    ];
    const out = validateDeliveredRoutes(list);
    expect(out).toHaveLength(8);
    expect(out[0]).toBe("https://k3x9p2.share.zrok.io");
    expect(out[7]).toBe("https://h6.example");
  });

  it("a repeated origin is kept once", () => {
    expect(validateDeliveredRoutes(["https://a.example", "https://a.example/", "https://A.example"])).toEqual(["https://a.example"]);
  });

  it("a non-array yields nothing", () => {
    expect(validateDeliveredRoutes(undefined)).toEqual([]);
    expect(validateDeliveredRoutes("https://a.example")).toEqual([]);
    expect(validateDeliveredRoutes({ 0: "https://a.example" })).toEqual([]);
  });
});

describe("buildRequestPageUrl (#E8)", () => {
  it.each([
    ["192.168.16.77", 8000, "http://192.168.16.77:8000/pair?request"],
    ["fd12::4", 8000, "http://[fd12::4]:8000/pair?request"],
    ["[fd12::4]", 8000, "http://[fd12::4]:8000/pair?request"],
    ["home-imac.local", 1, "http://home-imac.local:1/pair?request"],
    ["home-imac.local", 65535, "http://home-imac.local:65535/pair?request"],
    ["home-imac.local", 80, "http://home-imac.local:80/pair?request"],
  ])("%s:%i → %s", (host, port, expected) => {
    expect(buildRequestPageUrl(host, port)).toBe(expected);
  });

  it.each([
    ["evil.example/x?", 8000],
    ["a@b.local", 8000],
    ["host name.local", 8000],
    ["host#f.local", 8000],
    ["host?x.local", 8000],
    ["user:pw@host.local", 8000],
    ["home-imac.local", 0],
    ["home-imac.local", 65536],
    ["home-imac.local", -1],
    ["home-imac.local", 80.5],
    ["home-imac.local", Number.NaN],
    ["", 8000],
    ["fe80::1%en0", 8000],
    ["0x7f.1", 8000],
  ])("refuses %s:%s", (host, port) => {
    expect(buildRequestPageUrl(host, port)).toBeNull();
  });
});

describe("pairAction (D8)", () => {
  const LAN = http("192.168.16.77", 8000);
  const TUNNEL = https("b0x7.share.zrok.io");
  const base: Omit<PairActionInput, "client" | "routes"> = { fingerprint: F, credentialHeld: false, isCurrent: false };
  const act = (input: Partial<PairActionInput> & Pick<PairActionInput, "client" | "routes">) => pairAction({ ...base, ...input });
  const kindOf = (a: ReturnType<typeof pairAction>) => a?.kind ?? null;

  describe("browser", () => {
    it("#E7(1) discovered on-link route → Request access with the peer's own request page", () => {
      const a = act({ client: "browser", routes: [{ ...LAN, source: "mdns", discovered: true }] });
      expect(a).toMatchObject({ kind: "request-access", url: "http://192.168.16.77:8000/pair?request" });
    });

    it("#E7(2) saved-only on-link route (not discovered) → Request access", () => {
      expect(kindOf(act({ client: "browser", routes: [LAN] }))).toBe("request-access");
    });

    it("#E7(3) discovered, no fingerprint → Request access, never verify", () => {
      const a = act({ client: "browser", fingerprint: undefined, routes: [{ ...LAN, source: "mdns", discovered: true }] });
      expect(kindOf(a)).toBe("request-access");
    });

    it("#E7(4) only a tunnel → Pair with code", () => {
      expect(kindOf(act({ client: "browser", routes: [TUNNEL] }))).toBe("pair-with-code");
    });

    it("#E7(5) lan + tunnel → Request access", () => {
      expect(kindOf(act({ client: "browser", routes: [TUNNEL, LAN] }))).toBe("request-access");
    });

    it("#E7(6) only a loopback route → Pair with code", () => {
      expect(kindOf(act({ client: "browser", routes: [http("127.0.0.1", 8000)] }))).toBe("pair-with-code");
    });

    it("#E7(12) no fingerprint and only an https route → no action", () => {
      expect(act({ client: "browser", fingerprint: undefined, routes: [TUNNEL] })).toBeNull();
    });

    it("#E7 a browser result is never verify, whatever the routes", () => {
      for (const routes of [[LAN], [TUNNEL], [LAN, TUNNEL], [{ ...LAN, discovered: true }]]) {
        for (const fingerprint of [undefined, F]) {
          expect(kindOf(act({ client: "browser", fingerprint, routes }))).not.toBe("verify-and-request");
        }
      }
    });

    it("an on-link host that does not round-trip is not offered a knock; falls back to the code", () => {
      const hostile = http("evil.example/x?", 8000);
      const sneaky = http("a@b.local", 8000);
      expect(kindOf(act({ client: "browser", routes: [hostile] }))).toBe("pair-with-code");
      expect(kindOf(act({ client: "browser", routes: [sneaky] }))).toBe("pair-with-code");
      expect(act({ client: "browser", fingerprint: undefined, routes: [sneaky] })).toBeNull();
    });

    it("prefers a discovered on-link route over a saved one", () => {
      const a = act({ client: "browser", routes: [http("192.168.16.50", 8000), { ...http("192.168.16.77", 8000), discovered: true }] });
      expect(a).toMatchObject({ kind: "request-access", route: { host: "192.168.16.77" } });
    });

    it("no action when a credential is held or the entry is the current dashboard", () => {
      expect(act({ client: "browser", routes: [LAN], credentialHeld: true })).toBeNull();
      expect(act({ client: "browser", routes: [LAN], isCurrent: true })).toBeNull();
    });
  });

  describe("electron", () => {
    it("#E7(7) no fingerprint + discovered on-link → Verify and request access", () => {
      const a = act({ client: "electron", fingerprint: undefined, routes: [{ ...LAN, source: "mdns", discovered: true }] });
      expect(a).toMatchObject({ kind: "verify-and-request", route: { host: "192.168.16.77", port: 8000 } });
    });

    it("#E7(8) fingerprint + discovered on-link → Request access", () => {
      const a = act({ client: "electron", routes: [{ ...LAN, source: "mdns", discovered: true }] });
      expect(a).toMatchObject({ kind: "request-access", route: { host: "192.168.16.77", port: 8000 } });
    });

    it("#E7(9) on-link route only in the keyring → Request access", () => {
      expect(kindOf(act({ client: "electron", routes: [{ ...LAN, inKeyring: true }] }))).toBe("request-access");
    });

    it("#E7(10) saved-only on-link, neither discovered nor in the keyring → Pair with code", () => {
      expect(kindOf(act({ client: "electron", routes: [LAN] }))).toBe("pair-with-code");
    });

    it("#E7(11) tunnel only → Pair with code", () => {
      expect(kindOf(act({ client: "electron", routes: [TUNNEL] }))).toBe("pair-with-code");
    });

    it("#E7(12) no fingerprint + only a tunnel → no action", () => {
      expect(act({ client: "electron", fingerprint: undefined, routes: [TUNNEL] })).toBeNull();
    });

    it("#E7(13) no fingerprint + saved-only on-link not discovered / not in keyring → no action", () => {
      expect(act({ client: "electron", fingerprint: undefined, routes: [LAN] })).toBeNull();
    });

    it("no fingerprint + on-link route only in the keyring → Request access (verify needs a discovered route)", () => {
      expect(kindOf(act({ client: "electron", fingerprint: undefined, routes: [{ ...LAN, inKeyring: true }] }))).toBe("request-access");
    });

    it("an on-link route is http only: a discovered https lan name is not a knock target", () => {
      const a = act({ client: "electron", routes: [{ ...https("nas.home.arpa"), discovered: true }] });
      expect(kindOf(a)).toBe("pair-with-code");
    });

    it("no action when a credential is held or the entry is the current dashboard", () => {
      expect(act({ client: "electron", routes: [{ ...LAN, discovered: true }], credentialHeld: true })).toBeNull();
      expect(act({ client: "electron", routes: [{ ...LAN, discovered: true }], isCurrent: true })).toBeNull();
    });
  });
});

describe("primaryRoute", () => {
  it("is the first http route, else the first route", () => {
    expect(primaryRoute([https("a.example"), http("b")])?.host).toBe("b");
    expect(primaryRoute([https("a.example"), https("c.example")])?.host).toBe("a.example");
    expect(primaryRoute([])).toBeUndefined();
  });
});
