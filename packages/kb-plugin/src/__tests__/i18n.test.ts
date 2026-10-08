/**
 * kb catalog — the denied / pin / missing / no-sources strings exist in every
 * locale and zh-CN ⇄ hu keep key parity (test-plan #E13).
 * See change: kb-denied-folder-pin-state (design D6, D11).
 */
import { describe, expect, it } from "vitest";
import { catalog } from "../i18n.js";

const KEYS = [
  "labelNotAllowedShort",
  "titleDenied",
  "labelPinningShort",
  "pinFolder",
  "pinOffline",
  "labelOffline",
  "labelFolderMissingShort",
  "folderMissingAction",
  "labelNoSourcesShort",
  "configureSources",
] as const;

describe("kb catalog", () => {
  it("E13: the denied / pin / missing / no-sources keys exist in every locale", () => {
    for (const locale of ["zh-CN", "hu"] as const) {
      const strings = catalog[locale] as Record<string, string>;
      for (const key of KEYS) expect(strings[key], `${locale}.${key}`).toBeTruthy();
    }
  });

  it("zh-CN and hu keep key parity", () => {
    expect(Object.keys(catalog.hu).sort()).toEqual(Object.keys(catalog["zh-CN"]).sort());
  });
});
