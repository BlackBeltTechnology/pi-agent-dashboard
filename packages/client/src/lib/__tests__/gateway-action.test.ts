/**
 * The "add a gateway URL" action (D12/D13).
 *
 * Test plan rows: G13, G14, G15, G16, G17, G18, G19, G20, G21.
 * Change: config-override-oauth-redirect-base.
 */
import { describe, expect, it } from "vitest";
import type { GatewayRecord } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import {
  buildGatewayAddPatch,
  buildGatewayFixPatch,
  buildGatewayModeOffer,
  buildGatewayRemovePatch,
  computeGatewayStatus,
  isUnregisteredGatewayUrl,
  validateGatewayDraft,
  type GatewayConfigShape,
} from "../gateway/gateway-action.js";
import { suggestTrustEntries } from "../gateway/gateway-config-ops.js";

const HTTPS = "https://pi.example.com";
const HTTP = "http://10.4.0.9:8000";

// #G13 — the full scheme × modes matrix. Each refusal has a different owner
// (pairing's TLS gate, the OAuth provider, reachability), so none of them may
// be inferred silently.
describe("G13: scheme drives eligibility", () => {
  const rows: Array<{ url: string; modes: any[]; tn?: string[]; ok: boolean; code?: string }> = [
    { url: HTTPS, modes: ["oauth"], ok: true },
    { url: HTTPS, modes: ["pairing"], ok: true },
    { url: HTTPS, modes: ["trusted-network"], tn: ["10.4.0.9/32"], ok: true },
    { url: HTTPS, modes: ["oauth", "pairing"], ok: true },
    { url: HTTPS, modes: [], ok: false, code: "no-auth-mode" },
    { url: HTTP, modes: ["trusted-network"], tn: ["10.4.0.9/32"], ok: true },
    { url: HTTP, modes: ["pairing", "trusted-network"], tn: ["10.4.0.9/32"], ok: false, code: "insecure-pairing" },
    { url: HTTP, modes: ["oauth", "trusted-network"], tn: ["10.4.0.9/32"], ok: false, code: "insecure-oauth" },
    { url: HTTP, modes: ["pairing"], ok: false, code: "insecure-needs-trusted-network" },
    { url: HTTP, modes: ["trusted-network"], tn: [], ok: false, code: "trusted-network-empty" },
    { url: "not a url", modes: ["oauth"], ok: false, code: "url-invalid" },
    { url: "ftp://pi.example.com", modes: ["oauth"], ok: false, code: "url-invalid" },
  ];

  for (const row of rows) {
    it(`${row.url} + [${row.modes.join(",")}] → ${row.ok ? "accepted" : row.code}`, () => {
      const v = validateGatewayDraft({ url: row.url, authModes: row.modes, trustedNetworks: row.tn });
      expect(v.ok).toBe(row.ok);
      if (row.code) expect(v.errors).toContain(row.code);
    });
  }
});

// #G14 — one write, every key, or nothing. Atomicity is structural here: the
// action produces a single patch object, so a partially-configured gateway is
// not representable.
describe("G14: add writes every key in ONE patch", () => {
  it("covers publicBaseUrls, cors, redirect base and the provenance record", () => {
    const patch = buildGatewayAddPatch({}, { url: HTTPS, authModes: ["oauth", "pairing"] }) as any;
    expect(patch.publicBaseUrls).toEqual([HTTPS]);
    expect(patch.cors.allowedOrigins).toEqual([HTTPS]);
    expect(patch.auth).toEqual({ redirectBaseUrl: HTTPS });
    expect(patch.gateways).toHaveLength(1);
    expect(patch.gateways[0]).toEqual({
      url: HTTPS,
      authModes: ["oauth", "pairing"],
      wrote: {
        publicBaseUrls: [HTTPS],
        corsAllowedOrigins: [HTTPS],
        authRedirectBaseUrl: HTTPS,
      },
    });
  });

  it("omits the redirect base when OAuth was not selected", () => {
    const patch = buildGatewayAddPatch({}, { url: HTTPS, authModes: ["pairing"] }) as any;
    expect(patch.auth).toBeUndefined();
    expect(patch.gateways[0].wrote.authRedirectBaseUrl).toBeUndefined();
  });

  it("writes trustedNetworks only for the trusted-network mode", () => {
    const patch = buildGatewayAddPatch(
      { trustedNetworks: ["127.0.0.1"] },
      { url: HTTP, authModes: ["trusted-network"], trustedNetworks: ["10.4.0.9/32"] },
    ) as any;
    expect(patch.trustedNetworks).toEqual(["127.0.0.1", "10.4.0.9/32"]);
    expect(patch.gateways[0].wrote.trustedNetworks).toEqual(["10.4.0.9/32"]);
  });

  it("refuses to build a patch for an invalid draft", () => {
    expect(() => buildGatewayAddPatch({}, { url: HTTP, authModes: ["oauth"] })).toThrow(/invalid/i);
  });
});

// #G15 — the first top-level write must seed from the legacy key, else the
// operator's existing "Add HTTPS URL" entries vanish from the QR and
// "Accessible at" the moment `publicBaseUrls` appears at top level.
describe("G15: first add seeds the top-level list from the legacy key", () => {
  it("keeps the legacy entries alongside the new gateway", () => {
    const config: GatewayConfigShape = { pairing: { publicBaseUrls: ["https://old.example"] } };
    const patch = buildGatewayAddPatch(config, { url: HTTPS, authModes: ["pairing"] }) as any;
    expect(patch.publicBaseUrls).toEqual(["https://old.example", HTTPS]);
  });
});

// #G16 — removal reverses only what add recorded; a hand-authored sibling in
// the same list survives.
describe("G16: remove leaves operator-authored values alone", () => {
  const added = buildGatewayAddPatch({}, { url: HTTPS, authModes: ["oauth"] }) as any;
  const live: GatewayConfigShape = {
    publicBaseUrls: added.publicBaseUrls,
    cors: { allowedOrigins: [...added.cors.allowedOrigins, "https://mine.example"] },
    auth: { redirectBaseUrl: HTTPS },
    gateways: added.gateways,
  };

  it("removes the recorded cors origin and keeps the hand-added one", () => {
    const patch = buildGatewayRemovePatch(live, HTTPS) as any;
    expect(patch.cors.allowedOrigins).toEqual(["https://mine.example"]);
    expect(patch.publicBaseUrls).toEqual([]);
    expect(patch.gateways).toEqual([]);
  });

  it("does not touch a redirect base that has since been changed", () => {
    const drifted = { ...live, auth: { redirectBaseUrl: "https://someone-else.example" } };
    const patch = buildGatewayRemovePatch(drifted, HTTPS) as any;
    expect(patch.auth).toBeUndefined();
  });
});

// #G17 — the documented limit of provenance: identical values are
// indistinguishable by authorship, so removal DOES clear an operator's
// hand-set redirect base. Surfaced in both dialogs rather than guessed.
describe("G17: identical-value authorship is not recoverable", () => {
  it("clears a redirect base the operator had already set to the same URL", () => {
    const added = buildGatewayAddPatch({ auth: { redirectBaseUrl: HTTPS } }, {
      url: HTTPS,
      authModes: ["oauth"],
    }) as any;
    const live: GatewayConfigShape = {
      publicBaseUrls: added.publicBaseUrls,
      cors: added.cors,
      auth: { redirectBaseUrl: HTTPS },
      gateways: added.gateways,
    };
    const patch = buildGatewayRemovePatch(live, HTTPS) as any;
    expect(patch.auth).toEqual({ redirectBaseUrl: "" });
  });
});

// #G18 — the CIDR prefill reuses the existing suggestion rule (/32 default),
// rather than inventing a second one that could hand the operator a /8.
describe("G18: trusted-network prefill is an exact /32", () => {
  it("suggests the exact host first for an http gateway address", () => {
    const host = new URL(HTTP).hostname;
    const suggestions = suggestTrustEntries(host);
    expect(suggestions[0]).toMatchObject({ value: host, wide: false });
    expect(suggestions.every((s) => !s.wide || s.value !== host)).toBe(true);
  });
});

// #G19 / #G21 — status is computed on read against the EFFECTIVE runtime merge.
describe("G19/G21: computed status reflects live config", () => {
  const record: GatewayRecord = {
    url: HTTPS,
    authModes: ["oauth", "trusted-network"],
    wrote: {
      publicBaseUrls: [HTTPS],
      corsAllowedOrigins: [HTTPS],
      authRedirectBaseUrl: HTTPS,
      trustedNetworks: ["10.4.0.0/24"],
    },
  };
  const healthy: GatewayConfigShape = {
    publicBaseUrls: [HTTPS],
    cors: { allowedOrigins: [HTTPS] },
    auth: { redirectBaseUrl: HTTPS },
    trustedNetworks: ["10.4.0.0/24"],
    gateways: [record],
  };

  it("OK when every recorded value is present", () => {
    expect(computeGatewayStatus(healthy, record).status).toBe("ok");
  });

  it("Incomplete when a recorded value went missing", () => {
    const drifted = { ...healthy, cors: { allowedOrigins: [] } };
    const result = computeGatewayStatus(drifted, record);
    expect(result.status).toBe("incomplete");
    expect(result.missing.corsAllowedOrigins).toEqual([HTTPS]);
  });

  it("Conflicting when another value holds the redirect base, naming the holder", () => {
    const drifted = { ...healthy, auth: { redirectBaseUrl: "https://other.example" } };
    const result = computeGatewayStatus(drifted, record);
    expect(result.status).toBe("conflicting");
    expect(result.conflictHolder).toBe("https://other.example");
  });

  it("Ineligible when the recorded modes are no longer legal for the URL", () => {
    const httpRecord: GatewayRecord = { ...record, url: HTTP };
    const config = { ...healthy, gateways: [httpRecord] };
    expect(computeGatewayStatus(config, httpRecord).status).toBe("ineligible");
  });

  // #G21 — the Settings editor writes `auth.bypassHosts` while this action
  // writes top-level `trustedNetworks`. Reading only the recorded key would let
  // the OTHER key change with no status change, and Fix would "succeed" while
  // the gateway stayed broken.
  it("counts a trusted network held under either key as present", () => {
    const viaBypassHosts: GatewayConfigShape = {
      ...healthy,
      trustedNetworks: [],
      auth: { redirectBaseUrl: HTTPS, bypassHosts: ["10.4.0.0/24"] },
    };
    expect(computeGatewayStatus(viaBypassHosts, record).status).toBe("ok");
  });
});

// #G20 — Fix is reconcile-to-record, not re-run-add.
describe("G20: Fix writes exactly the delta", () => {
  const record: GatewayRecord = {
    url: HTTPS,
    authModes: ["pairing"],
    wrote: { publicBaseUrls: [HTTPS], corsAllowedOrigins: [HTTPS] },
  };

  it("restores only the missing value and does not duplicate the list", () => {
    const drifted: GatewayConfigShape = {
      publicBaseUrls: [HTTPS, "https://other.example"],
      cors: { allowedOrigins: [] },
      gateways: [record],
    };
    const patch = buildGatewayFixPatch(drifted, record) as any;
    expect(patch.cors.allowedOrigins).toEqual([HTTPS]);
    expect(patch.publicBaseUrls).toBeUndefined();
  });

  it("is an empty patch for a healthy gateway", () => {
    const healthy: GatewayConfigShape = {
      publicBaseUrls: [HTTPS],
      cors: { allowedOrigins: [HTTPS] },
      gateways: [record],
    };
    expect(buildGatewayFixPatch(healthy, record)).toEqual({});
  });
});

/**
 * Offering a live tunnel URL as a gateway — folded from test-plan.md
 * (add-zrok-custom-reserved-name): E18, E19, plus 9.3a/9.3b/9.4.
 *
 * The offer is automatic; the DECISION is not. The auth mode cannot be inferred
 * from a URL, and the sharp case is `oauth` on a non-primary: it writes
 * `auth.redirectBaseUrl`, the single value `resolveRedirectBase()` returns, so
 * an unguarded offer would move the sign-in origin off the primary through a
 * path that bypasses the primary-switch confirmation.
 */
describe("gateway mode offer (E18/E19)", () => {
  const MESH = "http://10.147.20.4:8000";
  const ZROK = "https://x.shares.zrok.io";
  const modeOf = (offers: ReturnType<typeof buildGatewayModeOffer>, m: string) =>
    offers.find((o) => o.mode === m)!;

  it("E18: on an http mesh IP, pairing and oauth are unavailable WITH reasons", () => {
    const offers = buildGatewayModeOffer({ url: MESH, isPrimary: true });
    expect(modeOf(offers, "pairing").available).toBe(false);
    expect(modeOf(offers, "pairing").reason).toMatch(/TLS/i);
    expect(modeOf(offers, "oauth").available).toBe(false);
    expect(modeOf(offers, "oauth").reason).toMatch(/TLS/i);
  });

  it("E18: trusted-network is the only option on http, and it requires a CIDR", () => {
    const offers = buildGatewayModeOffer({ url: MESH, isPrimary: true });
    expect(modeOf(offers, "trusted-network").available).toBe(true);
    expect(modeOf(offers, "trusted-network").requires).toBe("cidr");
  });

  it("9.3: an ineligible mode is returned disabled-with-reason, never omitted", () => {
    // Hiding it leaves the operator unable to tell "not allowed" from "not
    // implemented".
    const offers = buildGatewayModeOffer({ url: MESH, isPrimary: true });
    expect(offers.map((o) => o.mode).sort()).toEqual(["oauth", "pairing", "trusted-network"]);
    for (const o of offers) {
      if (!o.available) expect(o.reason, o.mode).toBeTruthy();
    }
  });

  it("E19: oauth is UNAVAILABLE for a non-primary https URL, citing the sign-in origin", () => {
    const offers = buildGatewayModeOffer({ url: ZROK, isPrimary: false });
    const oauth = modeOf(offers, "oauth");
    expect(oauth.available).toBe(false);
    expect(oauth.reason).toMatch(/primary/i);
    expect(oauth.reason).toMatch(/sign-in origin/i);
    // The other two are unaffected — non-primacy is an OAuth constraint only.
    expect(modeOf(offers, "pairing").available).toBe(true);
    expect(modeOf(offers, "trusted-network").available).toBe(true);
  });

  it("oauth IS available on the primary's https URL", () => {
    expect(modeOf(buildGatewayModeOffer({ url: ZROK, isPrimary: true }), "oauth").available).toBe(true);
  });

  it("9.3a: a non-primary registration leaves auth.redirectBaseUrl unwritten", () => {
    // The guard above is the offer; this is the write path proving the
    // consequence it exists to prevent.
    const patch = buildGatewayAddPatch(
      { gateways: [] },
      { url: ZROK, authModes: ["pairing"] },
    );
    expect(patch.auth).toBeUndefined();
  });

  it("9.3b: registering with only trusted-network/pairing never touches auth.redirectBaseUrl", () => {
    const patch = buildGatewayAddPatch(
      { gateways: [] },
      { url: ZROK, authModes: ["trusted-network", "pairing"], trustedNetworks: ["10.0.0.0/8"] },
    );
    expect(patch.auth).toBeUndefined();
    expect(patch.trustedNetworks).toEqual(["10.0.0.0/8"]);
  });

  it("9.4: no gateway record is ever created without an explicit auth-mode choice", () => {
    expect(() => buildGatewayAddPatch({ gateways: [] }, { url: ZROK, authModes: [] })).toThrow();
    expect(validateGatewayDraft({ url: ZROK, authModes: [] }).errors).toContain("no-auth-mode");
  });

  it("an unparseable URL offers nothing, rather than defaulting to something", () => {
    const offers = buildGatewayModeOffer({ url: "not a url", isPrimary: true });
    expect(offers.every((o) => !o.available)).toBe(true);
  });
});

describe("F8: the offer appears but never writes", () => {
  it("reports an unregistered URL as offerable", () => {
    expect(isUnregisteredGatewayUrl({ gateways: [] }, "https://x.shares.zrok.io")).toBe(true);
  });

  it("stops offering once the URL is registered", () => {
    const config = { gateways: [{ url: "https://x.shares.zrok.io", authModes: ["pairing" as const] }] };
    expect(isUnregisteredGatewayUrl(config, "https://x.shares.zrok.io")).toBe(false);
  });

  it("ignores a trailing slash, which would otherwise offer the same URL forever", () => {
    const config = { gateways: [{ url: "https://x.shares.zrok.io", authModes: ["pairing" as const] }] };
    expect(isUnregisteredGatewayUrl(config, "https://x.shares.zrok.io/")).toBe(false);
  });
});
