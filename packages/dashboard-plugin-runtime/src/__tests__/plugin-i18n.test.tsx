/**
 * Plugin i18n contract (change: make-all-ui-text-i18n).
 * Verifies the scoped `useT` hook auto-prefixes `plugin.<id>.`, resolves via
 * the shell-wired translator, degrades gracefully when unwired, and re-resolves
 * on language switch.
 */

import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CurrentPluginLayer, PluginContextProvider, useLanguage, useT } from "../index.js";

afterEach(cleanup);

// A fake shell translator over two language dictionaries, mirroring the client
// i18n runtime's resolution (dict[lang][key] ?? fallback ?? key).
function makeTranslator(lang: string) {
  const dicts: Record<string, Record<string, string>> = {
    "zh-CN": { "plugin.flows.launch.title": "启动", "plugin.flows.count": "{n} 个" },
    hu: { "plugin.flows.launch.title": "Indítás" },
  };
  return (key: string, vars?: Record<string, string | number>, fallback?: string) => {
    const tpl = dicts[lang]?.[key] ?? fallback ?? key;
    return vars ? tpl.replace(/\{(\w+)\}/g, (_, n) => String(vars[n] ?? "")) : tpl;
  };
}

function Probe() {
  const t = useT();
  const language = useLanguage();
  return (
    <div>
      <span data-testid="title">{t("launch.title", undefined, "Launch")}</span>
      <span data-testid="count">{t("count", { n: 3 }, "{n} items")}</span>
      <span data-testid="missing">{t("nope", undefined, "Fallback")}</span>
      <span data-testid="lang">{language}</span>
    </div>
  );
}

function renderIn(lang: string | undefined, wired: boolean) {
  return render(
    <PluginContextProvider
      t={wired ? makeTranslator(lang ?? "en") : undefined}
      language={lang}
    >
      <CurrentPluginLayer pluginId="flows">
        <Probe />
      </CurrentPluginLayer>
    </PluginContextProvider>,
  );
}

describe("plugin i18n contract", () => {
  it("resolves plugin.<id>.<key> in zh-CN via the context translator", () => {
    const { getByTestId } = renderIn("zh-CN", true);
    expect(getByTestId("title").textContent).toBe("启动");
    expect(getByTestId("count").textContent).toBe("3 个");
    expect(getByTestId("lang").textContent).toBe("zh-CN");
  });

  it("re-resolves plugin strings after a language switch (hu)", () => {
    const { getByTestId } = renderIn("hu", true);
    expect(getByTestId("title").textContent).toBe("Indítás");
    // hu dict lacks `count` -> falls back to the call-site English (interpolated).
    expect(getByTestId("count").textContent).toBe("3 items");
  });

  it("degrades to the call-site English fallback for an unmapped key", () => {
    const { getByTestId } = renderIn("zh-CN", true);
    expect(getByTestId("missing").textContent).toBe("Fallback");
  });

  it("degrades gracefully when the shell wires no translator", () => {
    const { getByTestId } = renderIn(undefined, false);
    expect(getByTestId("title").textContent).toBe("Launch");
    expect(getByTestId("count").textContent).toBe("3 items");
    expect(getByTestId("lang").textContent).toBe("en");
  });
});
