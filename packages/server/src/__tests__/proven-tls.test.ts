import { describe, expect, it } from "vitest";
import { TLS_ONLY_TOKEN_PREFIX, isTlsOnlyToken } from "@blackbelt-technology/pi-dashboard-shared/tls-only-token.js";
import { bearerChannelOf, isProvenTls } from "../auth/proven-tls.js";

const req = (encrypted: boolean, headers: Record<string, string> = {}) =>
  ({ socket: { encrypted }, headers }) as never;

describe("isProvenTls (test-plan #E3)", () => {
  it("is true only for an encrypted socket with no forwarding header", () => {
    expect(isProvenTls(req(true))).toBe(true);
  });

  it.each(["x-forwarded-for", "forwarded", "x-forwarded-proto", "via", "x-forwarded-port", "x-forwarded-server"])(
    "is false for an encrypted socket carrying %s",
    (h) => {
      expect(isProvenTls(req(true, { [h]: "x" }))).toBe(false);
    },
  );

  it("is false for a plain socket", () => {
    expect(isProvenTls(req(false))).toBe(false);
    expect(isProvenTls(undefined)).toBe(false);
  });
});

describe("bearerChannelOf / token prefix", () => {
  it("classifies tls, plain and no-request", () => {
    expect(bearerChannelOf(req(true))).toBe("tls");
    expect(bearerChannelOf(req(false))).toBe("plain");
    expect(bearerChannelOf(undefined)).toBe("plain");
  });

  it("recognises the TLS-only prefix", () => {
    expect(TLS_ONLY_TOKEN_PREFIX).toBe("pi_tls_");
    expect(isTlsOnlyToken("pi_tls_abc")).toBe(true);
    expect(isTlsOnlyToken("abc")).toBe(false);
    expect(isTlsOnlyToken(undefined)).toBe(false);
  });
});
