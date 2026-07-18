/**
 * Integration evidence for task 6.2: switching language re-resolves every
 * surface class — core `t()`, a registered plugin catalog via the standalone
 * translator, and a Zone-3 server code via `resolveServerMessage` — with no raw
 * English leaking once a translation exists. Exercises the real I18nProvider +
 * registerPluginCatalog + server-error resolver together.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { I18nProvider, useI18n, registerPluginCatalog } from "../lib/i18n/i18n.js";
import { resolveServerMessage } from "../lib/api/server-error.js";

afterEach(cleanup);

// Register a plugin catalog once (merged under plugin.demo.*).
registerPluginCatalog("demo", {
  "zh-CN": { "hello": "你好" },
  hu: { "hello": "Szia" },
});

function Surfaces() {
  const { t, language, setLanguage } = useI18n();
  return (
    <div>
      <button type="button" data-testid="to-hu" onClick={() => setLanguage("hu")}>
        hu
      </button>
      <button type="button" data-testid="to-zh" onClick={() => setLanguage("zh-CN")}>
        zh
      </button>
      <span data-testid="lang">{language}</span>
      {/* core key present in the shipped catalog */}
      <span data-testid="core">{t("common.save", undefined, "Save")}</span>
      {/* plugin key via the merged namespace */}
      <span data-testid="plugin">{t("plugin.demo.hello", undefined, "Hello")}</span>
      {/* Zone-3 server code via the resolver (uses the standalone singleton t) */}
      <span data-testid="server">
        {resolveServerMessage({ code: "git.not_a_repo", message: "not a git repository" })}
      </span>
    </div>
  );
}

describe("language switch re-resolves all surfaces (task 6.2)", () => {
  it("renders Chinese then Hungarian across core, plugin, and server-code surfaces", () => {
    const { getByTestId } = render(
      <I18nProvider>
        <Surfaces />
      </I18nProvider>,
    );

    act(() => getByTestId("to-zh").click());
    expect(getByTestId("lang").textContent).toBe("zh-CN");
    expect(getByTestId("core").textContent).toBe("保存");
    expect(getByTestId("plugin").textContent).toBe("你好");
    expect(getByTestId("server").textContent).toBe("不是 git 仓库");
    // No raw English leaked on the translated surfaces.
    expect(getByTestId("server").textContent).not.toBe("not a git repository");

    act(() => getByTestId("to-hu").click());
    expect(getByTestId("lang").textContent).toBe("hu");
    // hu core value (whatever the catalog holds) must differ from the English fallback.
    expect(getByTestId("core").textContent).toBe("Módosítások mentése");
    expect(getByTestId("core").textContent).not.toBe("Save");
    expect(getByTestId("plugin").textContent).toBe("Szia");
    expect(getByTestId("server").textContent).toBe("Nem git tároló");
  });
});
