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
import {
  createSlotRegistry,
  type RegisteredSource,
  SettingsDraftProvider,
  type SettingsDraftRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  CurrentPluginLayer,
  PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type { UiModelSelectorProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrammarSettings } from "../GrammarSettings.js";
import type { GrammarConfig } from "../grammar-config.js";

/** Mock `ui:model-selector`: one button per model, emitting the `provider/id` label. */
function MockModelSelector({ models, current, onSelect }: UiModelSelectorProps) {
  return (
    <div data-testid="grammar-model-selector-impl" data-current={current ?? ""}>
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
}) {
  const state = { grammar: opts.grammar as Record<string, unknown> };
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

  it("reset reverts the draft to the loaded config (E3)", async () => {
    const { getByTestId, src } = await mount({ grammar: baseGrammar({ debounceMs: 1500 }) });
    fireEvent.change(getByTestId("grammar-debounce"), { target: { value: "9000" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    src().reset();
    await waitFor(() =>
      expect((getByTestId("grammar-debounce") as HTMLInputElement).value).toBe("1500"),
    );
    expect(src().isDirty).toBe(false);
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
      (el) => !selector.contains(el), // host-injected primitive subtree is exempt
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
});
