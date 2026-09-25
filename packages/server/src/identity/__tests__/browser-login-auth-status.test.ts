import { describe, expect, it } from "vitest";
import { browserLoginAuthStatus } from "../browser-login-auth-status.js";

describe("browserLoginAuthStatus — /auth/status no-cookie-auth path (D16 / H5 / D21)", () => {
  it("is inert when identity is not enforced (unchanged legacy shape)", () => {
    for (const isAuthenticated of [true, false]) {
      expect(browserLoginAuthStatus({ enforced: false, principal: isAuthenticated ? { iss: "i", sub: "s" } : null })).toEqual({
        authenticated: true,
        authEnabled: false,
      });
    }
  });

  it("escalates ANY caller without a bearer principal while enforced — loopback included (D21: loopback is not trust)", () => {
    expect(browserLoginAuthStatus({ enforced: true, principal: null })).toEqual({
      authenticated: false,
      authEnabled: true,
    });
  });

  it("treats a resolved bearer principal as authenticated and returns who it is (D22 user line)", () => {
    expect(
      browserLoginAuthStatus({ enforced: true, principal: { iss: "https://kc", sub: "u-1", email: "anna@example.test", name: "Anna Kovacs" } }),
    ).toEqual({
      authenticated: true,
      authEnabled: true,
      principal: { sub: "u-1", email: "anna@example.test", name: "Anna Kovacs" },
    });
  });

  it("omits absent display fields and never exposes iss", () => {
    const res = browserLoginAuthStatus({ enforced: true, principal: { iss: "https://kc", sub: "u-2" } });
    expect(res).toEqual({ authenticated: true, authEnabled: true, principal: { sub: "u-2" } });
  });
});
