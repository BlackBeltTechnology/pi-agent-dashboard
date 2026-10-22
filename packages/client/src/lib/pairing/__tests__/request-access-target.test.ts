/**
 * `requestAccessTarget` — the one rule for where "Request access" leads, shared
 * by the network-denied banner and the Vault callout row.
 * See change: add-request-access-remedy (test-plan E17, design D7).
 */
import { describe, expect, it } from "vitest";
import type { PairActionInput } from "../request-access-target.js";
import { buildRequestPageUrl, pairAction, requestAccessTarget } from "../request-access-target.js";

const ORIGIN = "http://192.168.16.31:8000";

describe("E17 requestAccessTarget", () => {
  it.each([
    ["empty base", "", ORIGIN, { href: "/pair?request", newContext: false }],
    ["base equal to the page origin", ORIGIN, ORIGIN, { href: "/pair?request", newContext: false }],
    ["another server", "http://192.168.16.204:8000", ORIGIN, { href: "http://192.168.16.204:8000/pair?request", newContext: true }],
    // The banner never normalised the base; neither does the helper (parity, not a fix).
    ["trailing-slash base", "http://x:8000/", "http://x:8000", { href: "http://x:8000//pair?request", newContext: true }],
  ] as const)("%s", (_l, base, origin, expected) => {
    expect(requestAccessTarget(base, origin)).toEqual(expected);
  });
});

// ── group-servers-by-identity (test-plan #E7, #E8) ───────────────────────────

const F = `sha256:${"A".repeat(43)}`;
const route = (host: string, port: number, scheme: "http" | "https" = "http", extra: Record<string, unknown> = {}) => ({
  host,
  port,
  scheme,
  source: "saved" as const,
  ...extra,
});
const LAN = "192.168.16.77";
const TUNNEL = "b0x7.share.zrok.io";

const act = (over: Partial<PairActionInput>) =>
  pairAction({ client: "browser", routes: [], credentialHeld: false, isCurrent: false, ...over });

describe("E7 pairAction per client", () => {
  it.each([
    ["1 discovered LAN route", [route(LAN, 8000, "http", { discovered: true })], F, "request-access"],
    ["2 saved-only LAN route (not discovered)", [route(LAN, 8000)], F, "request-access"],
    ["3 discovered, no fingerprint", [route(LAN, 8000, "http", { discovered: true })], undefined, "request-access"],
    ["4 only a tunnel route", [route(TUNNEL, 443, "https")], F, "pair-with-code"],
    ["5 LAN + tunnel routes", [route(TUNNEL, 443, "https"), route(LAN, 8000)], F, "request-access"],
    ["6 only a loopback route", [route("127.0.0.1", 8000)], F, "pair-with-code"],
  ] as const)("browser %s → %s", (_l, routes, fingerprint, kind) => {
    const a = act({ client: "browser", routes: [...routes], fingerprint });
    expect(a?.kind).toBe(kind);
    // A browser result is never "verify" (nothing is proven or sent by the current page).
    expect(a?.kind).not.toBe("verify-and-request");
  });

  it("browser request-access carries the round-tripped request URL", () => {
    expect(act({ routes: [route(LAN, 8000)], fingerprint: F })).toMatchObject({ kind: "request-access", url: `http://${LAN}:8000/pair?request` });
  });

  it.each([
    ["7 no fp, discovered on-link", [route(LAN, 8000, "http", { discovered: true })], undefined, "verify-and-request"],
    ["8 fp, discovered on-link", [route(LAN, 8000, "http", { discovered: true })], F, "request-access"],
    ["9 on-link route only in the keyring", [route(LAN, 8000, "http", { inKeyring: true })], F, "request-access"],
    ["10 saved-only on-link, not discovered, not in keyring", [route(LAN, 8000)], F, "pair-with-code"],
    ["11 tunnel only", [route(TUNNEL, 443, "https")], F, "pair-with-code"],
  ] as const)("electron %s → %s", (_l, routes, fingerprint, kind) => {
    expect(act({ client: "electron", routes: [...routes], fingerprint })?.kind).toBe(kind);
  });

  it.each([
    ["12 browser: only a tunnel route", "browser", [route(TUNNEL, 443, "https")]],
    ["12 electron: only a tunnel route", "electron", [route(TUNNEL, 443, "https")]],
    ["13 electron: saved-only on-link, not discovered, not in keyring", "electron", [route(LAN, 8000)]],
    ["13 browser: only an https route", "browser", [route("lab.example.org", 443, "https")]],
  ] as const)("no fingerprint, %s → no action (state text only)", (_l, client, routes) => {
    expect(act({ client, routes: [...routes] })).toBeNull();
  });

  it.each(["browser", "electron"] as const)("%s: a held credential or the current dashboard gets no action", (client) => {
    const routes = [route(LAN, 8000, "http", { discovered: true })];
    expect(act({ client, routes, fingerprint: F, credentialHeld: true })).toBeNull();
    expect(act({ client, routes, fingerprint: F, isCurrent: true })).toBeNull();
  });
});

describe("E8 request page URL must round-trip", () => {
  it.each([
    ["192.168.16.77", 8000, "http://192.168.16.77:8000/pair?request"],
    ["fd12::4", 8000, "http://[fd12::4]:8000/pair?request"],
    ["[fd12::4]", 8000, "http://[fd12::4]:8000/pair?request"],
    ["home-imac.local", 1, "http://home-imac.local:1/pair?request"],
    ["home-imac.local", 65535, "http://home-imac.local:65535/pair?request"],
  ])("%s:%d → %s", (host, port, expected) => {
    expect(buildRequestPageUrl(host, port)).toBe(expected);
  });

  it.each([
    ["evil.example/x?", 8000],
    ["a@b.local", 8000],
    ["host name.local", 8000],
    ["host#f.local", 8000],
    ["home-imac.local", 0],
    ["home-imac.local", 65536],
  ])("%s:%d is refused (no URL, no navigation offered)", (host, port) => {
    expect(buildRequestPageUrl(host, port)).toBeNull();
  });
});
