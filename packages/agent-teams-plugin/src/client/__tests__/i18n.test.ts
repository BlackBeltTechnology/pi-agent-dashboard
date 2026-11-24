/**
 * Catalog key parity (test-plan S132): `en`, `zh-CN` and `hu` carry identical
 * key sets with no empty strings, and the client entry barrel exports the
 * catalog and nothing else (the change claims no UI slot).
 * See change: add-agent-teams-core.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalog } from "../../i18n.js";
import * as entry from "../index.js";

const LOCALES = ["en", "zh-CN", "hu"] as const;
const keysOf = (locale: (typeof LOCALES)[number]): string[] => Object.keys(catalog[locale]).sort();
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("i18n catalog parity (S132)", () => {
  it("exposes exactly en, zh-CN and hu", () => {
    expect(Object.keys(catalog).sort()).toEqual([...LOCALES].sort());
  });

  it("has identical, non-empty key sets in all three locales", () => {
    const reference = keysOf("en");
    expect(reference.length).toBeGreaterThan(0);
    for (const locale of LOCALES) expect(keysOf(locale), locale).toEqual(reference);
  });

  it("has no empty or whitespace-only strings, and keys are unprefixed leaf keys", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(catalog[locale])) {
        expect(typeof value, `${locale}.${key}`).toBe("string");
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
        expect(key.startsWith("plugin."), `${locale}.${key}`).toBe(false);
      }
    }
  });

  it("keeps `{var}` placeholders identical across locales", () => {
    const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
    for (const key of keysOf("en")) {
      const base = vars((catalog.en as Record<string, string>)[key] as string);
      for (const locale of LOCALES) expect(vars((catalog[locale] as Record<string, string>)[key] as string), `${locale}.${key}`).toEqual(base);
    }
  });
});

describe("client entry barrel (S132)", () => {
  it("exports the catalog and nothing else", () => {
    expect(Object.keys(entry)).toEqual(["catalog"]);
    expect(entry.catalog).toBe(catalog);
  });

  it("the manifest names that export and claims no slot", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"))["pi-dashboard-plugin"] as { i18nCatalog: string; claims: unknown[]; client: string };
    expect(manifest.claims).toEqual([]);
    expect(manifest.i18nCatalog).toBe("catalog");
    expect(Object.keys(entry)).toContain(manifest.i18nCatalog);
  });
});
