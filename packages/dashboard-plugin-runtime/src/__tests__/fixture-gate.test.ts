/**
 * Fixture-plugin opt-in gate: fixture server/bridge entries load only under
 * PI_DASHBOARD_FIXTURE_PLUGINS=1; non-fixture plugins are unaffected.
 * See change: expose-plugin-credential-and-oauth-seams (D8).
 */
import { describe, expect, it } from "vitest";
import { fixtureEntryAllowed, fixturePluginsEnabled } from "../server/fixture-gate.js";

describe("fixture gate", () => {
  it("is off unless the env flag is exactly 1", () => {
    expect(fixturePluginsEnabled({})).toBe(false);
    expect(fixturePluginsEnabled({ PI_DASHBOARD_FIXTURE_PLUGINS: "true" })).toBe(false);
    expect(fixturePluginsEnabled({ PI_DASHBOARD_FIXTURE_PLUGINS: "1" })).toBe(true);
  });

  it("blocks only fixture entries", () => {
    expect(fixtureEntryAllowed({ fixture: true }, {})).toBe(false);
    expect(fixtureEntryAllowed({ fixture: true }, { PI_DASHBOARD_FIXTURE_PLUGINS: "1" })).toBe(true);
    expect(fixtureEntryAllowed({}, {})).toBe(true);
    expect(fixtureEntryAllowed({ fixture: false }, {})).toBe(true);
  });
});
