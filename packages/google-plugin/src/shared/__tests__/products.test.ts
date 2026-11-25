/**
 * Catalogue, scope coverage, union and selection parsing (design D4/D6; test-plan A14, A79–A84, GA2).
 * See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import {
  builtinOffers,
  builtinRefused,
  CATALOGUE,
  coversProduct,
  coversSelection,
  effectiveScopes,
  levelAtLeast,
  PRODUCTS,
  parseSelection,
  requiredScopes,
  restrictedProducts,
  SCOPE,
  scopeParam,
  scopesFor,
  unionScopes,
} from "../products.js";

describe("catalogue", () => {
  it("lists the products in the display order Gmail … Contacts (B10)", () => {
    expect(CATALOGUE.map((p) => p.id)).toEqual([...PRODUCTS]);
    expect([...PRODUCTS]).toEqual(["gmail", "calendar", "drive", "docs", "sheets", "slides", "tasks", "contacts"]);
  });

  it("maps each level to the D4 scopes", () => {
    expect(scopesFor("calendar", { level: "read" })).toEqual([SCOPE.calendarReadonly]);
    expect(scopesFor("calendar", { level: "write" })).toEqual([SCOPE.calendarEvents]);
    expect(scopesFor("drive", { level: "files" })).toEqual([SCOPE.driveFile]);
    expect(scopesFor("drive", { level: "read" })).toEqual([SCOPE.driveReadonly]);
    expect(scopesFor("drive", { level: "write" })).toEqual([SCOPE.drive]);
    expect(scopesFor("gmail", { level: "draft" })).toEqual([SCOPE.gmailReadonly, SCOPE.gmailCompose]);
    expect(scopesFor("gmail", { level: "send", options: { filters: true } })).toEqual([SCOPE.gmailModify, SCOPE.gmailSettingsBasic]);
    expect(scopesFor("contacts", { level: "bogus" })).toEqual([]);
  });

  it("full Drive is never offered by the built-in app (A2); the other levels are", () => {
    expect(builtinOffers("drive", "files")).toBe(true);
    expect(builtinOffers("drive", "read")).toBe(false);
    expect(builtinOffers("drive", "write")).toBe(false);
    expect(builtinOffers("calendar", "write")).toBe(true);
    expect(builtinRefused({ drive: { level: "read" }, calendar: { level: "read" } })).toEqual(["drive"]);
  });

  it("restricted products are Gmail (any level) and full Drive only (B6)", () => {
    expect(restrictedProducts({ gmail: { level: "readonly" }, calendar: { level: "write" }, drive: { level: "files" } })).toEqual(["gmail"]);
    expect(restrictedProducts({ drive: { level: "write" }, docs: { level: "read" } })).toEqual(["drive"]);
    expect(restrictedProducts({ calendar: { level: "write" }, tasks: { level: "read" } })).toEqual([]);
  });
});

describe("coverage", () => {
  it("a granted scope covers what it implies (gmail.modify ⇒ readonly+compose; drive ⇒ readonly+file)", () => {
    const eff = effectiveScopes([SCOPE.gmailModify, SCOPE.drive]);
    for (const s of [SCOPE.gmailReadonly, SCOPE.gmailCompose, SCOPE.driveReadonly, SCOPE.driveFile]) expect(eff.has(s)).toBe(true);
    expect(eff.has(SCOPE.gmailSettingsBasic)).toBe(false); // modify does not imply settings.basic
  });

  it("coversProduct / coversSelection need EVERY scope of the selection", () => {
    expect(coversProduct([SCOPE.calendarEvents], "calendar", { level: "write" })).toBe(true);
    expect(coversProduct([SCOPE.calendarReadonly], "calendar", { level: "write" })).toBe(false);
    expect(coversProduct([SCOPE.gmailModify], "gmail", { level: "send", options: { filters: true } })).toBe(false);
    expect(coversSelection([SCOPE.gmailModify, SCOPE.calendarReadonly], { gmail: { level: "draft" }, calendar: { level: "read" } })).toBe(true);
    expect(coversSelection([], {})).toBe(true);
  });

  it("levelAtLeast compares the ordered levels of ONE product", () => {
    expect(levelAtLeast("drive", "write", "files")).toBe(true);
    expect(levelAtLeast("drive", "files", "read")).toBe(false);
    expect(levelAtLeast("calendar", "read", "nope")).toBe(false);
  });
});

describe("consent request scopes", () => {
  it("is the UNION of granted and required, openid+email first, no duplicates (D6)", () => {
    const union = unionScopes([SCOPE.gmailReadonly], requiredScopes({ gmail: { level: "readonly" }, calendar: { level: "read" } }));
    expect(union).toEqual([SCOPE.gmailReadonly, SCOPE.calendarReadonly]);
    expect(scopeParam(union)).toBe(`openid email ${SCOPE.gmailReadonly} ${SCOPE.calendarReadonly}`);
  });

  it("built-in Drive files requests drive.file only (A14)", () => {
    expect(scopeParam(requiredScopes({ drive: { level: "files" } }))).toBe(`openid email ${SCOPE.driveFile}`);
  });
});

describe("parseSelection", () => {
  it("accepts a level string or {level, options}", () => {
    expect(parseSelection({ calendar: "read", gmail: { level: "send", options: { filters: true } } })).toEqual({
      calendar: { level: "read" },
      gmail: { level: "send", options: { filters: true } },
    });
    expect(parseSelection({})).toEqual({});
  });

  it("rejects unknown products, levels, options and non-objects instead of dropping them", () => {
    for (const bad of [null, [], "x", { photos: "read" }, { calendar: "admin" }, { gmail: { level: "send", options: { admin: true } } }, { gmail: { level: "send", options: { filters: "yes" } } }, { __proto__x: "read" }]) {
      expect(parseSelection(bad)).toBeNull();
    }
  });
});
