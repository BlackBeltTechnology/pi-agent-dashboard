/**
 * Directory Settings › Session cards — localised Global/Edit-global strings
 * (change: card-sections-global-pointer, test-plan #E5). Separate file: the
 * i18n language is a module singleton, so a locale switch must not leak into
 * the English page tests.
 */
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { I18nProvider, type Language, loadCatalog } from "../../lib/i18n/i18n.js";
import { huCatalog } from "../../lib/i18n/i18n-hu.js";
import { zhCNCatalog } from "../../lib/i18n/i18n-zh-CN.js";
import { CardSectionsProvider } from "../../lib/state/CardSectionsContext.js";
import { CardSectionsPage } from "../DirectorySettings/CardSectionsPage.js";

afterEach(() => {
  cleanup();
  localStorage.removeItem("pi-dashboard-language");
});

async function renderIn(lang: Language) {
  localStorage.setItem("pi-dashboard-language", lang);
  await loadCatalog(lang);
  render(
    <I18nProvider>
      <Router hook={memoryLocation({ path: "/" }).hook}>
        <PluginContextProvider registry={createSlotRegistry()}>
          <CardSectionsProvider value={{ prefs: { global: { git: false } }, send: vi.fn() }}>
            <CardSectionsPage cwd="/repo/a" />
          </CardSectionsProvider>
        </PluginContextProvider>
      </Router>
    </I18nProvider>,
  );
}

describe("CardSectionsPage — localised Global strings (#E5)", () => {
  for (const [lang, catalog] of [["hu", huCatalog], ["zh-CN", zhCNCatalog]] as const) {
    it(`${lang}: inherit options and the global link render the locale strings`, async () => {
      await renderIn(lang);
      for (const k of ["cardSections.globalShow", "cardSections.globalHide", "cardSections.editGlobalDefaults"]) {
        expect(catalog[k]).toBeTruthy();
      }
      expect(screen.getByTestId("card-section-git-inherit").textContent).toBe(catalog["cardSections.globalHide"]);
      expect(screen.getByTestId("card-section-tags-inherit").textContent).toBe(catalog["cardSections.globalShow"]);
      expect(screen.getByTestId("card-sections-open-global").textContent).toBe(catalog["cardSections.editGlobalDefaults"]);
      expect(catalog["cardSections.defaultShow"]).toBeUndefined();
      expect(catalog["cardSections.defaultHide"]).toBeUndefined();
    });
  }
});
