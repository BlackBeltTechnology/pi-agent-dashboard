import { describe, expect, it } from "vitest";
import { browserLoginAuthStatus } from "../browser-login-auth-status.js";

describe("browserLoginAuthStatus — /auth/status no-cookie-auth path (D16 / H5)", () => {
  it("is inert when no browser-login descriptor is active (unchanged legacy shape)", () => {
    for (const isAuthenticated of [true, false]) {
      for (const isGenuinelyLocal of [true, false]) {
        expect(
          browserLoginAuthStatus({ descriptorActive: false, isAuthenticated, isGenuinelyLocal }),
        ).toEqual({ authenticated: true, authEnabled: false });
      }
    }
  });

  it("escalates an unauthenticated, non-local caller so the client shows the gate", () => {
    expect(
      browserLoginAuthStatus({ descriptorActive: true, isAuthenticated: false, isGenuinelyLocal: false }),
    ).toEqual({ authenticated: false, authEnabled: true });
  });

  it("treats a resolved bearer principal as authenticated", () => {
    expect(
      browserLoginAuthStatus({ descriptorActive: true, isAuthenticated: true, isGenuinelyLocal: false }),
    ).toEqual({ authenticated: true, authEnabled: true });
  });

  it("treats a genuinely-local caller as authenticated without a bearer", () => {
    expect(
      browserLoginAuthStatus({ descriptorActive: true, isAuthenticated: false, isGenuinelyLocal: true }),
    ).toEqual({ authenticated: true, authEnabled: true });
  });
});
