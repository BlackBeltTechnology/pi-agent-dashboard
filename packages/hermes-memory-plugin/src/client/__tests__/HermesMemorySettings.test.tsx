/**
 * Component tests (spec: "Settings form shows current value or default").
 * Unset field → default value + DEFAULT badge; reset returns a changed field to
 * default; save issues a PUT with the full resolved config.
 * See change: add-hermes-memory-settings-plugin.
 */
import {
  type RegisteredSource,
  SettingsDraftProvider,
  type SettingsDraftRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS, KNOWN_KEYS } from "../../shared/hermes-config.js";
import { HermesMemorySettings } from "../HermesMemorySettings.js";
import type { EffectiveConfig } from "../hermes-api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Build an all-default effective config (file absent). */
function allDefaultEffective(over: Record<string, { value: unknown; default: unknown; isDefault: boolean }> = {}): EffectiveConfig {
  const fields: EffectiveConfig["fields"] = {};
  for (const key of KNOWN_KEYS) {
    const def = (DEFAULTS as Record<string, unknown>)[key];
    fields[key] = { value: def, default: def, isDefault: true };
  }
  return { filePath: "/tmp/agent/hermes-memory-config.json", exists: false, raw: {}, fields: { ...fields, ...over } };
}

function jsonOk(body: unknown): Response {
  return { ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as unknown as Response;
}

function MockModelSelector(props: { current?: string; models: Array<{ provider: string; id: string }>; onSelect: (l: string) => void }) {
  return (
    <div data-testid="mock-model-selector" data-current={props.current ?? ""}>
      {props.models.map((m) => (
        <button key={`${m.provider}/${m.id}`} type="button" onClick={() => props.onSelect(`${m.provider}/${m.id}`)}>
          {`${m.provider}/${m.id}`}
        </button>
      ))}
    </div>
  );
}


/** Every mount sits inside the UI-primitive provider, as in the real dashboard shell. */
function renderH(ui: React.ReactElement) {
  return render(withUiPrimitiveProvider({ "ui:model-selector": MockModelSelector as never }, ui));
}

describe("HermesMemorySettings", () => {
  it("shows the resolved default value + a DEFAULT badge for an unset field", async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => jsonOk(allDefaultEffective()));
    const { getByTestId } = renderH(<HermesMemorySettings />);
    await waitFor(() => expect(getByTestId("hermes-input-nudgeInterval")).toBeTruthy());
    expect((getByTestId("hermes-input-nudgeInterval") as HTMLInputElement).value).toBe("10");
    expect(getByTestId("hermes-default-badge-nudgeInterval")).toBeTruthy();
  });

  it("reset returns a changed field to its default and re-badges it", async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => jsonOk(allDefaultEffective()));
    const { getByTestId, queryByTestId } = renderH(<HermesMemorySettings />);
    await waitFor(() => expect(getByTestId("hermes-input-nudgeInterval")).toBeTruthy());

    fireEvent.change(getByTestId("hermes-input-nudgeInterval"), { target: { value: "20" } });
    await waitFor(() => expect(getByTestId("hermes-reset-nudgeInterval")).toBeTruthy());
    expect(queryByTestId("hermes-default-badge-nudgeInterval")).toBeNull();

    fireEvent.click(getByTestId("hermes-reset-nudgeInterval"));
    await waitFor(() => expect(getByTestId("hermes-default-badge-nudgeInterval")).toBeTruthy());
    expect((getByTestId("hermes-input-nudgeInterval") as HTMLInputElement).value).toBe("10");
  });

  it("save (host Save Bar commit) issues a PUT with the full resolved config including the edit", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonOk(allDefaultEffective()));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    // The section owns no Save button: it registers with the host's unified
    // Save Bar (plugin-settings-pages D5). Drive the registered source's
    // `commit`, exactly as the host does.
    const sources = new Map<string, RegisteredSource>();
    const registry: SettingsDraftRegistry = {
      upsert: (id, src) => sources.set(id, src),
      remove: (id) => {
        sources.delete(id);
      },
    };
    const { getByTestId } = renderH(
      <SettingsDraftProvider registry={registry}>
        <HermesMemorySettings />
      </SettingsDraftProvider>,
    );
    await waitFor(() => expect(getByTestId("hermes-input-nudgeInterval")).toBeTruthy());

    fireEvent.change(getByTestId("hermes-input-nudgeInterval"), { target: { value: "20" } });
    await waitFor(() => expect(sources.get("plugin:hermes-memory")?.isDirty).toBe(true));
    await sources.get("plugin:hermes-memory")!.commit();

    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "PUT")).toBe(true);
    const putCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT");
    const sent = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(sent.nudgeInterval).toBe(20);
    // full resolved config: a non-edited defaulted field is also present
    expect(sent.memoryMode).toBe("policy-only");
  });

  // ── llmModelOverride uses the shared model selector (change add-context-mode-settings-plugin) ──
  describe("model override selector", () => {
    function mountWithModels(effective: EffectiveConfig) {
      const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
        url === "/api/models"
          ? jsonOk({ data: [{ id: "anthropic/claude-sonnet-4", provider: "anthropic" }] })
          : jsonOk(effective),
      );
      (globalThis as { fetch?: unknown }).fetch = fetchMock;
      const sources = new Map<string, RegisteredSource>();
      const registry: SettingsDraftRegistry = {
        upsert: (id, src) => sources.set(id, src),
        remove: (id) => {
          sources.delete(id);
        },
      };
      const r = render(
        withUiPrimitiveProvider(
          { "ui:model-selector": MockModelSelector as never },
          <SettingsDraftProvider registry={registry}>
            <HermesMemorySettings />
          </SettingsDraftProvider>,
        ),
      );
      return { ...r, fetchMock, sources };
    }

    const put = (fetchMock: ReturnType<typeof vi.fn>) => {
      const c = fetchMock.mock.calls.find((x) => (x[1] as RequestInit | undefined)?.method === "PUT");
      return c ? (JSON.parse((c[1] as RequestInit).body as string) as Record<string, unknown>) : undefined;
    };

    it("E18: stored value (in list or not) is the selector's current and round-trips on save", async () => {
      for (const stored of ["anthropic/claude-sonnet-4", "openrouter/deepseek/deepseek-v4-flash"]) {
        cleanup();
        const { findByTestId, getByTestId, sources, fetchMock } = mountWithModels(
          allDefaultEffective({ llmModelOverride: { value: stored, default: undefined, isDefault: false } }),
        );
        await findByTestId("mock-model-selector");
        expect(getByTestId("mock-model-selector").getAttribute("data-current")).toBe(stored);
        // force a dirty state via another field so commit has something to write
        fireEvent.change(getByTestId("hermes-input-nudgeInterval"), { target: { value: "20" } });
        await waitFor(() => expect(sources.get("plugin:hermes-memory")?.isDirty).toBe(true));
        await sources.get("plugin:hermes-memory")!.commit();
        expect(put(fetchMock)?.llmModelOverride).toBe(stored);
      }
    });

    it("E18: picking a model writes provider/id", async () => {
      const { findByText, sources, fetchMock } = mountWithModels(allDefaultEffective());
      fireEvent.click(await findByText("anthropic/claude-sonnet-4"));
      await waitFor(() => expect(sources.get("plugin:hermes-memory")?.isDirty).toBe(true));
      await sources.get("plugin:hermes-memory")!.commit();
      expect(put(fetchMock)?.llmModelOverride).toBe("anthropic/claude-sonnet-4");
    });

    it("E19: Inherit session model restores DEFAULT and omits the key on save", async () => {
      const { findByTestId, getByTestId, queryByTestId, sources, fetchMock } = mountWithModels(
        allDefaultEffective({ llmModelOverride: { value: "anthropic/claude-sonnet-4", default: undefined, isDefault: false } }),
      );
      fireEvent.click(await findByTestId("hermes-inherit-llmModelOverride"));
      await waitFor(() => expect(getByTestId("hermes-default-badge-llmModelOverride")).toBeTruthy());
      expect(queryByTestId("hermes-reset-llmModelOverride")).toBeNull();
      await waitFor(() => expect(sources.get("plugin:hermes-memory")?.isDirty).toBe(true));
      await sources.get("plugin:hermes-memory")!.commit();
      expect(put(fetchMock)).not.toHaveProperty("llmModelOverride");
    });
  });
});
