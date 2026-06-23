/**
 * CreateAutomationDialog (redesigned): grouped sections + Advanced disclosure,
 * two-level trigger picker, cron helper + next-run preview, ModelSelector /
 * @role model field, worktree git gating, and edit mode (update in place).
 *
 * api + ui-primitive mocked. See change: redesign-automation-editor-and-board.
 */
import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import {
  applyPluginConfigUpdate,
  PluginContextProvider,
  CurrentPluginLayer,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { UiModelSelectorProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { TriggerCategoryDescriptor, AutomationConfig } from "../shared/automation-types.js";

const { createAutomation, updateAutomation, listTriggerKinds, isGitCapable } = vi.hoisted(() => ({
  createAutomation: vi.fn(async (_b: any) => ({ ok: true as const })),
  updateAutomation: vi.fn(async (_b: any) => ({ ok: true as const })),
  listTriggerKinds: vi.fn(async (): Promise<TriggerCategoryDescriptor[]> => []),
  isGitCapable: vi.fn(async (_cwd?: string) => false),
}));
vi.mock("../client/api.js", () => ({ createAutomation, updateAutomation, listTriggerKinds, isGitCapable }));

import { CreateAutomationDialog } from "../client/CreateAutomationDialog.js";

const CATEGORIES: TriggerCategoryDescriptor[] = [
  { category: "scheduled", label: "Scheduled", status: "enabled", events: [] },
  {
    category: "openspec",
    label: "OpenSpec",
    status: "enabled",
    events: [
      { event: "change.archived", label: "Change archived", status: "enabled" },
      { event: "proposal.added", label: "Proposal added", status: "planned" },
    ],
  },
  { category: "git", label: "Git", status: "planned", events: [] },
];

function MockModelSelector({ models, onSelect }: UiModelSelectorProps) {
  return (
    <div>
      {(models ?? []).map((m) => {
        const label = `${m.provider}/${m.id}`;
        return (
          <button key={label} data-testid={`model-opt-${label}`} onClick={() => onSelect(label)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function wrap(node: React.ReactNode) {
  return withUiPrimitiveProvider(
    { "ui:model-selector": MockModelSelector },
    <PluginContextProvider registry={createSlotRegistry()} sessions={[]} send={() => {}}>
      <CurrentPluginLayer pluginId="automation">{node}</CurrentPluginLayer>
    </PluginContextProvider>,
  );
}

function seedRoles() {
  act(() => {
    applyPluginConfigUpdate({
      type: "plugin_config_update",
      id: "roles",
      config: {
        roles: { fast: "anthropic/claude-haiku-4-5", coding: "anthropic/claude-sonnet-4-5" },
        models: [{ provider: "anthropic", id: "claude-sonnet-4-5" }],
      },
    });
  });
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  listTriggerKinds.mockResolvedValue(CATEGORIES);
  isGitCapable.mockResolvedValue(false);
  seedRoles();
});

describe("CreateAutomationDialog (redesign)", () => {
  it("renders grouped sections with Advanced collapsed by default", async () => {
    const { getByTestId, queryByTestId } = render(wrap(<CreateAutomationDialog cwd="/repo" onClose={() => {}} />));
    expect(getByTestId("group-identity")).toBeTruthy();
    expect(getByTestId("group-trigger")).toBeTruthy();
    expect(getByTestId("group-action")).toBeTruthy();
    expect(queryByTestId("create-advanced")).toBeNull();
    fireEvent.click(getByTestId("create-advanced-toggle"));
    expect(getByTestId("create-advanced")).toBeTruthy();
  });

  it("writes the chosen @role to config", async () => {
    const { getByTestId } = render(wrap(<CreateAutomationDialog cwd="/repo" onClose={() => {}} />));
    fireEvent.change(getByTestId("create-name"), { target: { value: "weekly-brief" } });
    fireEvent.change(getByTestId("create-model-role"), { target: { value: "@coding" } });
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.model).toBe("@coding");
  });

  it("writes a specific model id chosen via the ModelSelector", async () => {
    const { getByTestId } = render(wrap(<CreateAutomationDialog cwd="/repo" onClose={() => {}} />));
    fireEvent.change(getByTestId("create-name"), { target: { value: "m" } });
    fireEvent.click(getByTestId("create-model-mode-model"));
    fireEvent.click(getByTestId("model-opt-anthropic/claude-sonnet-4-5"));
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.model).toBe("anthropic/claude-sonnet-4-5");
  });

  it("scheduled category shows a next-run preview and writes raw cron", async () => {
    const { getByTestId } = render(wrap(<CreateAutomationDialog cwd="/repo" onClose={() => {}} />));
    expect(getByTestId("create-next-run").textContent).toContain("Next run:");
    fireEvent.change(getByTestId("create-name"), { target: { value: "sched" } });
    fireEvent.click(getByTestId("create-cron-raw-toggle"));
    fireEvent.change(getByTestId("create-cron"), { target: { value: "30 8 * * 3" } });
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.on).toEqual({ kind: "schedule", cron: "30 8 * * 3" });
  });

  it("openspec category lists events, disables planned ones, and writes on.events", async () => {
    const { getByTestId } = render(wrap(<CreateAutomationDialog cwd="/repo" onClose={() => {}} />));
    await waitFor(() => expect(getByTestId("trigger-cat-openspec")).toBeTruthy());
    fireEvent.click(getByTestId("trigger-cat-openspec"));
    expect((getByTestId("create-event-proposal.added") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(getByTestId("create-name"), { target: { value: "os" } });
    fireEvent.click(getByTestId("create-event-change.archived"));
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.on).toEqual({
      kind: "openspec",
      events: ["change.archived"],
    });
  });

  it("blocks submission for a planned category", async () => {
    const { getByTestId } = render(wrap(<CreateAutomationDialog cwd="/repo" onClose={() => {}} />));
    await waitFor(() => expect(getByTestId("trigger-cat-git")).toBeTruthy());
    // planned tab is disabled; the create button stays disabled if forced selected.
    expect((getByTestId("trigger-cat-git") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows inline sandbox help in Advanced", async () => {
    const { getByTestId } = render(wrap(<CreateAutomationDialog cwd="/repo" onClose={() => {}} />));
    fireEvent.click(getByTestId("create-advanced-toggle"));
    expect(getByTestId("create-sandbox-help").textContent).toContain("Write inside the workspace");
    fireEvent.change(getByTestId("create-sandbox"), { target: { value: "read-only" } });
    expect(getByTestId("create-sandbox-help").textContent).toContain("No writes");
  });

  it("disables worktree for a non-git folder and enables it for a git folder", async () => {
    isGitCapable.mockResolvedValue(false);
    const { getByTestId, rerender } = render(wrap(<CreateAutomationDialog cwd="/repo" onClose={() => {}} />));
    fireEvent.click(getByTestId("create-advanced-toggle"));
    await waitFor(() => expect(getByTestId("create-worktree-hint")).toBeTruthy());
    const wtOption = () =>
      Array.from((getByTestId("create-mode") as HTMLSelectElement).options).find((o) => o.value === "worktree")!;
    expect(wtOption().disabled).toBe(true);

    cleanup();
    isGitCapable.mockResolvedValue(true);
    const r2 = render(wrap(<CreateAutomationDialog cwd="/repo" onClose={() => {}} />));
    fireEvent.click(r2.getByTestId("create-advanced-toggle"));
    await waitFor(() => {
      const opt = Array.from((r2.getByTestId("create-mode") as HTMLSelectElement).options).find((o) => o.value === "worktree")!;
      expect(opt.disabled).toBe(false);
    });
  });

  it("edit mode pre-loads config, locks the name, and saves via update", async () => {
    const initialConfig: AutomationConfig = {
      on: { kind: "schedule", cron: "0 6 * * *" },
      action: { kind: "prompt", prompt: "./prompt.md" },
      model: "@coding",
      mode: "local",
      sandbox: "read-only",
      concurrency: "queue",
      visibility: "shown",
    };
    const { getByTestId } = render(
      wrap(
        <CreateAutomationDialog
          cwd="/repo"
          onClose={() => {}}
          initialName="existing"
          initialScope="folder"
          initialConfig={initialConfig}
          initialPromptBody="do the thing"
        />,
      ),
    );
    expect((getByTestId("create-name") as HTMLInputElement).value).toBe("existing");
    expect((getByTestId("create-name") as HTMLInputElement).disabled).toBe(true);
    expect((getByTestId("create-model-role") as HTMLSelectElement).value).toBe("@coding");
    expect((getByTestId("create-prompt") as HTMLTextAreaElement).value).toBe("do the thing");
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(updateAutomation).toHaveBeenCalled());
    expect(createAutomation).not.toHaveBeenCalled();
    const body = updateAutomation.mock.calls[0]![0]!;
    expect(body.name).toBe("existing");
    expect(body.config.on).toEqual({ kind: "schedule", cron: "0 6 * * *" });
  });
});
