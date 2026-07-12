/**
 * Tests for BuiltInRolesSettings — see change fix-pi-flows-end-to-end (Group 5).
 *
 * Roles + models are GLOBAL in pi-flows / pi-coding-agent; the component
 * reads them via `usePluginConfig<BuiltinsConfig>()` after the WS layer
 * routes `roles_list` / `models_list` through `applyPluginConfigUpdate`.
 *
 * Covers:
 *   - Empty state when plugin config has no roles.
 *   - Renders preset row + role grid when config is populated.
 *   - Clicking a role + selecting a model dispatches `role_set` over the
 *     existing protocol (no new WS messages).
 *   - Preset save/load/delete dispatch the matching existing messages.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import React from "react";
import {
  PluginContextProvider,
  CurrentPluginLayer,
  applyPluginConfigUpdate,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { createSlotRegistry, SettingsDraftProvider, type RegisteredSource } from "@blackbelt-technology/dashboard-plugin-runtime";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type { UiModelSelectorProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import {
  BuiltInRolesSettings,
  inferProviderForBareId,
  computeEffectiveRoles,
  computeDirtyRoles,
  computeRoleGroups,
} from "../RolesSettingsSection.js";

/**
 * Mock `ui:model-selector` impl: renders one button per model with a
 * data-testid that matches the test expectations of the old inline picker
 * (`roles-model-option-<provider>/<id>`). onSelect fires with the full label.
 */
function MockModelSelector({ models, onSelect }: UiModelSelectorProps) {
  return (
    <div data-testid="mock-model-selector">
      {(models ?? []).map((m) => {
        const label = `${m.provider}/${m.id}`;
        return (
          <button
            key={label}
            data-testid={`roles-model-option-${label}`}
            onClick={() => onSelect(label)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

interface SendCapture {
  messages: unknown[];
  fn: (m: unknown) => void;
}

function makeSend(): SendCapture {
  const messages: unknown[] = [];
  return { messages, fn: (m: unknown) => messages.push(m) };
}

function wrap(
  children: React.ReactNode,
  send?: (m: unknown) => void,
  sources?: Map<string, RegisteredSource>,
) {
  const draft = {
    upsert: (id: string, s: RegisteredSource) => { sources?.set(id, s); },
    remove: (id: string) => { sources?.delete(id); },
  };
  return withUiPrimitiveProvider(
    { "ui:model-selector": MockModelSelector },
    <PluginContextProvider
      registry={createSlotRegistry()}
      sessions={[{ id: "sess-live", cwd: "/x", status: "idle" } as any]}
      send={send}
    >
      <SettingsDraftProvider registry={draft}>
        <CurrentPluginLayer pluginId="roles">{children}</CurrentPluginLayer>
      </SettingsDraftProvider>
    </PluginContextProvider>,
  );
}

const sampleConfig = {
  roles: { architect: "anthropic/claude-3-7-sonnet", planner: "openai/gpt-4o" },
  presets: [
    { name: "default", roles: { architect: "anthropic/claude-3-7-sonnet" } },
    { name: "cheap", roles: { architect: "openai/gpt-4o-mini" } },
  ],
  activePreset: "default" as string | null,
  models: [
    { provider: "anthropic", id: "claude-3-7-sonnet" },
    { provider: "openai", id: "gpt-4o" },
    { provider: "openai", id: "gpt-4o-mini" },
  ],
};

function seedConfig(cfg: Record<string, unknown>) {
  act(() => {
    applyPluginConfigUpdate({
      type: "plugin_config_update",
      id: "roles",
      config: cfg,
    });
  });
}

describe("BuiltInRolesSettings", () => {
  beforeEach(() => {
    seedConfig({});
  });
  afterEach(() => {
    cleanup();
    seedConfig({});
  });

  it("renders default role rows + setup banner when no role is assigned", () => {
    // Back-end overlays default role names (empty values) on a fresh install.
    seedConfig({
      roles: { planning: "", coding: "", compact: "", fast: "", vision: "", research: "" },
      presets: [],
      activePreset: null,
      models: [],
    });
    const { getByTestId, queryByTestId } = render(wrap(<BuiltInRolesSettings />));
    // Setup banner shown; legacy pi-flows empty-state gone.
    expect(getByTestId("roles-settings-setup-banner").textContent).toContain("set up now");
    expect(queryByTestId("roles-settings-empty")).toBeNull();
    // Default rows render, each with the unassigned "Add model" affordance.
    expect(getByTestId("roles-row-fast").textContent).toContain("Add model");
    expect(getByTestId("roles-row-planning")).toBeTruthy();
  });

  it("renders an added role as an empty slot and omits a removed default (effective schema)", () => {
    // Back-end overlay now keys off the effective schema (defaults \u222a added
    // \u2212 removed). The section transparently renders whatever roles arrive.
    // See change: add-agent-role-model-tools.
    seedConfig({
      roles: { planning: "", coding: "", compact: "", fast: "", research: "", review: "" },
      presets: [],
      activePreset: null,
      models: [],
    });
    const { getByTestId, queryByTestId } = render(wrap(<BuiltInRolesSettings />));
    // Added role appears as an empty slot.
    expect(getByTestId("roles-row-review").textContent).toContain("Add model");
    // Removed default (vision) is absent.
    expect(queryByTestId("roles-row-vision")).toBeNull();
  });

  it("hides the setup banner once a role has an assigned model", () => {
    seedConfig(sampleConfig);
    const { queryByTestId } = render(wrap(<BuiltInRolesSettings />));
    expect(queryByTestId("roles-settings-setup-banner")).toBeNull();
  });

  it("renders preset row + role grid when config is populated", () => {
    seedConfig(sampleConfig);
    const { getByTestId } = render(wrap(<BuiltInRolesSettings />));
    expect(getByTestId("roles-settings")).toBeTruthy();
    expect(getByTestId("roles-preset-load-default")).toBeTruthy();
    expect(getByTestId("roles-preset-load-cheap")).toBeTruthy();
    expect(getByTestId("roles-row-architect")).toBeTruthy();
    expect(getByTestId("roles-row-planner")).toBeTruthy();
  });

  it("clicking a role + picking a model stages pending; does NOT dispatch role_set", () => {
    // Deferred persistence: picks accumulate in local pending state.
    // Save click is what flushes them. See change:
    // defer-role-persistence-with-save-reload.
    const send = makeSend();
    seedConfig(sampleConfig);
    const { getByTestId } = render(wrap(<BuiltInRolesSettings />, send.fn));
    fireEvent.click(getByTestId("roles-row-architect"));
    expect(getByTestId("roles-model-picker")).toBeTruthy();
    fireEvent.click(getByTestId("roles-model-option-openai/gpt-4o"));
    // No WS dispatch yet — only pending updated.
    expect(send.messages).toEqual([]);
    // Dirty marker should be present on the architect pill.
    expect(getByTestId("roles-row-architect-dirty")).toBeTruthy();
  });

  describe("inferProviderForBareId (read-time migration)", () => {
    const liveModels = [
      { provider: "proxy", id: "deepseek-v4-flash" },
      { provider: "anthropic", id: "claude-3-7-sonnet" },
    ];

    it("passes through slash-form values unchanged", () => {
      expect(
        inferProviderForBareId("anthropic/claude-3-7-sonnet", liveModels),
      ).toBe("anthropic/claude-3-7-sonnet");
    });

    it("synthesises provider prefix when a live model id matches", () => {
      expect(inferProviderForBareId("deepseek-v4-flash", liveModels)).toBe(
        "proxy/deepseek-v4-flash",
      );
    });

    it("falls back to bare value when no live model matches", () => {
      expect(
        inferProviderForBareId("some-removed-model", liveModels),
      ).toBe("some-removed-model");
    });

    it("returns input unchanged when models list is empty", () => {
      expect(inferProviderForBareId("deepseek-v4-flash", [])).toBe(
        "deepseek-v4-flash",
      );
    });

    it("handles empty stored value", () => {
      expect(inferProviderForBareId("", liveModels)).toBe("");
    });
  });

  it("renders legacy bare-id role values with synthesised provider label", () => {
    seedConfig({
      roles: { planning: "deepseek-v4-flash" },
      models: [{ provider: "proxy", id: "deepseek-v4-flash" }],
    });
    const { getByTestId } = render(wrap(<BuiltInRolesSettings />));
    const pill = getByTestId("roles-row-planning");
    // Pill title carries the full migrated label; pill body shows the short tail.
    expect(pill.getAttribute("title")).toBe("proxy/deepseek-v4-flash");
  });

  it("renders bare-id role values verbatim when no live match", () => {
    seedConfig({
      roles: { planning: "deepseek-v4-flash" },
      models: [],
    });
    const { getByTestId } = render(wrap(<BuiltInRolesSettings />));
    const pill = getByTestId("roles-row-planning");
    expect(pill.getAttribute("title")).toBe("deepseek-v4-flash");
  });

  it("preset load dispatches role_preset_load with global session placeholder", () => {
    const send = makeSend();
    seedConfig(sampleConfig);
    const { getByTestId } = render(wrap(<BuiltInRolesSettings />, send.fn));
    fireEvent.click(getByTestId("roles-preset-load-cheap"));
    expect(send.messages).toEqual([
      { type: "role_preset_load", sessionId: "sess-live", presetName: "cheap" },
    ]);
  });

  it("preset delete dispatches role_preset_delete with global session placeholder", () => {
    const send = makeSend();
    seedConfig(sampleConfig);
    const { getByTestId } = render(wrap(<BuiltInRolesSettings />, send.fn));
    fireEvent.click(getByTestId("roles-preset-delete-cheap"));
    expect(send.messages).toEqual([
      { type: "role_preset_delete", sessionId: "sess-live", presetName: "cheap" },
    ]);
  });

  it("preset save dispatches role_preset_save with global session placeholder", () => {
    const send = makeSend();
    seedConfig(sampleConfig);
    const { getByTestId } = render(wrap(<BuiltInRolesSettings />, send.fn));
    fireEvent.click(getByTestId("roles-preset-save-new"));
    const input = getByTestId("roles-preset-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "experiment" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send.messages).toEqual([
      { type: "role_preset_save", sessionId: "sess-live", presetName: "experiment" },
    ]);
  });

  // ---------------------------------------------------------------------
  // Deferred persistence — change: defer-role-persistence-with-save-reload
  // ---------------------------------------------------------------------

  describe("pure helpers", () => {
    it("computeEffectiveRoles overlays pending on rolesMap", () => {
      expect(
        computeEffectiveRoles(
          { a: "x", b: "y" },
          { b: "y2", c: "z" },
        ),
      ).toEqual({ a: "x", b: "y2", c: "z" });
    });

    it("computeDirtyRoles returns empty when pending is empty", () => {
      expect(computeDirtyRoles({ a: "x" }, {})).toEqual([]);
    });

    it("computeDirtyRoles excludes round-tripped entries", () => {
      expect(
        computeDirtyRoles({ a: "x", b: "y" }, { a: "x", b: "y2" }),
      ).toEqual(["b"]);
    });

    it("computeDirtyRoles returns all differing keys", () => {
      expect(
        computeDirtyRoles({ a: "x", b: "y" }, { a: "x2", b: "y2" }).sort(),
      ).toEqual(["a", "b"]);
    });
  });

  describe("computeRoleGroups", () => {
    const BUILTINS = ["planning", "coding", "compact", "fast", "vision", "research"];

    it("splits union of rolesMap+pending into built-in vs custom", () => {
      const groups = computeRoleGroups(
        { planning: "a/b", coding: "", review: "c/d" },
        {},
        BUILTINS,
      );
      expect(groups.builtin).toEqual(["planning", "coding"]);
      expect(groups.custom).toEqual(["review"]);
    });

    it("orders built-ins by builtinRoleNames, not by rolesMap order", () => {
      const groups = computeRoleGroups({ fast: "", planning: "" }, {}, BUILTINS);
      expect(groups.builtin).toEqual(["planning", "fast"]);
    });

    it("sorts custom names stably (alphabetical)", () => {
      const groups = computeRoleGroups({ zeta: "", alpha: "" }, {}, BUILTINS);
      expect(groups.custom).toEqual(["alpha", "zeta"]);
    });

    it("includes a pending-only custom name in custom", () => {
      const groups = computeRoleGroups(
        { planning: "" },
        { "doubt-verifier-1": "anthropic/haiku" },
        BUILTINS,
      );
      expect(groups.builtin).toEqual(["planning"]);
      expect(groups.custom).toEqual(["doubt-verifier-1"]);
    });

    it("dedupes a name present in both rolesMap and pending", () => {
      const groups = computeRoleGroups(
        { review: "a/b" },
        { review: "c/d" },
        BUILTINS,
      );
      expect(groups.custom).toEqual(["review"]);
    });

    it("treats everything as custom when builtinRoleNames is empty", () => {
      const groups = computeRoleGroups({ planning: "", coding: "" }, {}, []);
      expect(groups.builtin).toEqual([]);
      expect(groups.custom).toEqual(["coding", "planning"]);
    });
  });

  describe("built-in / custom grouping (render)", () => {
    const groupedConfig = {
      roles: { planning: "anthropic/opus", coding: "", review: "openai/gpt-4o" },
      presets: [],
      activePreset: null,
      builtinRoleNames: ["planning", "coding", "compact", "fast", "vision", "research"],
      models: [{ provider: "openai", id: "gpt-4o" }],
    };

    it("renders labelled Built-in and Custom groups", () => {
      seedConfig(groupedConfig);
      const { getByTestId } = render(wrap(<BuiltInRolesSettings />));
      expect(getByTestId("roles-group-builtin")).toBeTruthy();
      expect(getByTestId("roles-group-custom")).toBeTruthy();
      // review is custom; planning is built-in
      expect(getByTestId("roles-group-custom").textContent).toContain("review");
      expect(getByTestId("roles-group-builtin").textContent).toContain("planning");
    });

    it("renders an existing custom role under the custom group", () => {
      seedConfig(groupedConfig);
      const { getByTestId } = render(wrap(<BuiltInRolesSettings />));
      expect(getByTestId("roles-row-review")).toBeTruthy();
    });
  });

  describe("add custom role flow", () => {
    const groupedConfig = {
      roles: { planning: "anthropic/opus", review: "openai/gpt-4o" },
      presets: [],
      activePreset: null,
      builtinRoleNames: ["planning", "coding", "compact", "fast", "vision", "research"],
      models: [
        { provider: "anthropic", id: "claude-3-7-sonnet" },
        { provider: "openai", id: "gpt-4o" },
      ],
    };

    it("reveals a name input, validates live, opens picker, stages pending, no dispatch", () => {
      const send = makeSend();
      seedConfig(groupedConfig);
      const { getByTestId } = render(wrap(<BuiltInRolesSettings />, send.fn));
      fireEvent.click(getByTestId("roles-add-custom"));
      const input = getByTestId("roles-add-custom-input") as HTMLInputElement;

      // Invalid name → ✗ hint + disabled confirm.
      fireEvent.change(input, { target: { value: "bad/name" } });
      expect(getByTestId("roles-add-custom-hint")).toBeTruthy();
      expect((getByTestId("roles-add-custom-confirm") as HTMLButtonElement).disabled).toBe(true);

      // Collision with a built-in → still invalid.
      fireEvent.change(input, { target: { value: "planning" } });
      expect((getByTestId("roles-add-custom-confirm") as HTMLButtonElement).disabled).toBe(true);

      // Valid name → confirm enabled.
      fireEvent.change(input, { target: { value: "doubt-verifier-1" } });
      expect((getByTestId("roles-add-custom-confirm") as HTMLButtonElement).disabled).toBe(false);

      // Enter opens the model picker scoped to the new name.
      fireEvent.keyDown(input, { key: "Enter" });
      expect(getByTestId("roles-model-picker").textContent).toContain("doubt-verifier-1");

      // Selecting a model stages pending; NO dispatch yet.
      fireEvent.click(getByTestId("roles-model-option-openai/gpt-4o"));
      expect(send.messages).toEqual([]);

      // New pill renders in the custom group with a dirty marker.
      expect(getByTestId("roles-row-doubt-verifier-1")).toBeTruthy();
      expect(getByTestId("roles-row-doubt-verifier-1-dirty")).toBeTruthy();
      expect(getByTestId("roles-group-custom").textContent).toContain("doubt-verifier-1");
    });

    it("unified Save flushes one role_set carrying the full provider/id", async () => {
      const send = makeSend();
      const sources = new Map<string, RegisteredSource>();
      seedConfig(groupedConfig);
      const { getByTestId } = render(wrap(<BuiltInRolesSettings />, send.fn, sources));
      fireEvent.click(getByTestId("roles-add-custom"));
      const input = getByTestId("roles-add-custom-input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "doubt-verifier-x" } });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.click(getByTestId("roles-model-option-anthropic/claude-3-7-sonnet"));
      await act(async () => { await sources.get("plugin:roles")!.commit(); });
      expect(send.messages).toHaveLength(1);
      expect(send.messages[0]).toMatchObject({
        type: "role_set",
        role: "doubt-verifier-x",
        provider: "anthropic",
        modelId: "anthropic/claude-3-7-sonnet",
      });
    });

    it("Escape cancels the add input and stages nothing", () => {
      const send = makeSend();
      seedConfig(groupedConfig);
      const { getByTestId, queryByTestId } = render(wrap(<BuiltInRolesSettings />, send.fn));
      fireEvent.click(getByTestId("roles-add-custom"));
      const input = getByTestId("roles-add-custom-input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "scratch" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(queryByTestId("roles-add-custom-input")).toBeNull();
      expect(queryByTestId("roles-row-scratch")).toBeNull();
      expect(send.messages).toEqual([]);
    });

    it("the ✕ cancel button dismisses the input and stages nothing", () => {
      const send = makeSend();
      seedConfig(groupedConfig);
      const { getByTestId, queryByTestId } = render(wrap(<BuiltInRolesSettings />, send.fn));
      fireEvent.click(getByTestId("roles-add-custom"));
      fireEvent.change(getByTestId("roles-add-custom-input"), { target: { value: "scratch" } });
      fireEvent.click(getByTestId("roles-add-custom-cancel"));
      expect(queryByTestId("roles-add-custom-input")).toBeNull();
      expect(send.messages).toEqual([]);
    });
  });

  describe("remove custom role", () => {
    const groupedConfig = {
      roles: { planning: "anthropic/opus", review: "openai/gpt-4o" },
      presets: [],
      activePreset: null,
      builtinRoleNames: ["planning", "coding", "compact", "fast", "vision", "research"],
      models: [
        { provider: "openai", id: "gpt-4o" },
        { provider: "openai", id: "gpt-4o-mini" },
      ],
    };

    it("renders × on custom pills only, never on built-in pills", () => {
      seedConfig(groupedConfig);
      const { getByTestId, queryByTestId } = render(wrap(<BuiltInRolesSettings />));
      expect(getByTestId("roles-row-review-remove")).toBeTruthy();
      expect(queryByTestId("roles-row-planning-remove")).toBeNull();
    });

    it("renders NO × on any pill when builtinRoleNames is empty (old-bridge back-compat)", () => {
      // Without the built-in set we can't tell built-ins from custom, so per the
      // "built-ins permanent" decision nothing is removable in flat mode.
      seedConfig({
        roles: { planning: "anthropic/opus", review: "openai/gpt-4o" },
        presets: [],
        activePreset: null,
        models: [{ provider: "openai", id: "gpt-4o" }],
      });
      const { queryByTestId } = render(wrap(<BuiltInRolesSettings />));
      expect(queryByTestId("roles-row-review-remove")).toBeNull();
      expect(queryByTestId("roles-row-planning-remove")).toBeNull();
    });

    it("clicking × + confirm dispatches role_remove", () => {
      const send = makeSend();
      seedConfig(groupedConfig);
      const orig = window.confirm;
      (window as any).confirm = () => true;
      try {
        const { getByTestId } = render(wrap(<BuiltInRolesSettings />, send.fn));
        fireEvent.click(getByTestId("roles-row-review-remove"));
        expect(send.messages).toEqual([
          { type: "role_remove", sessionId: "sess-live", role: "review" },
        ]);
      } finally {
        window.confirm = orig;
      }
    });

    it("clicking × + cancel dispatches nothing", () => {
      const send = makeSend();
      seedConfig(groupedConfig);
      const orig = window.confirm;
      (window as any).confirm = () => false;
      try {
        const { getByTestId } = render(wrap(<BuiltInRolesSettings />, send.fn));
        fireEvent.click(getByTestId("roles-row-review-remove"));
        expect(send.messages).toEqual([]);
      } finally {
        window.confirm = orig;
      }
    });

    it("removing drops any staged pending pick for that role", () => {
      const send = makeSend();
      seedConfig(groupedConfig);
      const orig = window.confirm;
      (window as any).confirm = () => true;
      try {
        const { getByTestId, queryByTestId } = render(wrap(<BuiltInRolesSettings />, send.fn));
        // Stage a dirty pending pick on review (different model).
        fireEvent.click(getByTestId("roles-row-review"));
        fireEvent.click(getByTestId("roles-model-option-openai/gpt-4o-mini"));
        expect(getByTestId("roles-row-review-dirty")).toBeTruthy();
        // Remove → pending dropped; role_remove dispatched.
        fireEvent.click(getByTestId("roles-row-review-remove"));
        expect(queryByTestId("roles-row-review-dirty")).toBeNull();
        expect(send.messages).toEqual([
          { type: "role_remove", sessionId: "sess-live", role: "review" },
        ]);
      } finally {
        window.confirm = orig;
      }
    });
  });

  describe("Save / Reload / dirty tracking", () => {
    it("picking the persisted value back clears the dirty marker", () => {
      const send = makeSend();
      seedConfig(sampleConfig);
      const { getByTestId, queryByTestId } = render(
        wrap(<BuiltInRolesSettings />, send.fn),
      );
      fireEvent.click(getByTestId("roles-row-architect"));
      // Pick a different model first
      fireEvent.click(getByTestId("roles-model-option-openai/gpt-4o"));
      expect(getByTestId("roles-row-architect-dirty")).toBeTruthy();
      // Re-open picker and pick the original
      fireEvent.click(getByTestId("roles-row-architect"));
      fireEvent.click(
        getByTestId("roles-model-option-anthropic/claude-3-7-sonnet"),
      );
      expect(queryByTestId("roles-row-architect-dirty")).toBeNull();
      // Still no dispatch.
      expect(send.messages).toEqual([]);
    });

    it("unified Save commit() dispatches one role_set per dirty role and clears pending", async () => {
      const send = makeSend();
      const sources = new Map<string, RegisteredSource>();
      seedConfig(sampleConfig);
      const { getByTestId, queryByTestId } = render(
        wrap(<BuiltInRolesSettings />, send.fn, sources),
      );
      // Pick architect → openai/gpt-4o
      fireEvent.click(getByTestId("roles-row-architect"));
      fireEvent.click(getByTestId("roles-model-option-openai/gpt-4o"));
      // Pick planner → openai/gpt-4o-mini
      fireEvent.click(getByTestId("roles-row-planner"));
      fireEvent.click(getByTestId("roles-model-option-openai/gpt-4o-mini"));
      expect(sources.get("plugin:roles")?.isDirty).toBe(true);
      // The host's unified Save commits the buffered picks.
      await act(async () => { await sources.get("plugin:roles")!.commit(); });
      // Two role_set dispatches (order is by Object.keys, which preserves
      // insertion for plain objects in modern V8 — but we don't depend
      // on it; sort both sides).
      const calls = (send.messages as Array<{ role: string }>).map(
        (m) => m.role,
      );
      expect(calls.sort()).toEqual(["architect", "planner"]);
      const archMsg = (send.messages as any[]).find(
        (m) => m.role === "architect",
      );
      expect(archMsg).toMatchObject({
        type: "role_set",
        sessionId: "sess-live",
        role: "architect",
        provider: "openai",
        modelId: "openai/gpt-4o",
      });
      // Dirty markers gone.
      expect(queryByTestId("roles-row-architect-dirty")).toBeNull();
      expect(queryByTestId("roles-row-planner-dirty")).toBeNull();
    });

    it("with no dirty roles the source is clean and commit() dispatches nothing", async () => {
      const send = makeSend();
      const sources = new Map<string, RegisteredSource>();
      seedConfig(sampleConfig);
      render(wrap(<BuiltInRolesSettings />, send.fn, sources));
      expect(sources.get("plugin:roles")?.isDirty).toBe(false);
      await act(async () => { await sources.get("plugin:roles")!.commit(); });
      expect(send.messages).toEqual([]);
    });

    it("reset() discards pending without dispatching", () => {
      const send = makeSend();
      const sources = new Map<string, RegisteredSource>();
      seedConfig(sampleConfig);
      const { getByTestId, queryByTestId } = render(
        wrap(<BuiltInRolesSettings />, send.fn, sources),
      );
      fireEvent.click(getByTestId("roles-row-architect"));
      fireEvent.click(getByTestId("roles-model-option-openai/gpt-4o"));
      expect(getByTestId("roles-row-architect-dirty")).toBeTruthy();
      act(() => { sources.get("plugin:roles")!.reset(); });
      expect(send.messages).toEqual([]);
      expect(queryByTestId("roles-row-architect-dirty")).toBeNull();
    });

    it("incoming roles_list auto-cleans matching pending entries", () => {
      const send = makeSend();
      seedConfig(sampleConfig);
      const { getByTestId, queryByTestId } = render(
        wrap(<BuiltInRolesSettings />, send.fn),
      );
      // Stage a pick
      fireEvent.click(getByTestId("roles-row-architect"));
      fireEvent.click(getByTestId("roles-model-option-openai/gpt-4o"));
      expect(getByTestId("roles-row-architect-dirty")).toBeTruthy();
      // Server now reports the same value — auto-clean.
      seedConfig({
        ...sampleConfig,
        roles: { ...sampleConfig.roles, architect: "openai/gpt-4o" },
      });
      expect(queryByTestId("roles-row-architect-dirty")).toBeNull();
    });

    it("incoming roles_list preserves conflicting pending entries", () => {
      const send = makeSend();
      seedConfig(sampleConfig);
      const { getByTestId } = render(
        wrap(<BuiltInRolesSettings />, send.fn),
      );
      // Stage a pick for architect
      fireEvent.click(getByTestId("roles-row-architect"));
      fireEvent.click(getByTestId("roles-model-option-openai/gpt-4o"));
      // Server delivers a DIFFERENT third-party value
      seedConfig({
        ...sampleConfig,
        roles: {
          ...sampleConfig.roles,
          architect: "openai/gpt-4o-mini",
        },
      });
      // Dirty marker remains; pending preserved.
      expect(getByTestId("roles-row-architect-dirty")).toBeTruthy();
    });

    it("preset Load while dirty prompts; cancel preserves pending", () => {
      const send = makeSend();
      seedConfig(sampleConfig);
      const orig = window.confirm;
      (window as any).confirm = () => false;
      try {
        const { getByTestId } = render(
          wrap(<BuiltInRolesSettings />, send.fn),
        );
        fireEvent.click(getByTestId("roles-row-architect"));
        fireEvent.click(getByTestId("roles-model-option-openai/gpt-4o"));
        fireEvent.click(getByTestId("roles-preset-load-cheap"));
        // No dispatch — user cancelled
        expect(send.messages).toEqual([]);
        // Dirty marker preserved
        expect(getByTestId("roles-row-architect-dirty")).toBeTruthy();
      } finally {
        window.confirm = orig;
      }
    });

    it("preset Load while dirty confirms; confirm clears pending and dispatches", () => {
      const send = makeSend();
      seedConfig(sampleConfig);
      const orig = window.confirm;
      (window as any).confirm = () => true;
      try {
        const { getByTestId, queryByTestId } = render(
          wrap(<BuiltInRolesSettings />, send.fn),
        );
        fireEvent.click(getByTestId("roles-row-architect"));
        fireEvent.click(getByTestId("roles-model-option-openai/gpt-4o"));
        fireEvent.click(getByTestId("roles-preset-load-cheap"));
        expect(send.messages).toEqual([
          { type: "role_preset_load", sessionId: "sess-live", presetName: "cheap" },
        ]);
        expect(queryByTestId("roles-row-architect-dirty")).toBeNull();
      } finally {
        window.confirm = orig;
      }
    });

    it("preset Save while dirty dispatches role_set first then role_preset_save", () => {
      const send = makeSend();
      seedConfig(sampleConfig);
      const { getByTestId } = render(
        wrap(<BuiltInRolesSettings />, send.fn),
      );
      // Stage a pick
      fireEvent.click(getByTestId("roles-row-architect"));
      fireEvent.click(getByTestId("roles-model-option-openai/gpt-4o"));
      // Hint should appear before user confirms preset name
      fireEvent.click(getByTestId("roles-preset-save-new"));
      expect(getByTestId("roles-preset-save-dirty-hint")).toBeTruthy();
      // Type a name and confirm
      const input = getByTestId("roles-preset-name-input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "hybrid" } });
      fireEvent.keyDown(input, { key: "Enter" });
      // role_set dispatched FIRST, then role_preset_save
      expect(send.messages.length).toBe(2);
      expect((send.messages[0] as any).type).toBe("role_set");
      expect((send.messages[1] as any)).toEqual({
        type: "role_preset_save",
        sessionId: "sess-live",
        presetName: "hybrid",
      });
    });
  });
});
