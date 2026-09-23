import { describe, expect, it } from "vitest";
import { browserLoginAuthStatus } from "../browser-login-auth-status.js";

describe("browserLoginAuthStatus — /auth/status no-cookie-auth path (D16 / H5 / D21)", () => {
  it("is inert when identity is not enforced (unchanged legacy shape)", () => {
    for (const isAuthenticated of [true, false]) {
      expect(browserLoginAuthStatus({ enforced: false, isAuthenticated })).toEqual({
        authenticated: true,
        authEnabled: false,
      });
    }
  });

  it("escalates ANY caller without a bearer principal while enforced — loopback included (D21: loopback is not trust)", () => {
    expect(browserLoginAuthStatus({ enforced: true, isAuthenticated: false })).toEqual({
      authenticated: false,
      authEnabled: true,
    });
  });

  it("treats a resolved bearer principal as authenticated", () => {
    expect(browserLoginAuthStatus({ enforced: true, isAuthenticated: true })).toEqual({
      authenticated: true,
      authEnabled: true,
    });
  });
});
