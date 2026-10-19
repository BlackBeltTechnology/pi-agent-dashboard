/**
 * AutomationSettings — the default model is chosen through the shared model
 * picker (`ui:model-selector`) over the roles plugin's catalogue, replacing the
 * old free-text `provider/model-id` input.
 *
 * Harness mirrors `CreateAutomationDialog.wiring.test.tsx`: `PluginContextProvider`
 * + `CurrentPluginLayer pluginId="automation"` + a stubbed `ui:model-selector`,
 * plus a `SettingsDraftProvider` so the host Save Bar can drive `commit`.
 * See change: model-picker-everywhere-favorites (test-plan E8–E12, F4, F5, X1, X2).
 */

import {
  createSlotRegistry,
  type RegisteredSource,
  SettingsDraftProvider,
  type SettingsDraftRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  applyPluginConfigUpdate,
  CurrentPluginLayer,
  PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type { UiModelSelectorProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type React from "react";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationSettings } from "../client/AutomationSettings.js";

/** Number of times the stub picker has rendered (drives the X2 loop check). */
let pickerRenders = 0;

/**
 * Stub `ui:model-selector`. Exposes the `current`/`models` it receives (via
 * data attributes) and a button per model that emits the `provider/id` label.
 */
function MockPicker({ models, current, onSelect }: UiModelSelectorProps) {
  pickerRenders += 1;
  return (
    <div
      data-testid="stub-model-picker"
      data-current={String(current)}
      data-model-count={models === undefined ? "undefined" : String(models.length)}
    >
      {(models ?? []).map((m) => {
        const label = `${m.provider}/${m.id}`;
        return (
          <button
            key={label}
            type="button"
            data-testid={`stub-pick-${label}`}
            onClick={() => onSelect(label)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

interface MountOpts {
  /** `roles` plugin config (the catalogue source). Default `{}`. */
  roles?: Record<string, unknown>;
  /** `automation` plugin config (this section's own draft baseline). Default `{}`. */
  automation?: Record<string, unknown>;
  /** Skip the pre-render roles seed (for the "roles never arrives" X2 case). */
  skipRolesSeed?: boolean;
}

/** Mount inside the draft provider + plugin context; expose the registered source. */
function mount(opts: MountOpts = {}) {
  const sources = new Map<string, RegisteredSource>();
  const registry: SettingsDraftRegistry = {
    upsert: (id, s) => sources.set(id, s),
    remove: (id) => {
      sources.delete(id);
    },
  };
  const send = vi.fn<(m: unknown) => Promise<void>>(() => Promise.resolve());

  act(() => {
    applyPluginConfigUpdate({ type: "plugin_config_update", id: "automation", config: opts.automation ?? {} });
    if (!opts.skipRolesSeed) {
      applyPluginConfigUpdate({ type: "plugin_config_update", id: "roles", config: opts.roles ?? {} });
    }
  });

  const ui = withUiPrimitiveProvider(
    { "ui:model-selector": MockPicker },
    <SettingsDraftProvider registry={registry}>
      <PluginContextProvider registry={createSlotRegistry()} sessions={[]} send={send}>
        <CurrentPluginLayer pluginId="automation">
          <AutomationSettings />
        </CurrentPluginLayer>
      </PluginContextProvider>
    </SettingsDraftProvider>,
  );
  const r = render(ui);

  const src = (): RegisteredSource => {
    const s = sources.get("plugin:automation");
    if (!s) throw new Error("plugin:automation never registered with the unified-Save registry");
    return s;
  };
  return { ...r, src, send, sources };
}

function writtenPayload(send: ReturnType<typeof mount>["send"]): Record<string, unknown> {
  const call = send.mock.calls.at(-1)?.[0] as
    | { type: string; id: string; config: Record<string, unknown> }
    | undefined;
  if (!call) throw new Error("no plugin_config_write was sent");
  expect(call.type).toBe("plugin_config_write");
  expect(call.id).toBe("automation");
  return call.config;
}

beforeEach(() => {
  pickerRenders = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("AutomationSettings — picker-backed default model", () => {
  it("E8: a pick emits provider/id and the host Save writes it", async () => {
    const { getByTestId, src, send } = mount({
      roles: { models: [{ provider: "anthropic", id: "x" }] },
      automation: { defaultModel: "" },
    });
    await waitFor(() => expect(getByTestId("stub-pick-anthropic/x")).toBeTruthy());

    fireEvent.click(getByTestId("stub-pick-anthropic/x"));
    await waitFor(() => expect(src().isDirty).toBe(true));
    await src().commit();

    expect(writtenPayload(send).defaultModel).toBe("anthropic/x");
  });

  it("E9: no free-text input remains inside the picker wrapper", () => {
    const { getByTestId } = mount({
      roles: { models: [{ provider: "anthropic", id: "x" }] },
      automation: { defaultModel: "" },
    });
    const wrapper = getByTestId("automation-default-model");
    expect(wrapper.querySelector('input[type="text"]')).toBeNull();
    expect(within(wrapper).getByTestId("stub-model-picker")).toBeTruthy();
  });

  it("E10: clear sets the draft to '' and shows the placeholder (undefined current)", async () => {
    const { getByTestId, src, send } = mount({
      roles: { models: [{ provider: "anthropic", id: "x" }] },
      automation: { defaultModel: "anthropic/x" },
    });
    const wrapper = getByTestId("automation-default-model");
    expect(within(wrapper).getByTestId("stub-model-picker").getAttribute("data-current")).toBe("anthropic/x");

    fireEvent.click(getByTestId("automation-default-model-clear"));
    // "" is normalised to undefined so the picker renders its placeholder.
    expect(within(wrapper).getByTestId("stub-model-picker").getAttribute("data-current")).toBe("undefined");

    await waitFor(() => expect(src().isDirty).toBe(true));
    await src().commit();
    expect(writtenPayload(send).defaultModel).toBe("");
  });

  it("E11: a stored value missing from the catalogue still shows as current", () => {
    const { getByTestId } = mount({
      roles: { models: [{ provider: "anthropic", id: "x" }] },
      automation: { defaultModel: "gone/model" },
    });
    expect(
      within(getByTestId("automation-default-model")).getByTestId("stub-model-picker").getAttribute("data-current"),
    ).toBe("gone/model");
  });

  it("E12: a legacy provider/id:level value is preserved untouched (not dirty)", () => {
    const { getByTestId, src } = mount({
      roles: { models: [{ provider: "anthropic", id: "x" }] },
      automation: { defaultModel: "anthropic/x:high" },
    });
    expect(
      within(getByTestId("automation-default-model")).getByTestId("stub-model-picker").getAttribute("data-current"),
    ).toBe("anthropic/x:high");
    expect(src().isDirty).toBe(false);
  });

  it("F4: the catalogue arriving after mount re-renders the picker without a remount", () => {
    const { getByTestId } = mount({
      roles: { models: [] },
      automation: { defaultModel: "" },
    });
    const before = within(getByTestId("automation-default-model")).getByTestId("stub-model-picker");
    expect(before.getAttribute("data-model-count")).toBe("0");

    act(() => {
      applyPluginConfigUpdate({
        type: "plugin_config_update",
        id: "roles",
        config: { models: [{ provider: "anthropic", id: "x" }] },
      });
    });

    const after = within(getByTestId("automation-default-model")).getByTestId("stub-model-picker");
    // Same DOM node — the picker filled in reactively, it was not remounted.
    expect(after).toBe(before);
    expect(after.getAttribute("data-model-count")).toBe("1");
  });

  it("F5: the picker trigger has no <label> ancestor (caption is a sibling)", () => {
    const { getByTestId } = mount({
      roles: { models: [{ provider: "anthropic", id: "x" }] },
      automation: { defaultModel: "" },
    });
    const trigger = within(getByTestId("automation-default-model")).getByTestId("stub-model-picker");
    expect(trigger.closest("label")).toBeNull();
  });

  it("X1: a roles config without `models` yields models=[] (not undefined), no throw, clear operable", () => {
    const { getByTestId, src } = mount({
      roles: {},
      automation: { defaultModel: "anthropic/x" },
    });
    const picker = within(getByTestId("automation-default-model")).getByTestId("stub-model-picker");
    expect(picker.getAttribute("data-model-count")).toBe("0");

    // Clear remains operable with an empty catalogue.
    expect(() => fireEvent.click(getByTestId("automation-default-model-clear"))).not.toThrow();
    expect(src().isDirty).toBe(true);
  });

  it("X2: roles config never arriving does not loop (picker renders ≤ 2×)", () => {
    mount({ skipRolesSeed: true, automation: { defaultModel: "" } });
    expect(pickerRenders).toBeLessThanOrEqual(2);
  });
});

describe("AutomationSettings — kit fields + retention validation", () => {
  const typeRetention = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

  // test-plan #E12: BVA on "Runs to keep": "" and 0 are invalid (no silent 100), 1 is valid.
  for (const c of [
    { value: "", invalid: true },
    { value: "0", invalid: true },
    { value: "1", invalid: false },
  ]) {
    it(`E12: retention ${JSON.stringify(c.value)} → ${c.invalid ? "field error, commit blocked" : "valid"}`, async () => {
      const { getByTestId, queryByRole, src, send } = mount({ automation: { retentionPerAutomation: 50 } });
      const input = getByTestId("automation-retention") as HTMLInputElement;
      typeRetention(input, c.value);
      if (c.invalid) {
        await waitFor(() => expect(queryByRole("alert")).not.toBeNull());
        expect(input.getAttribute("aria-invalid")).toBe("true");
        // No silent snap to 100.
        expect(input.value).toBe(c.value);
        await expect(src().commit()).rejects.toThrow();
        expect(send).not.toHaveBeenCalled();
      } else {
        expect(queryByRole("alert")).toBeNull();
        expect(input.getAttribute("aria-invalid")).toBeNull();
        await src().commit();
        expect(writtenPayload(send).retentionPerAutomation).toBe(1);
      }
    });
  }

  it("commit sends only the edited keys", async () => {
    const { getByTestId, src, send } = mount({ automation: { retentionPerAutomation: 50 } });
    typeRetention(getByTestId("automation-retention"), "7");
    await src().commit();
    expect(writtenPayload(send)).toEqual({ retentionPerAutomation: 7 });
  });

  it("scan scopes are kit switches, no native checkbox or select", async () => {
    const { getByTestId, container, src } = mount({});
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.querySelector("select")).not.toBeNull(); // SelectField is the kit's own
    const sw = getByTestId("automation-scan-folder");
    expect(sw.getAttribute("role")).toBe("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await waitFor(() => expect(src().isDirty).toBe(true));
    expect(getByTestId("automation-scan-folder").getAttribute("aria-checked")).toBe("false");
  });

  it("groups: Runs / Where automations are found / Model; picker sits inside a labelled field", () => {
    const { getByText, getByTestId } = mount({});
    getByText("Runs");
    getByText("Where automations are found");
    getByText("Model");
    const wrapper = getByTestId("automation-default-model");
    expect(wrapper.getAttribute("role")).toBe("group");
    expect(wrapper.getAttribute("aria-label")).toBe("Fallback model");
    expect(wrapper.getAttribute("aria-describedby")).toBeTruthy();
    expect(wrapper.closest("label")).toBeNull();
  });

  it("a clean draft adopts a late plugin_config_update", async () => {
    const { getByTestId } = mount({ automation: { retentionPerAutomation: 50 } });
    act(() => {
      applyPluginConfigUpdate({ type: "plugin_config_update", id: "automation", config: { retentionPerAutomation: 20 } });
    });
    await waitFor(() => expect((getByTestId("automation-retention") as HTMLInputElement).value).toBe("20"));
  });
});
