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
  it("the add-team-skill-access keys exist in both catalogs (E39)", () => {
    const needed = [
      "grid.skills",
      "card.skillsN",
      "card.blocked.targets",
      "card.blocked.invalid",
      "card.blocked.missing",
      "card.blocked.users",
      "card.blockedFix",
      "card.blockedFixSkill",
      "card.blockedAsk",
      "sk.title",
      "sk.loadError",
      "sk.invalidName",
      "sk.usage",
      "sk.readonly",
      "dlg.remove.ok",
      "dlg.save.body",
      "toast.skillSaved",
      "toast.removed",
      "ed.skillOnly",
      "ed.skillRemoved",
      "ed.skillsEmptyAdmin",
      "ed.skillsEmptyLink",
      "cv.skillRefused",
      "cv.skillAvail",
      "cv.skillNone",
      "cv.blockedTitle",
      "cv.blockedBody.missing",
      "cv.blockedMember",
    ];
    for (const lang of ["hu", "en"] as const) {
      const keys = Object.keys(CATALOG[lang]);
      for (const k of needed) expect(keys, `${lang} misses ${k}`).toContain(k);
    }
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
