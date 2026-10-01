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

describe("HermesMemorySettings", () => {
  it("shows the resolved default value + a DEFAULT badge for an unset field", async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => jsonOk(allDefaultEffective()));
    const { getByTestId } = render(<HermesMemorySettings />);
    await waitFor(() => expect(getByTestId("hermes-input-nudgeInterval")).toBeTruthy());
    expect((getByTestId("hermes-input-nudgeInterval") as HTMLInputElement).value).toBe("10");
    expect(getByTestId("hermes-default-badge-nudgeInterval")).toBeTruthy();
  });

  it("reset returns a changed field to its default and re-badges it", async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => jsonOk(allDefaultEffective()));
    const { getByTestId, queryByTestId } = render(<HermesMemorySettings />);
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
    const { getByTestId } = render(
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
});
