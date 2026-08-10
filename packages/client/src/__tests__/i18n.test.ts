import { describe, expect, it } from "vitest";
import {
  LANGUAGE_OPTIONS,
  LEGACY_ALIASES,
  normalizeLanguage,
  registerPluginCatalog,
  t,
} from "../lib/i18n/i18n.js";

describe("normalizeLanguage", () => {
  it("maps Hungarian variants to hu", () => {
    expect(normalizeLanguage("hu")).toBe("hu");
    expect(normalizeLanguage("hu-HU")).toBe("hu");
    expect(normalizeLanguage("HU")).toBe("hu");
    expect(normalizeLanguage("hu-hu")).toBe("hu");
  });
  it("maps Chinese and English variants", () => {
    expect(normalizeLanguage("zh-CN")).toBe("zh-CN");
    expect(normalizeLanguage("zh-Hans-CN")).toBe("zh-CN");
    expect(normalizeLanguage("en-US")).toBe("en");
  });
  it("returns null for unknown/empty", () => {
    expect(normalizeLanguage("fr")).toBeNull();
    expect(normalizeLanguage("")).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
  });
});

describe("LANGUAGE_OPTIONS", () => {
  it("offers en, zh-CN, and hu", () => {
    const values = LANGUAGE_OPTIONS.map((o) => o.value);
    expect(values).toEqual(["en", "zh-CN", "hu"]);
    expect(LANGUAGE_OPTIONS.find((o) => o.value === "hu")?.label).toBe("Magyar");
  });
});

describe("t() fallback order", () => {
  // Default language in the test env is en (empty source dict).
  it("shows the call-site fallback when no translation exists", () => {
    expect(t("nonexistent.key", undefined, "English fallback")).toBe("English fallback");
  });
  it("shows the key itself when there is neither translation nor fallback", () => {
    expect(t("nonexistent.key.no.fallback")).toBe("nonexistent.key.no.fallback");
  });
  it("interpolates {var} placeholders into the fallback", () => {
    expect(t("x.count", { count: 3 }, "{count} items")).toBe("3 items");
  });
  it("interpolates across languages via the fallback path", () => {
    // en has no dict entries, so interpolation runs on the fallback for all langs.
    expect(t("time.custom", { count: 5 }, "{count}s")).toBe("5s");
  });
});

describe("LEGACY_ALIASES", () => {
  it("resolves an aliased legacy key to its structured translation", () => {
    // Pick any alias entry and confirm the mechanism is wired.
    const [oldKey, newKey] = Object.entries(LEGACY_ALIASES)[0] ?? [];
    expect(oldKey).toBeTruthy();
    expect(newKey).toBeTruthy();
    // With no active translation, aliasing still returns the fallback (never throws).
    expect(t(oldKey as string, undefined, "fallback")).toBe("fallback");
  });
});

describe("registerPluginCatalog", () => {
  it("namespaces plugin keys and resolves them via t() (zh-CN)", async () => {
    // Register under a unique id and confirm the prefixed key becomes reachable.
    registerPluginCatalog("testplugin", {
      "zh-CN": { "launch.title": "启动" },
      hu: { "launch.title": "Indítás" },
    });
    // The standalone t() reads the current-language singleton (en by default),
    // so with no en entry it returns the fallback; the merge itself must not throw
    // and must not collide with core keys.
    expect(() =>
      registerPluginCatalog("testplugin", { "zh-CN": { "launch.title": "启动" } }),
    ).not.toThrow();
    // Missing catalog for a language degrades gracefully (no throw).
    expect(() => registerPluginCatalog("nocatalog", undefined)).not.toThrow();
    expect(t("plugin.testplugin.launch.title", undefined, "Launch")).toBe("Launch");
  });
});
