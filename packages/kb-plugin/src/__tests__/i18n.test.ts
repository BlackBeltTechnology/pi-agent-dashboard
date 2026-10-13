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

// test-plan #E23 — the plugins this change touched carry every new key in zh-CN and hu.
// See change: retro-ux-plugin-settings-forms.
import { catalog as contextMode } from "../../../context-mode-settings-plugin/src/i18n.js";
import { catalog as gmail } from "../../../gmail-plugin/src/i18n.js";
import { catalog as hermes } from "../../../hermes-memory-plugin/src/i18n.js";

const NEW_KEYS: Record<string, { catalog: typeof gmail; keys: string[] }> = {
  "context-mode": { catalog: contextMode as never, keys: ["unsavedOne", "unsavedMany", "on", "off"] },
  hermes: {
    catalog: hermes as never,
    keys: ["errEnterNumber", "errMin", "errWhole", "errRegex", "noModels", "openProviders", "on", "off", "inheritUnset", "groupChanged", "rawTitle"],
  },
  gmail: {
    catalog: gmail as never,
    keys: ["stepDone", "aliasFor", "levelFor", "revokeFor", "reauthFor", "addAccountDisabled", "statusOk", "statusReauth"],
  },
};

describe("retro-ux-plugin-settings-forms catalogs (E23)", () => {
  for (const [plugin, { catalog: c, keys }] of Object.entries(NEW_KEYS)) {
    it(`${plugin}: every new key exists in zh-CN and hu, with parity`, () => {
      for (const locale of ["zh-CN", "hu"] as const) {
        const strings = c[locale] as Record<string, string>;
        for (const key of keys) expect(strings[key], `${plugin} ${locale}.${key}`).toBeTruthy();
      }
      expect(Object.keys(c.hu).sort()).toEqual(Object.keys(c["zh-CN"]).sort());
    });
  }
});
