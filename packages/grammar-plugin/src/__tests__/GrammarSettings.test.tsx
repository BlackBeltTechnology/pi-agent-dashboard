/**
 * Tests for GrammarSettings — see change: add-grammar-settings-plugin.
 *
 * The plugin edits the CORE `config.grammar` block via GET/PUT /api/config
 * (NOT the plugins.<id>.* namespace), and reads LanguageTool reachability from
 * GET /api/grammar/health. These tests mock `fetch` and assert the read →
 * edit → save (with server-clamp re-sync) contract plus the reachability
 * indicator and backend-conditional LLM fields.
 */

import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  CurrentPluginLayer,
  PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type { GrammarConfig } from "../grammar-config.js";
import type { UiModelSelectorProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrammarSettings } from "../GrammarSettings.js";

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
    backend: "languagetool",
    autoCheck: true,
    debounceMs: 1200,
    minChars: 12,
    maxChars: 4000,
    language: "auto",
    capitalizeFirstWord: false,
    languagetool: { url: "http://localhost:8081" },
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/**
 * Install a routing fetch mock. `state.grammar` is the server-side truth;
 * `clamp` mutates a PUT'd block to emulate server clamping; `reachable`
 * drives the health probe.
 */
function installFetch(opts: {
  grammar: GrammarConfig;
  reachable?: boolean;
  clamp?: (g: GrammarConfig) => GrammarConfig;
}) {
  const state = { grammar: opts.grammar };
  const putBodies: any[] = [];
  const health = () =>
    jsonResponse({
      success: true,
      data: {
        ...state.grammar,
        languagetool: { url: state.grammar.languagetool.url, reachable: opts.reachable ?? true },
      },
    });
  const models = () =>
    jsonResponse({
      object: "list",
      data: [
        { id: "anthropic/claude-opus-4", provider: "anthropic" },
        { id: "openai/gpt-4o", provider: "openai" },
      ],
    });
  // Plugin config write: POST /api/config/plugins/grammar with the config as the
  // body (no `{ grammar }` wrapper). See change: make-grammar-fully-plugin-contained.
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
    if (url.endsWith("/api/grammar/health")) return health();
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
    expect((getByTestId("grammar-backend") as HTMLSelectElement).value).toBe("languagetool");
    expect((getByTestId("grammar-debounce") as HTMLInputElement).value).toBe("1500");
    expect((getByTestId("grammar-language") as HTMLInputElement).value).toBe("en-US");
    expect((getByTestId("grammar-lt-url") as HTMLInputElement).value).toBe(
      "http://localhost:8081",
    );
  });

  it("shows the disabled defaults when the config has no grammar block", async () => {
    const mock = vi.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.endsWith("/api/config") && method === "GET") {
        return jsonResponse({ success: true, data: {} });
      }
      if (url.endsWith("/api/grammar/health")) {
        return jsonResponse({ success: true, data: { languagetool: { reachable: false } } });
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
    expect((getByTestId("grammar-backend") as HTMLSelectElement).value).toBe("languagetool");
    expect((getByTestId("grammar-debounce") as HTMLInputElement).value).toBe("1200");
    expect((getByTestId("grammar-maxchars") as HTMLInputElement).value).toBe("4000");
  });

  it("uses ONE model selector for the llm backend (not two provider/model fields)", async () => {
    installFetch({ grammar: baseGrammar({ backend: "languagetool" }) });
    const { getByTestId, queryByTestId } = render(wrap(<GrammarSettings />));

    await waitFor(() => expect(getByTestId("grammar-backend")).toBeTruthy());
    expect(queryByTestId("grammar-llm-model-selector")).toBeNull();
    // The old two-field shape must be gone.
    expect(queryByTestId("grammar-llm-provider")).toBeNull();
    expect(queryByTestId("grammar-llm-model")).toBeNull();

    fireEvent.change(getByTestId("grammar-backend"), { target: { value: "llm" } });
    expect(getByTestId("grammar-llm-model-selector")).toBeTruthy();
    // Still no separate provider field — one selection.
    expect(queryByTestId("grammar-llm-provider")).toBeNull();
  });

  it("persists a model pick as grammar.llm = { provider, model } (one param, split on save)", async () => {
    const { putBodies } = installFetch({
      grammar: baseGrammar({ backend: "llm", llm: { provider: "", model: "" } }),
    });
    const { getByTestId } = render(wrap(<GrammarSettings />));

    await waitFor(() => expect(getByTestId("grammar-llm-model-selector")).toBeTruthy());
    fireEvent.click(getByTestId("grammar-model-option-anthropic/claude-opus-4"));
    fireEvent.click(getByTestId("grammar-save"));

    await waitFor(() => expect(putBodies.length).toBe(1));
    expect(putBodies[0].llm).toEqual({ provider: "anthropic", model: "claude-opus-4" });
  });

  it("Save POSTs the grammar config to /api/config/plugins/grammar", async () => {
    const { putBodies } = installFetch({ grammar: baseGrammar() });
    const { getByTestId } = render(wrap(<GrammarSettings />));

    await waitFor(() => expect(getByTestId("grammar-debounce")).toBeTruthy());
    fireEvent.change(getByTestId("grammar-debounce"), { target: { value: "2000" } });
    fireEvent.click(getByTestId("grammar-save"));

    await waitFor(() => expect(putBodies.length).toBe(1));
    // Body is the plugin config object itself (no `{ grammar }` wrapper).
    const body = putBodies[0];
    expect(body.debounceMs).toBe(2000);
    // Nested objects survive the write.
    expect(body.languagetool.url).toBe("http://localhost:8081");
  });

  it("re-syncs the form to the server-clamped value after Save", async () => {
    // Server clamps debounceMs up to a 300 floor.
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

  it("shows a reachable indicator when LanguageTool health is reachable", async () => {
    installFetch({ grammar: baseGrammar(), reachable: true });
    const { getByTestId } = render(wrap(<GrammarSettings />));
    await waitFor(() =>
      expect(getByTestId("grammar-lt-health").getAttribute("data-reachable")).toBe("true"),
    );
  });

  it("shows an unreachable indicator when LanguageTool health is unreachable", async () => {
    installFetch({ grammar: baseGrammar(), reachable: false });
    const { getByTestId } = render(wrap(<GrammarSettings />));
    await waitFor(() =>
      expect(getByTestId("grammar-lt-health").getAttribute("data-reachable")).toBe("false"),
    );
  });
});
