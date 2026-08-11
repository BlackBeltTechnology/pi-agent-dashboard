/**
 * Tests for GrammarSettings (LLM-only). See changes: add-grammar-settings-plugin,
 * grammar-llm-only-with-explore.
 *
 * The plugin reads/persists `plugins.grammar.*` via GET /api/config +
 * POST /api/config/plugins/grammar. After the LanguageTool backend was removed
 * there is NO backend selector, NO LanguageTool URL field, and NO health probe;
 * the LLM model picker is unconditional and shows a "pick a model" prompt when
 * unset, with an inline model-guidance hint + doc link.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  CurrentPluginLayer,
  PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type { UiModelSelectorProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type React from "react";
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

function wrap(children: React.ReactNode) {
  return withUiPrimitiveProvider(
    { "ui:model-selector": MockModelSelector },
    <PluginContextProvider registry={createSlotRegistry()} sessions={[]} send={() => {}}>
      <CurrentPluginLayer pluginId="grammar">{children}</CurrentPluginLayer>
    </PluginContextProvider>,
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

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/**
 * Install a routing fetch mock. `state.grammar` is the server-side truth;
 * `clamp` mutates a POST'd block to emulate server clamping. The settings
 * section no longer probes /api/grammar/health.
 */
function installFetch(opts: {
  grammar: GrammarConfig | Record<string, unknown>;
  clamp?: (g: GrammarConfig) => GrammarConfig;
}) {
  const state: { grammar: GrammarConfig | Record<string, unknown> } = { grammar: opts.grammar };
  const putBodies: any[] = [];
  const models = () =>
    jsonResponse({
      object: "list",
      data: [
        { id: "anthropic/claude-opus-4", provider: "anthropic" },
        { id: "openai/gpt-4o", provider: "openai" },
      ],
    });
  const postPluginConfig = (init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as GrammarConfig;
    putBodies.push(body);
    state.grammar = opts.clamp ? opts.clamp(body) : body;
    return jsonResponse({ success: true });
  };
  const mock = vi.fn(async (input: any, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.endsWith("/api/config/plugins/grammar") && method === "POST") return postPluginConfig(init);
    if (url.endsWith("/api/config")) {
      return jsonResponse({ success: true, data: { plugins: { grammar: state.grammar } } });
    }
    if (url.endsWith("/api/models")) return models();
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return { mock, putBodies, state };
}

describe("GrammarSettings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads current values from GET /api/config", async () => {
    installFetch({ grammar: baseGrammar({ debounceMs: 1500, language: "en-US" }) });
    const { getByTestId } = render(wrap(<GrammarSettings />));

    await waitFor(() => {
      expect((getByTestId("grammar-enabled") as HTMLInputElement).checked).toBe(true);
    });
    expect((getByTestId("grammar-debounce") as HTMLInputElement).value).toBe("1500");
    expect((getByTestId("grammar-language") as HTMLInputElement).value).toBe("en-US");
  });

  it("shows the disabled defaults when the config has no grammar block", async () => {
    const mock = vi.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.endsWith("/api/config") && method === "GET") {
        return jsonResponse({ success: true, data: {} });
      }
      if (url.endsWith("/api/models")) {
        return jsonResponse({ object: "list", data: [] });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", mock);
    const { getByTestId } = render(wrap(<GrammarSettings />));

    await waitFor(() => {
      expect((getByTestId("grammar-enabled") as HTMLInputElement).checked).toBe(false);
    });
    expect((getByTestId("grammar-debounce") as HTMLInputElement).value).toBe("1200");
    expect((getByTestId("grammar-maxchars") as HTMLInputElement).value).toBe("4000");
  });

  it("renders no backend selector and no LanguageTool URL field (E6)", async () => {
    installFetch({ grammar: baseGrammar() });
    const { getByTestId, queryByTestId } = render(wrap(<GrammarSettings />));
    await waitFor(() => expect(getByTestId("grammar-debounce")).toBeTruthy());
    expect(queryByTestId("grammar-backend")).toBeNull();
    expect(queryByTestId("grammar-lt-url")).toBeNull();
    expect(queryByTestId("grammar-lt-health")).toBeNull();
    // The model picker is unconditional (no backend gate).
    expect(getByTestId("grammar-llm-model-selector")).toBeTruthy();
  });

  it("shows a 'pick a model' prompt when unset and hides it once a model is set (E6)", async () => {
    const { rerender } = { rerender: undefined as unknown as (u: React.ReactElement) => void };
    void rerender;
    installFetch({ grammar: baseGrammar() });
    const view = render(wrap(<GrammarSettings />));
    await waitFor(() => expect(view.getByTestId("grammar-model-required")).toBeTruthy());
    view.unmount();

    installFetch({ grammar: baseGrammar({ llm: { provider: "anthropic", model: "claude-opus-4" } }) });
    const view2 = render(wrap(<GrammarSettings />));
    await waitFor(() => expect(view2.getByTestId("grammar-llm-model-selector")).toBeTruthy());
    expect(view2.queryByTestId("grammar-model-required")).toBeNull();
  });

  it("renders a persisted LanguageTool config as LLM-only (E7)", async () => {
    // Simulate a legacy on-disk block that still carries backend + languagetool.
    installFetch({
      grammar: { ...baseGrammar(), backend: "languagetool", languagetool: { url: "http://lt:8081" } },
    });
    const { getByTestId, queryByTestId } = render(wrap(<GrammarSettings />));
    await waitFor(() => expect(getByTestId("grammar-debounce")).toBeTruthy());
    expect(queryByTestId("grammar-backend")).toBeNull();
    expect(queryByTestId("grammar-lt-url")).toBeNull();
    expect(getByTestId("grammar-llm-model-selector")).toBeTruthy();
  });

  it("shows the model-guidance hint + doc link by the picker (F6)", async () => {
    installFetch({ grammar: baseGrammar() });
    const { getByTestId } = render(wrap(<GrammarSettings />));
    await waitFor(() => expect(getByTestId("grammar-model-hint")).toBeTruthy());
    const link = getByTestId("grammar-model-guidance-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBeTruthy();
    expect(link.tagName).toBe("A");
  });

  it("links a model-guidance doc that exists in the repo (E10)", async () => {
    installFetch({ grammar: baseGrammar() });
    const { getByTestId } = render(wrap(<GrammarSettings />));
    await waitFor(() => expect(getByTestId("grammar-model-guidance-link")).toBeTruthy());
    const href = getByTestId("grammar-model-guidance-link").getAttribute("href") ?? "";
    // The link target resolves to a real docs/ page (repo-lint file-existence).
    const relPath = href.replace(/^\//, "");
    expect(relPath).toMatch(/^docs\/.+\.md$/);
    // vitest cwd is the repo root.
    expect(existsSync(resolve(process.cwd(), relPath))).toBe(true);
  });

  it("persists a model pick as grammar.llm = { provider, model } (one param, split on save)", async () => {
    const { putBodies } = installFetch({
      grammar: baseGrammar({ llm: { provider: "", model: "" } }),
    });
    const { getByTestId } = render(wrap(<GrammarSettings />));

    await waitFor(() => expect(getByTestId("grammar-llm-model-selector")).toBeTruthy());
    fireEvent.click(getByTestId("grammar-model-option-anthropic/claude-opus-4"));
    fireEvent.click(getByTestId("grammar-save"));

    await waitFor(() => expect(putBodies.length).toBe(1));
    expect(putBodies[0].llm).toEqual({ provider: "anthropic", model: "claude-opus-4" });
  });

  it("Save POSTs the grammar config to /api/config/plugins/grammar (E8)", async () => {
    const { putBodies } = installFetch({ grammar: baseGrammar() });
    const { getByTestId } = render(wrap(<GrammarSettings />));

    await waitFor(() => expect(getByTestId("grammar-debounce")).toBeTruthy());
    fireEvent.change(getByTestId("grammar-debounce"), { target: { value: "2000" } });
    fireEvent.click(getByTestId("grammar-save"));

    await waitFor(() => expect(putBodies.length).toBe(1));
    const body = putBodies[0];
    expect(body.debounceMs).toBe(2000);
    // No LanguageTool keys are ever written.
    expect(body.backend).toBeUndefined();
    expect(body.languagetool).toBeUndefined();
  });

  it("re-syncs the form to the server-clamped value after Save", async () => {
    installFetch({
      grammar: baseGrammar(),
      clamp: (g) => ({ ...g, debounceMs: Math.max(300, g.debounceMs) }),
    });
    const { getByTestId } = render(wrap(<GrammarSettings />));

    await waitFor(() => expect(getByTestId("grammar-debounce")).toBeTruthy());
    fireEvent.change(getByTestId("grammar-debounce"), { target: { value: "50" } });
    fireEvent.click(getByTestId("grammar-save"));

    await waitFor(() =>
      expect((getByTestId("grammar-debounce") as HTMLInputElement).value).toBe("300"),
    );
  });

  it("loads and saves the correction view (redline | list) (E8)", async () => {
    const { putBodies } = installFetch({ grammar: baseGrammar({ correctionView: "redline" }) });
    const { getByTestId } = render(wrap(<GrammarSettings />));
    await waitFor(() =>
      expect((getByTestId("grammar-correction-view") as HTMLSelectElement).value).toBe("redline"),
    );
    fireEvent.change(getByTestId("grammar-correction-view"), { target: { value: "list" } });
    fireEvent.click(getByTestId("grammar-save"));
    await waitFor(() => expect(putBodies.length).toBe(1));
    expect(putBodies[0].correctionView).toBe("list");
  });

  it("uses theme tokens for every color; unsaved marker is the warning token; no LT marker (F5)", async () => {
    installFetch({ grammar: baseGrammar() });
    const { getByTestId, queryByTestId } = render(wrap(<GrammarSettings />));
    await waitFor(() => expect(getByTestId("grammar-debounce")).toBeTruthy());
    fireEvent.change(getByTestId("grammar-debounce"), { target: { value: "2000" } });
    await waitFor(() => expect(getByTestId("grammar-dirty")).toBeTruthy());

    const section = getByTestId("grammar-settings");
    const literal = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/;
    const offenders = Array.from(section.querySelectorAll<HTMLElement>("[style]"))
      .map((el) => el.getAttribute("style") ?? "")
      .filter((s) => literal.test(s));
    expect(offenders).toEqual([]);

    expect(getByTestId("grammar-dirty").getAttribute("style")).toContain(
      "var(--severity-warning-fg)",
    );
    // No LanguageTool reachability marker exists any more.
    expect(queryByTestId("grammar-lt-health")).toBeNull();
  });

  it("gives every interactive control the shared focus-ring affordance", async () => {
    installFetch({ grammar: baseGrammar() });
    const { getByTestId } = render(wrap(<GrammarSettings />));
    await waitFor(() => expect(getByTestId("grammar-save")).toBeTruthy());
    for (const id of [
      "grammar-enabled",
      "grammar-autocheck",
      "grammar-capitalize",
      "grammar-correction-view",
      "grammar-debounce",
      "grammar-minchars",
      "grammar-maxchars",
      "grammar-language",
      "grammar-save",
      "grammar-reload",
    ]) {
      expect(getByTestId(id).classList.contains("focus-ring")).toBe(true);
    }
  });
});
