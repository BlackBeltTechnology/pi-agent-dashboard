/**
 * Tests for GrammarSettings (LLM-only, host Save Bar, accordion design).
 * See changes: add-grammar-settings-plugin, grammar-llm-only-with-explore,
 * align-grammar-settings-design.
 *
 * The section persists through the host's unified Save Bar via
 * `useSettingsDraftSource` (id `plugin:grammar`) — it renders NO own Save/Reload
 * buttons or "unsaved" chip. Tests mount it inside a `SettingsDraftProvider`
 * with a capturing registry and drive the registered source's
 * `commit`/`reset`/`isDirty`, exactly as the host does (pattern:
 * `client/src/components/__tests__/RetrySettingsSection.test.tsx`).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CurrentPluginLayer, createSlotRegistry, PluginContextProvider, type RegisteredSource, SettingsDraftProvider, type SettingsDraftRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type { UiModelSelectorProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrammarSettings } from "../GrammarSettings.js";
import type { GrammarConfig } from "../grammar-config.js";

/** Mock `ui:model-selector`: one button per model, emitting the `provider/id` label. */
function MockModelSelector({ models, current, onSelect, allowRoles }: UiModelSelectorProps) {
  return (
    <div data-testid="grammar-model-selector-impl" data-current={current ?? ""} data-allow-roles={String(!!allowRoles)}>
      {allowRoles && (
        <button type="button" data-testid="grammar-role-option-fast" onClick={() => onSelect("@fast")}>
          @fast
        </button>
      )}
      {(models ?? []).map((m) => {
        const label = `${m.provider}/${m.id}`;
        return (
          <button
            key={label}
            type="button"
            data-testid={`grammar-model-option-${label}`}
            onClick={() => onSelect(label)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function baseGrammar(overrides: Partial<GrammarConfig> = {}): GrammarConfig {
  return {
    enabled: true,
    autoCheck: true,
    debounceMs: 1200,
    minChars: 12,
    maxChars: 4000,
    language: "auto",
    correctionView: "redline",
    capitalizeFirstWord: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

/**
 * Route a fetch mock: GET /api/config, GET /api/models, POST plugin config.
 * `postStatus` drives the commit response (500 to exercise the failure path).
 */
function installFetch(opts: {
  grammar: GrammarConfig | Record<string, unknown>;
  postStatus?: number;
  /** Fault injection: `GET /api/config` rejects while true (flip via `state.failGet`). */
  failGet?: boolean;
}) {
  const state = { grammar: opts.grammar as Record<string, unknown>, failGet: !!opts.failGet };
  const postBodies: any[] = [];
  const mock = vi.fn(async (input: any, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.endsWith("/api/config/plugins/grammar") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      postBodies.push(body);
      const status = opts.postStatus ?? 200;
      if (status >= 400) return jsonResponse({ success: false }, false, status);
      state.grammar = body;
      return jsonResponse({ success: true });
    }
    if (url.endsWith("/api/config")) {
      if (state.failGet) throw new TypeError("network down");
      return jsonResponse({ success: true, data: { plugins: { grammar: state.grammar } } });
    }
    if (url.endsWith("/api/models")) {
      return jsonResponse({
        object: "list",
        data: [
          { id: "anthropic/claude-opus-4", provider: "anthropic" },
          { id: "openai/gpt-4o", provider: "openai" },
        ],
      });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return { mock, postBodies, state };
}

/** Mount inside the draft provider + plugin context; expose the registered source. */
async function mount(over: Parameters<typeof installFetch>[0]) {
  const fetchState = installFetch(over);
  const sources = new Map<string, RegisteredSource>();
  const registry: SettingsDraftRegistry = {
    upsert: (id, s) => sources.set(id, s),
    remove: (id) => {
      sources.delete(id);
    },
  };
  const ui = withUiPrimitiveProvider(
    { "ui:model-selector": MockModelSelector },
    <SettingsDraftProvider registry={registry}>
      <PluginContextProvider registry={createSlotRegistry()} sessions={[]} send={() => {}}>
        <CurrentPluginLayer pluginId="grammar">
          <GrammarSettings />
        </CurrentPluginLayer>
      </PluginContextProvider>
    </SettingsDraftProvider>,
  );
  const r = render(ui);
  await waitFor(() => expect(r.getByTestId("grammar-enabled")).toBeTruthy());
  const src = () => {
    const s = sources.get("plugin:grammar");
    if (!s) throw new Error("plugin:grammar never registered with the unified-Save registry");
    return s;
  };
  return { ...r, ...fetchState, src, sources };
}

describe("GrammarSettings", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("registers with the host unified Save Bar; isDirty flips on edit and back (E1)", async () => {
    const { getByTestId, src } = await mount({ grammar: baseGrammar() });
    expect(src().isDirty).toBe(false);
    fireEvent.change(getByTestId("grammar-debounce"), { target: { value: "2000" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    fireEvent.change(getByTestId("grammar-debounce"), { target: { value: "1200" } });
    await waitFor(() => expect(src().isDirty).toBe(false));
  });

  it("commit POSTs the plugin config endpoint with the edited body (E2)", async () => {
    const { getByTestId, src, postBodies } = await mount({ grammar: baseGrammar() });
    fireEvent.change(getByTestId("grammar-debounce"), { target: { value: "2000" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    await src().commit();
    expect(postBodies).toHaveLength(1);
    expect(postBodies[0].debounceMs).toBe(2000);
    // No LanguageTool keys ever written.
    expect(postBodies[0].backend).toBeUndefined();
    expect(postBodies[0].languagetool).toBeUndefined();
  });

  it("E20: a Role-tab pick persists as llm:{role} with no provider/model", async () => {
    const { getByTestId, src, postBodies } = await mount({ grammar: baseGrammar() });
    expect(getByTestId("grammar-model-selector-impl").getAttribute("data-allow-roles")).toBe("true");
    fireEvent.click(getByTestId("grammar-role-option-fast"));
    await waitFor(() => expect(src().isDirty).toBe(true));
    await src().commit();
    expect(postBodies[0].llm).toEqual({ role: "@fast" });
  });

  it("a role model is shown as current and satisfies the 'pick a model' prompt", async () => {
    const { getByTestId, queryByTestId } = await mount({ grammar: baseGrammar({ llm: { role: "@fast" } }) });
    expect(getByTestId("grammar-model-selector-impl").getAttribute("data-current")).toBe("@fast");
    expect(queryByTestId("grammar-model-required")).toBeNull();
  });

  it("a direct pick still persists provider/model unchanged", async () => {
    const { getByTestId, src, postBodies } = await mount({ grammar: baseGrammar() });
    fireEvent.click(getByTestId("grammar-model-option-anthropic/claude-opus-4"));
    await waitFor(() => expect(src().isDirty).toBe(true));
    await src().commit();
    expect(postBodies[0].llm).toEqual({ provider: "anthropic", model: "claude-opus-4" });
  });

  it("reset reverts the draft to the loaded config (E3)", async () => {
    const { getByTestId, src } = await mount({ grammar: baseGrammar({ debounceMs: 1500 }) });
    fireEvent.change(getByTestId("grammar-debounce"), { target: { value: "9000" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    src().reset();
    await waitFor(() =>
      expect((getByTestId("grammar-debounce") as HTMLInputElement).value).toBe("1500"),
    );
    // The host registry learns `isDirty` in an effect after the render that shows
    // the value — wait for it instead of racing it (flaked on a loaded CI runner).
    await waitFor(() => expect(src().isDirty).toBe(false));
  });

  it("shows a 'pick a model' prompt when unset, hidden once set (E4)", async () => {
    const unset = await mount({ grammar: baseGrammar() });
    expect(unset.getByTestId("grammar-model-required")).toBeTruthy();
    expect(unset.queryByTestId("grammar-backend")).toBeNull();
    unset.unmount();

    const set = await mount({ grammar: baseGrammar({ llm: { provider: "anthropic", model: "claude-opus-4" } }) });
    expect(set.queryByTestId("grammar-model-required")).toBeNull();
    expect(set.getByTestId("grammar-llm-model-selector")).toBeTruthy();
  });

  it("renders a persisted LanguageTool config as LLM-only (E5)", async () => {
    const { getByTestId, queryByTestId } = await mount({
      grammar: { ...baseGrammar(), backend: "languagetool", languagetool: { url: "http://lt:8081" } },
    });
    expect(queryByTestId("grammar-backend")).toBeNull();
    expect(queryByTestId("grammar-lt-url")).toBeNull();
    expect(getByTestId("grammar-llm-model-selector")).toBeTruthy();
  });

  it("persists the correction view through commit (E6)", async () => {
    const { getByTestId, src, postBodies } = await mount({ grammar: baseGrammar({ correctionView: "redline" }) });
    fireEvent.change(getByTestId("grammar-correction-view"), { target: { value: "list" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    await src().commit();
    expect(postBodies[0].correctionView).toBe("list");
  });

  it("groups fields into <details> accordions; surviving testids present, Save/Reload/dirty gone (E7)", async () => {
    const { getByTestId, queryByTestId, container } = await mount({ grammar: baseGrammar() });
    expect(container.querySelectorAll("details").length).toBeGreaterThanOrEqual(3);
    for (const id of [
      "grammar-settings",
      "grammar-enabled",
      "grammar-autocheck",
      "grammar-correction-view",
      "grammar-capitalize",
      "grammar-debounce",
      "grammar-minchars",
      "grammar-maxchars",
      "grammar-language",
      "grammar-llm-model-selector",
    ]) {
      expect(getByTestId(id)).toBeTruthy();
    }
    expect(queryByTestId("grammar-save")).toBeNull();
    expect(queryByTestId("grammar-reload")).toBeNull();
    expect(queryByTestId("grammar-dirty")).toBeNull();
  });

  it("shows a collapsed recommended-models disclosure, not nested in a <label> (E8)", async () => {
    const { getByTestId } = await mount({ grammar: baseGrammar() });
    const disc = getByTestId("grammar-recommended-models") as HTMLDetailsElement;
    expect(disc.tagName).toBe("DETAILS");
    expect(disc.open).toBe(false); // collapsed by default
    expect(disc.closest("label")).toBeNull(); // invalid nesting guard
    expect(disc.textContent).toContain("openai/gpt-4.1-nano");
    expect(disc.textContent).toContain("qwen/qwen3-30b-a3b-2507");
  });

  it("renders the model-guidance hint + a link whose target exists in docs/ (E9)", async () => {
    const { getByTestId } = await mount({ grammar: baseGrammar() });
    expect(getByTestId("grammar-model-hint")).toBeTruthy();
    const href = getByTestId("grammar-model-guidance-link").getAttribute("href") ?? "";
    const rel = href.replace(/^\//, "");
    expect(rel).toMatch(/^docs\/.+\.md$/);
    expect(existsSync(resolve(process.cwd(), rel))).toBe(true);
  });

  it("a failed save rejects commit and keeps the section dirty (X1)", async () => {
    const { getByTestId, src } = await mount({ grammar: baseGrammar(), postStatus: 500 });
    fireEvent.change(getByTestId("grammar-debounce"), { target: { value: "2000" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    await expect(src().commit()).rejects.toThrow();
    expect(src().isDirty).toBe(true); // stayed dirty — no false success
  });

  it("carries no plugin-owned inline styles and no color literals (F1)", async () => {
    const { getByTestId } = await mount({ grammar: baseGrammar() });
    const section = getByTestId("grammar-settings");
    const selector = getByTestId("grammar-llm-model-selector");
    const offenders = Array.from(section.querySelectorAll<HTMLElement>("[style]")).filter(
      (el) => !selector.contains(el) && !el.closest("svg"), // host primitive + kit-owned @mdi icons are exempt
    );
    expect(offenders).toEqual([]);
    const html = section.className + section.innerHTML;
    expect(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/.test(html)).toBe(false);
  });

  it("renders no LanguageTool reachability marker (F2)", async () => {
    const { queryByTestId } = await mount({ grammar: baseGrammar() });
    expect(queryByTestId("grammar-lt-health")).toBeNull();
  });

  it("gives every surviving control AND each accordion summary a focus-ring (F3)", async () => {
    const { getByTestId, container } = await mount({ grammar: baseGrammar() });
    for (const id of [
      "grammar-enabled",
      "grammar-autocheck",
      "grammar-correction-view",
      "grammar-capitalize",
      "grammar-debounce",
      "grammar-minchars",
      "grammar-maxchars",
      "grammar-language",
    ]) {
      expect(getByTestId(id).classList.contains("focus-ring")).toBe(true);
    }
    const summaries = Array.from(container.querySelectorAll("summary"));
    expect(summaries.length).toBeGreaterThanOrEqual(3);
    for (const s of summaries) expect(s.classList.contains("focus-ring")).toBe(true);
  });

  it("expresses every color via var(--…) theme tokens (F4)", async () => {
    const { getByTestId } = await mount({ grammar: baseGrammar() });
    const section = getByTestId("grammar-settings");
    // Every class referencing a color uses a token; no hardcoded literal survives.
    expect(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/.test(section.innerHTML)).toBe(false);
    expect(section.innerHTML).toContain("var(--");
  });

  it("E20 (retro-ux): the model-required prompt is a ≥12 px warning callout with an icon", async () => {
    const { getByTestId } = await mount({ grammar: baseGrammar() });
    const prompt = getByTestId("grammar-model-required");
    expect(prompt.className).toContain("--severity-warning-bg");
    expect(prompt.className).toContain("--severity-warning-fg");
    expect(prompt.className).toContain("text-xs");
    expect(prompt.className).not.toContain("text-[10px]");
    expect(prompt.querySelector("svg")).toBeTruthy();
    expect(prompt.getAttribute("role")).toBe("status");
  });
});

describe("GrammarSettings — retro-ux wave 2 anatomy", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("E7: the body repeats neither the plugin title nor its id", async () => {
    const { getByTestId } = await mount({ grammar: baseGrammar() });
    const section = getByTestId("grammar-settings");
    expect(section.querySelector("h1, h2, h3")).toBeNull();
    const repeats = Array.from(section.querySelectorAll("*")).filter((el) =>
      ["Grammar & Spelling", "grammar"].includes((el.textContent ?? "").trim()),
    );
    expect(repeats).toEqual([]);
  });

  it("E8: in-body master switch is 'Check grammar in the composer', keeps its testid, writes enabled", async () => {
    const { getByRole, getByTestId, src, postBodies } = await mount({ grammar: baseGrammar({ enabled: true }) });
    const sw = getByRole("switch", { name: "Check grammar in the composer" });
    expect(sw).toBe(getByTestId("grammar-enabled"));
    expect(sw.getAttribute("aria-checked")).toBe("true");
    for (const bad of ["Enabled", "Enable", "On"]) {
      expect(() => getByRole("switch", { name: bad })).toThrow();
    }
    fireEvent.click(sw);
    await waitFor(() => expect(src().isDirty).toBe(true));
    await act(async () => {
      await src().commit();
    });
    expect(postBodies[0].enabled).toBe(false);
  });

  it("groups Checking, Model, Advanced render in order; Advanced collapsed", async () => {
    const { getByTestId } = await mount({ grammar: baseGrammar() });
    const checking = getByTestId("grammar-group-checking") as HTMLDetailsElement;
    const model = getByTestId("grammar-group-model") as HTMLDetailsElement;
    const advanced = getByTestId("grammar-group-advanced") as HTMLDetailsElement;
    expect(checking.open).toBe(true);
    expect(model.open).toBe(true);
    expect(advanced.open).toBe(false);
    expect(checking.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(model.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(checking.querySelector("summary")?.textContent).toContain("Checking");
    expect(model.querySelector("summary")?.textContent).toContain("Model");
    expect(advanced.querySelector("summary")?.textContent).toContain("Advanced");
  });

  it("every field has a tied label (unit inside it) and a hint tied via aria-describedby", async () => {
    const { getByTestId } = await mount({ grammar: baseGrammar() });
    const debounce = getByTestId("grammar-debounce") as HTMLInputElement;
    const label = debounce.ownerDocument.querySelector(`label[for="${debounce.id}"]`);
    expect(label?.textContent).toContain("Wait after typing");
    expect(label?.textContent).toContain("ms");
    const desc = debounce.getAttribute("aria-describedby") ?? "";
    expect(desc).not.toBe("");
    expect(debounce.ownerDocument.getElementById(desc.split(" ")[0])?.textContent).toMatch(/300/);
  });

  it.each([
    [3999, false],
    [4000, true],
    [4001, true],
  ])("E13: Shortest text %i with Longest 4000 → invalid=%s", async (min, invalid) => {
    // test-plan #E13 (BVA on min < max)
    const { getByTestId, container, src, postBodies } = await mount({ grammar: baseGrammar({ maxChars: 4000 }) });
    expect((getByTestId("grammar-group-advanced") as HTMLDetailsElement).open).toBe(false);
    fireEvent.change(getByTestId("grammar-minchars"), { target: { value: String(min) } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    const input = getByTestId("grammar-minchars");
    if (invalid) {
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const alert = container.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("4000");
      expect(alert?.id && input.getAttribute("aria-describedby")?.split(" ")).toContain(alert?.id);
      expect((getByTestId("grammar-group-advanced") as HTMLDetailsElement).open).toBe(true);
      await act(async () => {
        await expect(src().commit()).rejects.toThrow();
      });
      expect(postBodies).toHaveLength(0);
      expect(src().isDirty).toBe(true);
      // Correcting the value clears the error and allows saving.
      fireEvent.change(getByTestId("grammar-minchars"), { target: { value: "12" } });
      await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeNull());
      expect(getByTestId("grammar-minchars").getAttribute("aria-invalid")).toBeNull();
    } else {
      expect(input.getAttribute("aria-invalid")).toBeNull();
      expect(container.querySelector('[role="alert"]')).toBeNull();
      await act(async () => {
        await src().commit();
      });
      expect(postBodies).toHaveLength(1);
      expect(postBodies[0].minChars).toBe(3999);
    }
  });

  it("X4: a failed config load shows a notice with Try again; commit is off until a load succeeds", async () => {
    // test-plan #X4 (fault injection: GET rejects on mount)
    const { findByTestId, queryByTestId, getByTestId, src, postBodies, state } = await mount({
      grammar: baseGrammar({ debounceMs: 1500 }),
      failGet: true,
    });
    const notice = await findByTestId("grammar-load-error");
    expect(notice.textContent).toContain("Could not load the grammar settings");
    expect(notice.textContent).not.toMatch(/network down|TypeError/);
    expect(getByTestId("grammar-load-error-retry")).toBeTruthy();
    expect(src().isDirty).toBe(false);
    await act(async () => {
      await expect(src().commit()).rejects.toThrow();
    });
    expect(postBodies).toHaveLength(0);
    // Try again recovers.
    state.failGet = false;
    fireEvent.click(getByTestId("grammar-load-error-retry"));
    await waitFor(() => expect(queryByTestId("grammar-load-error")).toBeNull());
    expect((getByTestId("grammar-debounce") as HTMLInputElement).value).toBe("1500");
    fireEvent.change(getByTestId("grammar-debounce"), { target: { value: "2000" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    await act(async () => {
      await src().commit();
    });
    expect(postBodies).toHaveLength(1);
  });

  it("X5: a failed save is a plain sentence; the raw status is only behind Copy details", async () => {
    // test-plan #X5 (fault injection: POST → 500)
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { getByTestId, findByTestId, src } = await mount({ grammar: baseGrammar(), postStatus: 500 });
    fireEvent.change(getByTestId("grammar-debounce"), { target: { value: "2000" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    let message = "";
    await act(async () => {
      await src()
        .commit()
        .catch((e: Error) => {
          message = e.message;
        });
    });
    expect(message).not.toBe("");
    expect(message).not.toContain("grammar config save failed (500)");
    const notice = await findByTestId("grammar-save-error");
    expect(notice.textContent).not.toContain("grammar config save failed (500)");
    expect(notice.textContent).not.toContain("500");
    fireEvent.click(getByTestId("grammar-save-error-copy-details"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain("grammar config save failed (500)");
    expect(src().isDirty).toBe(true);
  });

  it("GR5: recommended models render as a table with a worded success pill at 12 px", async () => {
    const { getByTestId } = await mount({ grammar: baseGrammar() });
    const disc = getByTestId("grammar-recommended-models") as HTMLDetailsElement;
    expect(disc.open).toBe(false);
    const table = disc.querySelector("table");
    expect(table).toBeTruthy();
    expect(Array.from(table?.querySelectorAll("th") ?? []).map((th) => th.textContent)).toHaveLength(3);
    const rows = Array.from(table?.querySelectorAll("tbody tr") ?? []);
    expect(rows).toHaveLength(4);
    const pill = rows[0].querySelector('[data-tone="success"]');
    expect(pill?.textContent).toBe("Recommended");
    expect(rows.slice(1).some((r) => r.querySelector("[data-tone]"))).toBe(false);
    expect(disc.innerHTML).not.toMatch(/text-\[(9|9\.5|10|10\.5)px\]/);
    expect(disc.innerHTML).not.toMatch(/--text-(muted|faint)/);
  });
});
