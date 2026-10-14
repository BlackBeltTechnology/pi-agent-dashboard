/**
 * Non-English core catalogs load on demand (one module per language).
 * Each test starts from a fresh module graph: catalog loads are per-page
 * singletons. See change: shrink-client-entry-lazy-islands (tasks 3.1/3.5).
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "pi-dashboard-language";

beforeEach(() => {
  vi.resetModules();
  localStorage.removeItem(STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  vi.doUnmock("../lib/i18n/i18n-hu.js");
  vi.doUnmock("../lib/i18n/i18n-zh-CN.js");
  vi.restoreAllMocks();
  // setLanguage persists to the localStorage file shared by every worker.
  localStorage.removeItem(STORAGE_KEY);
});

const fresh = () => import("../lib/i18n/i18n.js");

describe("loadCatalog", () => {
  it("is memoized per language", async () => {
    const { loadCatalog } = await fresh();
    const a = loadCatalog("hu");
    expect(loadCatalog("hu")).toBe(a);
    await a;
    expect(loadCatalog("hu")).toBe(a);
    expect(loadCatalog("zh-CN")).not.toBe(a);
  });

  it("is a no-op for en", async () => {
    const { loadCatalog } = await fresh();
    await expect(loadCatalog("en")).resolves.toBeUndefined();
  });

  it("does not request any catalog module until asked (English user)", async () => {
    const huFactory = vi.fn(() => ({ huCatalog: {} }));
    const zhFactory = vi.fn(() => ({ zhCNCatalog: {} }));
    vi.doMock("../lib/i18n/i18n-hu.js", huFactory);
    vi.doMock("../lib/i18n/i18n-zh-CN.js", zhFactory);
    const { t, loadCatalog } = await fresh();
    await loadCatalog("en");
    expect(t("common.save", undefined, "Save")).toBe("Save");
    expect(huFactory).not.toHaveBeenCalled();
    expect(zhFactory).not.toHaveBeenCalled();
  });

  it("falls back to English and does not throw when the catalog fails to load", async () => {
    vi.doMock("../lib/i18n/i18n-hu.js", () => {
      throw new Error("chunk 404");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { loadCatalog, I18nProvider, useI18n } = await fresh();
    await expect(loadCatalog("hu")).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    localStorage.setItem(STORAGE_KEY, "hu");
    const Probe = () => <span data-testid="x">{useI18n().t("common.save", undefined, "Save")}</span>;
    const { getByTestId } = render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(getByTestId("x").textContent).toBe("Save");
  });
});

describe("plugin catalogs and late-loaded core catalogs", () => {
  it("resolves plugin.<id>.* when the plugin registered BEFORE the core catalog loaded", async () => {
    const { registerPluginCatalog, loadCatalog, I18nProvider, useI18n } = await fresh();
    registerPluginCatalog("demo", { hu: { hello: "Szia" } });
    await loadCatalog("hu");
    localStorage.setItem(STORAGE_KEY, "hu");
    const Probe = () => <span data-testid="x">{useI18n().t("plugin.demo.hello", undefined, "Hello")}</span>;
    const { getByTestId } = render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(getByTestId("x").textContent).toBe("Szia");
  });

  it("resolves plugin.<id>.* when the plugin registered AFTER the core catalog loaded", async () => {
    const { registerPluginCatalog, loadCatalog, I18nProvider, useI18n } = await fresh();
    await loadCatalog("hu");
    registerPluginCatalog("demo", { hu: { hello: "Szia" } });
    localStorage.setItem(STORAGE_KEY, "hu");
    const Probe = () => <span data-testid="x">{useI18n().t("plugin.demo.hello", undefined, "Hello")}</span>;
    const { getByTestId } = render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(getByTestId("x").textContent).toBe("Szia");
  });

  it("loading a core catalog does not drop earlier plugin keys, nor core keys", async () => {
    const { registerPluginCatalog, loadCatalog, I18nProvider, useI18n } = await fresh();
    registerPluginCatalog("demo", { "zh-CN": { hello: "你好" } });
    await loadCatalog("zh-CN");
    localStorage.setItem(STORAGE_KEY, "zh-CN");
    const Probe = () => {
      const { t } = useI18n();
      return (
        <span data-testid="x">
          {t("plugin.demo.hello", undefined, "Hello")}|{t("settings.general", undefined, "General")}
        </span>
      );
    };
    const { getByTestId } = render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(getByTestId("x").textContent).toBe("你好|常规");
  });
});

describe("I18nProvider.setLanguage", () => {
  it("applies the language only after its catalog has loaded", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.doMock("../lib/i18n/i18n-hu.js", async () => {
      await gate;
      return { huCatalog: { "settings.general": "Általános" } };
    });
    const { I18nProvider, useI18n } = await fresh();
    const Probe = () => {
      const { t, language, setLanguage } = useI18n();
      return (
        <div>
          <button type="button" data-testid="go" onClick={() => setLanguage("hu")} />
          <span data-testid="lang">{language}</span>
          <span data-testid="label">{t("settings.general", undefined, "General")}</span>
        </div>
      );
    };
    const { getByTestId } = render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    act(() => getByTestId("go").click());
    // Catalog still loading: UI has NOT flipped, still the English text.
    expect(getByTestId("lang").textContent).toBe("en");
    expect(getByTestId("label").textContent).toBe("General");
    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => expect(getByTestId("lang").textContent).toBe("hu"));
    // Translated on the very first hu frame — never an untranslated key.
    expect(getByTestId("label").textContent).toBe("Általános");
  });

  it("a slower earlier pick does not overwrite a newer one", async () => {
    let releaseHu: () => void = () => {};
    const huGate = new Promise<void>((r) => {
      releaseHu = r;
    });
    vi.doMock("../lib/i18n/i18n-hu.js", async () => {
      await huGate;
      return { huCatalog: {} };
    });
    const { I18nProvider, useI18n } = await fresh();
    const Probe = () => {
      const { language, setLanguage } = useI18n();
      return (
        <div>
          <button type="button" data-testid="hu" onClick={() => setLanguage("hu")} />
          <button type="button" data-testid="zh" onClick={() => setLanguage("zh-CN")} />
          <span data-testid="lang">{language}</span>
        </div>
      );
    };
    const { getByTestId } = render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    act(() => getByTestId("hu").click());
    act(() => getByTestId("zh").click());
    await waitFor(() => expect(getByTestId("lang").textContent).toBe("zh-CN"));
    await act(async () => {
      releaseHu();
      await huGate;
    });
    expect(getByTestId("lang").textContent).toBe("zh-CN");
  });
});

describe("translationsOf (static reserved-label table)", () => {
  it("returns zh-CN and hu values without any catalog loaded", async () => {
    const { translationsOf } = await fresh();
    expect(translationsOf("settings.providers")).toEqual(["提供商", "Szolgáltatók"]);
    expect(translationsOf("not.a.reserved.key")).toEqual([]);
  });
});
