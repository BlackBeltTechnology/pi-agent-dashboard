/**
 * L1 filter ops × tiers × grants (test-plan E16). See change: improve-gmail-plugin-setup-ux.
 */
import { describe, expect, it } from "vitest";
import { authScopeParam, isOp, SCOPE, scopesCover, scopesCoverFilters, tierAllows } from "../scopes.js";

describe("E16 — filter ops", () => {
  it("are known ops", () => {
    expect(isOp("filters_read")).toBe(true);
    expect(isOp("filters_write")).toBe(true);
  });

  it("filters_read is allowed from readonly, filters_write needs send", () => {
    expect(tierAllows("readonly", "filters_read")).toBe(true);
    expect(tierAllows("draft", "filters_write")).toBe(false);
    expect(tierAllows("send", "filters_write")).toBe(true);
  });

  it("gmail.modify covers neither filter op; settings.basic covers both", () => {
    expect(scopesCover([SCOPE.modify], "filters_read")).toBe(false);
    expect(scopesCover([SCOPE.modify], "filters_write")).toBe(false);
    expect(scopesCoverFilters([SCOPE.modify])).toBe(false);
    expect(scopesCover([SCOPE.settingsBasic], "filters_read")).toBe(true);
    expect(scopesCover([SCOPE.settingsBasic], "filters_write")).toBe(true);
    expect(scopesCoverFilters([SCOPE.modify, SCOPE.settingsBasic])).toBe(true);
  });

  it("authScopeParam adds settings.basic only when filters are requested", () => {
    const withFilters = authScopeParam("send", { filters: true }).split(" ");
    expect(withFilters).toContain(SCOPE.modify);
    expect(withFilters).toContain(SCOPE.settingsBasic);
    expect(authScopeParam("send")).toBe(["openid", "email", SCOPE.modify].join(" "));
    expect(authScopeParam("send", { filters: false })).toBe(authScopeParam("send"));
  });
});
