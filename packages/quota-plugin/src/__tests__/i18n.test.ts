/**
 * Catalog key-parity for the quota plugin's context-strip strings.
 *
 * `catalog` ships UNPREFIXED leaf keys under `plugin.quota.*`. Every locale
 * must carry the same key set — a missing key silently falls back to the
 * inline English string, so a mistranslated group label would never fail a
 * type-check. Covers test-plan X4.
 *
 * See change: move-quota-to-context-strip.
 */
import { describe, expect, it } from "vitest";
import { catalog } from "../i18n.js";

describe("quota catalog", () => {
  it("X4: the context-strip keys exist in every locale", () => {
    for (const locale of ["zh-CN", "hu"] as const) {
      for (const key of ["quota", "noQuota", "chipAria"] as const) {
        expect(catalog[locale][key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it("zh-CN and hu keep key parity", () => {
    expect(Object.keys(catalog.hu).sort()).toEqual(Object.keys(catalog["zh-CN"]).sort());
  });
});
