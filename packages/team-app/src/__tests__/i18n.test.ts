import { describe, expect, it } from "vitest";
import { CATALOG } from "../i18n/catalog.js";
import { normaliseLang, translate } from "../i18n/index.js";

describe("i18n catalogs (F18)", () => {
  it("HU and EN have identical key sets", () => {
    expect(Object.keys(CATALOG.hu).sort()).toEqual(Object.keys(CATALOG.en).sort());
  });
  it("no empty strings", () => {
    for (const lang of ["hu", "en"] as const) for (const [k, v] of Object.entries(CATALOG[lang])) expect(v.length, `${lang}.${k}`).toBeGreaterThan(0);
  });
  it("interpolates variables and falls back to the key when missing", () => {
    expect(translate("en", "grid.count", { n: 3 })).toBe("3 agents");
    expect(translate("hu", "grid.count", { n: 3 })).toBe("3 ügynök");
    expect(translate("en", "nope" as never)).toBe("nope");
  });
  it("normalises language tags; HU is the default", () => {
    expect(normaliseLang("en-US")).toBe("en");
    expect(normaliseLang("de")).toBe("hu");
    expect(normaliseLang(undefined)).toBe("hu");
  });
});
