/**
 * Switches (A1, 10.6), client JSON (A4/A5), return origins (B3), endpoints, local-browser rule.
 * See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { normalizeDomain, slugify, validateClientJson } from "../client-json.js";
import { BUILT_IN, createSwitchReader } from "../default-clients.js";
import { GOOGLE_DEFAULTS, resolveGoogleEndpoints } from "../endpoints.js";
import { knownFlowCode } from "../flow-codes.js";
import { isGenuinelyLocal } from "../local.js";
import { allowedReturnOrigin } from "../return-origin.js";

describe("BUILT_IN ships empty (until verification)", () => {
  it("local and remote are null", () => expect(BUILT_IN).toEqual({ local: null, remote: null }));
});

describe("operator switches (A1, 10.6)", () => {
  const read = (env: Record<string, string | undefined>, warnings: string[] = []) =>
    createSwitchReader(env, (m) => warnings.push(m))();
  it("off / 0 / false (case-insensitive, trimmed) disable; unset and empty keep it on", () => {
    for (const v of ["off", "OFF", "Off", "0", "false", "FALSE", " off "]) {
      expect(read({ PI_GOOGLE_DEFAULT_CLIENTS: v, PI_GOOGLE_REMOTE_RETURN: v })).toEqual({ defaultClients: false, remoteReturn: false });
    }
    expect(read({})).toEqual({ defaultClients: true, remoteReturn: true });
    expect(read({ PI_GOOGLE_DEFAULT_CLIENTS: "" })).toEqual({ defaultClients: true, remoteReturn: true });
  });
  it("unknown values are on and warned about ONCE per value", () => {
    const warnings: string[] = [];
    const env: Record<string, string | undefined> = { PI_GOOGLE_DEFAULT_CLIENTS: "disabled" };
    const reader = createSwitchReader(env, (m) => warnings.push(m));
    expect(reader().defaultClients).toBe(true);
    reader();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("PI_GOOGLE_DEFAULT_CLIENTS");
  });
  it("reads the environment on every call (live switch)", () => {
    const env: Record<string, string | undefined> = {};
    const reader = createSwitchReader(env);
    expect(reader().defaultClients).toBe(true);
    env.PI_GOOGLE_DEFAULT_CLIENTS = "off";
    expect(reader().defaultClients).toBe(false);
  });
});

describe("validateClientJson (A4)", () => {
  const id = "123-abc.apps.googleusercontent.com";
  it("accepts a Desktop (installed) and a Web client", () => {
    expect(validateClientJson({ installed: { client_id: id, client_secret: "s", project_id: "acme-pi-1" } })).toEqual({
      ok: true,
      client: { type: "installed", clientId: id, clientSecret: "s", projectId: "acme-pi-1" },
    });
    expect(validateClientJson(JSON.stringify({ web: { client_id: id, client_secret: "s" } }))).toEqual({
      ok: true,
      client: { type: "web", clientId: id, clientSecret: "s" },
    });
  });
  it("refuses with stable codes: malformed, neither, both, bad id, missing secret", () => {
    expect(validateClientJson("{nope")).toEqual({ ok: false, error: "not_json" });
    expect(validateClientJson([])).toEqual({ ok: false, error: "not_json" });
    expect(validateClientJson({ other: {} })).toEqual({ ok: false, error: "not_installed" });
    expect(validateClientJson({ installed: { client_id: id, client_secret: "s" }, web: { client_id: id, client_secret: "s" } })).toEqual({ ok: false, error: "ambiguous_client" });
    expect(validateClientJson({ installed: { client_id: "nope", client_secret: "s" } })).toEqual({ ok: false, error: "bad_client_id" });
    expect(validateClientJson({ web: { client_id: id } })).toEqual({ ok: false, error: "missing_secret" });
    expect(validateClientJson({ web: { client_id: id, client_secret: "   " } })).toEqual({ ok: false, error: "missing_secret" });
  });
});

describe("domains (A5, 10.30)", () => {
  it("trims, lowercases and strips a leading @", () => {
    expect(normalizeDomain("@Semmi.SE")).toBe("semmi.se");
    expect(normalizeDomain(" semmi.se ")).toBe("semmi.se");
  });
  it("refuses entries that could match everything or nothing sensible", () => {
    for (const bad of ["semmi", "", "  ", "a@b.c", ".se", "semmi.", "sem mi.se"]) expect(normalizeDomain(bad)).toBeNull();
  });
  it("slugify yields a stable id", () => {
    expect(slugify("BlackBelt Kft.")).toBe("blackbelt-kft");
    expect(slugify("???")).toBe("client");
  });
});

describe("return origins (B3)", () => {
  it("allows https and loopback http on any port", () => {
    expect(allowedReturnOrigin("https://pi.blackbelt.hu")).toBe("https://pi.blackbelt.hu");
    expect(allowedReturnOrigin("https://pi.blackbelt.hu/some/path?x=1")).toBe("https://pi.blackbelt.hu");
    expect(allowedReturnOrigin("http://localhost:8000")).toBe("http://localhost:8000");
    expect(allowedReturnOrigin("http://127.0.0.1:18000")).toBe("http://127.0.0.1:18000");
  });
  it("refuses other http, userinfo, other schemes and garbage", () => {
    for (const bad of ["http://example.com", "http://192.168.1.5:8000", "https://user@host.example", "https://u:p@host.example", "javascript:alert(1)", "ftp://x", "not a url", ""]) {
      expect(allowedReturnOrigin(bad)).toBeNull();
    }
  });
});

describe("endpoints", () => {
  it("defaults to Google; honours only a loopback override", () => {
    expect(resolveGoogleEndpoints({})).toBe(GOOGLE_DEFAULTS);
    const warns: string[] = [];
    expect(resolveGoogleEndpoints({ PI_E2E_GOOGLE_BASE_URL: "https://evil.example" }, (m) => warns.push(m))).toBe(GOOGLE_DEFAULTS);
    expect(warns).toHaveLength(1);
    expect(warns[0]).not.toContain("evil");
    expect(resolveGoogleEndpoints({ PI_E2E_GOOGLE_BASE_URL: "http://127.0.0.1:4010/" })).toMatchObject({ token: "http://127.0.0.1:4010/token", overridden: true });
  });
});

describe("local-browser rule (D12a)", () => {
  it("loopback peer with no forwarding header is local", () => {
    expect(isGenuinelyLocal({}, "127.0.0.1")).toBe(true);
    expect(isGenuinelyLocal({ host: "localhost" }, "::1")).toBe(true);
    expect(isGenuinelyLocal({}, "::ffff:127.0.0.1")).toBe(true);
  });
  it("any of X-Forwarded-*, Forwarded, Via, X-Real-IP makes it remote; so does a non-loopback peer", () => {
    for (const h of ["x-forwarded-for", "X-Forwarded-Proto", "forwarded", "via", "x-real-ip"]) expect(isGenuinelyLocal({ [h]: "x" }, "127.0.0.1")).toBe(false);
    expect(isGenuinelyLocal({}, "10.0.0.5")).toBe(false);
    expect(isGenuinelyLocal({}, undefined)).toBe(false);
  });
});

describe("flow codes", () => {
  it("is an exact-match allow-list", () => {
    expect(knownFlowCode("client_mismatch")).toBe("client_mismatch");
    expect(knownFlowCode("CLIENT_MISMATCH")).toBeNull();
    expect(knownFlowCode("a@b.c")).toBeNull();
    expect(knownFlowCode(undefined)).toBeNull();
  });
});
