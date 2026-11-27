/**
 * AutomationEditor (inline board editor): grouped sections +
 * Advanced disclosure, two-level trigger picker, cron helper + next-run
 * preview, ModelSelector / @role model field, worktree git gating, edit mode
 * (update in place, keeps keys the form does not own) and the save bar.
 *
 * api + ui-primitive mocked. See change: redesign-automation-editor-and-board,
 * inline-automation-editor.
 */

import { applyPluginConfigUpdate, CurrentPluginLayer, createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type {
  UiModelSelectorProps,
  UiThinkingLevelSelectorProps,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationConfig, TriggerCategoryDescriptor } from "../shared/automation-types.js";

const { createAutomation, updateAutomation, listTriggerKinds, isGitCapable, listActions } = vi.hoisted(() => ({
  createAutomation: vi.fn(async (_b: any) => ({ ok: true as const })),
  updateAutomation: vi.fn(async (_b: any) => ({ ok: true as const })),
  listTriggerKinds: vi.fn(async (): Promise<TriggerCategoryDescriptor[]> => []),
  isGitCapable: vi.fn(async (_cwd?: string) => false),
  listActions: vi.fn(async (_cwd?: string) => [] as any[]),
}));
vi.mock("../client/api.js", () => ({ createAutomation, updateAutomation, listTriggerKinds, isGitCapable, listActions }));

import { AutomationEditor } from "../client/AutomationEditor.js";

/** The form is disabled until the git probe settles and the baseline freezes. */
const editorReady = () =>
  waitFor(() => expect(document.querySelector('[data-testid="editor-loading"]')).toBeNull());

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

// Stand-in for the shell primitive: with `allowRoles` it exposes a Role tab's
// worth of rows (built-in + the custom `nightly`) that emit bare `@role`.
// See change: add-role-aware-model-refs.
const MOCK_ROLES = ["fast", "coding", "nightly"];
function MockModelSelector({ models, onSelect, current, allowRoles }: UiModelSelectorProps) {
  return (
    <div data-testid="mock-model-selector" data-current={current ?? ""} data-allow-roles={String(!!allowRoles)}>
      {allowRoles &&
        MOCK_ROLES.map((r) => (
          <button key={r} data-testid={`role-opt-${r}`} onClick={() => onSelect(`@${r}`)}>
            @{r}
          </button>
        ))}
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

function MockThinkingLevelSelector({ current, onSelect, supportedLevels }: UiThinkingLevelSelectorProps) {
  return (
    <div data-testid="mock-thinking-level" data-current={current ?? ""}>
      {(supportedLevels ?? ["off", "low", "medium", "high"]).map((l) => (
        <button key={l} data-testid={`level-opt-${l}`} onClick={() => onSelect(l)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function wrap(node: React.ReactNode) {
  return withUiPrimitiveProvider(
    {
      "ui:model-selector": MockModelSelector,
      "ui:thinking-level-selector": MockThinkingLevelSelector,
    },
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
        models: [
          {
            provider: "anthropic",
            id: "claude-sonnet-4-5",
            supportedThinkingLevels: ["off", "medium", "high"],
          },
        ],
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

describe("AutomationEditor (redesign)", () => {
  it("renders grouped sections with Advanced collapsed by default", async () => {
    const { getByTestId, queryByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    expect(getByTestId("group-identity")).toBeTruthy();
    expect(getByTestId("group-trigger")).toBeTruthy();
    expect(getByTestId("group-action")).toBeTruthy();
    expect(queryByTestId("create-advanced")).toBeNull();
    fireEvent.click(getByTestId("create-advanced-toggle"));
    expect(getByTestId("create-advanced")).toBeTruthy();
  });

  it("writes the chosen @role to config", async () => {
    const { getByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    fireEvent.change(getByTestId("create-name"), { target: { value: "weekly-brief" } });
    fireEvent.click(getByTestId("role-opt-coding"));
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.model).toBe("@coding");
  });

  it("writes a specific model id chosen via the ModelSelector", async () => {
    const { getByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    fireEvent.change(getByTestId("create-name"), { target: { value: "m" } });
    fireEvent.click(getByTestId("model-opt-anthropic/claude-sonnet-4-5"));
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.model).toBe("anthropic/claude-sonnet-4-5");
  });

  it("scheduled category shows a next-run preview and writes raw cron", async () => {
    const { getByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    expect(getByTestId("create-next-run").textContent).toContain("Next run:");
    fireEvent.change(getByTestId("create-name"), { target: { value: "sched" } });
    fireEvent.click(getByTestId("create-cron-raw-toggle"));
    fireEvent.change(getByTestId("create-cron"), { target: { value: "30 8 * * 3" } });
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.on).toEqual({ kind: "schedule", cron: "30 8 * * 3" });
  });

  it("openspec category lists events, disables planned ones, and writes on.events", async () => {
    const { getByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
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
    const { getByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    await waitFor(() => expect(getByTestId("trigger-cat-git")).toBeTruthy());
    // planned tab is disabled; the create button stays disabled if forced selected.
    expect((getByTestId("trigger-cat-git") as HTMLButtonElement).disabled).toBe(true);
  });

  it("action picker selects the built-in skill action and writes its kind", async () => {
    const { getByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    fireEvent.change(getByTestId("create-name"), { target: { value: "sk" } });
    fireEvent.click(getByTestId("create-action-core.skill"));
    fireEvent.change(getByTestId("create-skill"), { target: { value: "$recent-code-bugfix" } });
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.action).toEqual({
      kind: "skill",
      skill: "$recent-code-bugfix",
    });
  });

  it("blocks core.skill submission when the skill field is empty (no `$` skill)", async () => {
    const { getByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    fireEvent.change(getByTestId("create-name"), { target: { value: "sk" } });
    fireEvent.click(getByTestId("create-action-core.skill"));
    fireEvent.click(getByTestId("create-submit"));
    // submit stays disabled / rejects — no create call fires with a bare "$"
    await Promise.resolve();
    expect(createAutomation).not.toHaveBeenCalled();
  });

  it("renders a plugin action's schema-driven payload and writes kind + payload", async () => {
    listActions.mockResolvedValue([
      { id: "core.prompt", source: "core", label: "Prompt", available: true, payloadSchema: [] },
      {
        id: "flows.run",
        source: "flows",
        label: "Run a flow",
        available: true,
        payloadSchema: [
          { key: "flow", label: "Flow", type: "enum", options: ["test:capabilities", "custom:deploy"] },
          { key: "task", label: "Task", type: "multiline" },
        ],
      },
    ]);
    const { getByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    fireEvent.change(getByTestId("create-name"), { target: { value: "nightly" } });
    await waitFor(() => expect(getByTestId("action-group-flows")).toBeTruthy());
    fireEvent.click(getByTestId("action-group-flows"));
    fireEvent.click(getByTestId("create-action-flows.run"));
    await waitFor(() => expect(getByTestId("action-payload-flow")).toBeTruthy());
    fireEvent.change(getByTestId("action-payload-flow"), { target: { value: "custom:deploy" } });
    fireEvent.change(getByTestId("action-payload-task"), { target: { value: "ship it" } });
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.action).toEqual({
      kind: "flows.run",
      payload: { flow: "custom:deploy", task: "ship it" },
    });
  });

  it("renders an unknown payload field type as a text input (fallback) and writes its value", async () => {
    listActions.mockResolvedValue([
      { id: "core.prompt", source: "core", label: "Prompt", available: true, payloadSchema: [] },
      {
        id: "future.act",
        source: "future",
        label: "Future action",
        available: true,
        payloadSchema: [{ key: "weird", label: "Weird", type: "totally-new-type" }],
      },
    ]);
    const { getByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    fireEvent.change(getByTestId("create-name"), { target: { value: "fut" } });
    await waitFor(() => expect(getByTestId("action-group-future")).toBeTruthy());
    fireEvent.click(getByTestId("action-group-future"));
    fireEvent.click(getByTestId("create-action-future.act"));
    // unknown type still renders an editable control (text input fallback)
    await waitFor(() => expect(getByTestId("action-payload-weird")).toBeTruthy());
    fireEvent.change(getByTestId("action-payload-weird"), { target: { value: "hello" } });
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.action).toEqual({
      kind: "future.act",
      payload: { weird: "hello" },
    });
  });

  it("renders next-run as a relative duration and writes raw cron", async () => {
    const { getByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    expect(getByTestId("create-next-run").textContent).toMatch(/in \d/);
  });

  it("save bar names the write path and arms on create with the next run (no modal chrome)", async () => {
    const { getByTestId, queryByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    expect(queryByTestId("create-automation-dialog")).toBeNull();
    expect(queryByTestId("editor-subtitle")).toBeNull();
    expect(queryByTestId("armed-chip")).toBeNull();
    fireEvent.change(getByTestId("create-name"), { target: { value: "weekly-brief" } });
    expect(getByTestId("editor-write-path").textContent).toContain("/repo/.pi/automation/weekly-brief/automation.yaml");
    expect(getByTestId("editor-write-path").textContent).toContain("prompt.md");
    expect(getByTestId("editor-arms").textContent).toMatch(/Arms on create · next run in \d/);
    expect(getByTestId("editor-save-bar").contains(getByTestId("create-submit"))).toBe(true);
  });

  // E9 (fieldCount): the count field says "Sessions per run", never "Spawn count".
  // See change: align-ui-with-theme-tokens (design D9, tasks 2.7).
  it("labels the count field 'Sessions per run'", async () => {
    const { getByTestId, getByText } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    const count = getByTestId("create-action-count");
    expect(count.closest("label")?.textContent).toContain("Sessions per run");
    expect(() => getByText("Spawn count")).toThrow();
  });

  it("shows inline sandbox help in Advanced", async () => {
    const { getByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    fireEvent.click(getByTestId("create-advanced-toggle"));
    expect(getByTestId("create-sandbox-help").textContent).toContain("Write inside the workspace");
    fireEvent.change(getByTestId("create-sandbox"), { target: { value: "read-only" } });
    expect(getByTestId("create-sandbox-help").textContent).toContain("No writes");
  });

  it("disables worktree for a non-git folder and enables it for a git folder", async () => {
    isGitCapable.mockResolvedValue(false);
    const { getByTestId, rerender } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    fireEvent.click(getByTestId("create-advanced-toggle"));
    await waitFor(() => expect(getByTestId("create-worktree-hint")).toBeTruthy());
    const wtOption = () =>
      Array.from((getByTestId("create-mode") as HTMLSelectElement).options).find((o) => o.value === "worktree")!;
    expect(wtOption().disabled).toBe(true);

    cleanup();
    isGitCapable.mockResolvedValue(true);
    const r2 = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    fireEvent.click(r2.getByTestId("create-advanced-toggle"));
    await waitFor(() => {
      const opt = Array.from((r2.getByTestId("create-mode") as HTMLSelectElement).options).find((o) => o.value === "worktree")!;
      expect(opt.disabled).toBe(false);
    });
  });

  it("edit mode pre-loads config and saves a change via update", async () => {
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
        <AutomationEditor
          cwd="/repo"
          onClose={() => {}}
          initialName="existing"
          initialScope="folder"
          initialConfig={initialConfig}
          initialPromptBody="do the thing"
        />,
      ),
    );
    await editorReady();
    expect(getByTestId("mock-model-selector").getAttribute("data-current")).toBe("@coding");
    expect((getByTestId("create-prompt") as HTMLTextAreaElement).value).toBe("do the thing");
    fireEvent.change(getByTestId("create-prompt"), { target: { value: "do the other thing" } });
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(updateAutomation).toHaveBeenCalled());
    expect(createAutomation).not.toHaveBeenCalled();
    const body = updateAutomation.mock.calls[0]![0]!;
    expect(body.name).toBe("existing");
    expect(body.config.on).toEqual({ kind: "schedule", cron: "0 6 * * *" });
    expect(body.promptBody).toBe("do the other thing");
  });
});

/**
 * Thinking level on the direct-model branch only — written as a `:<level>`
 * suffix on the existing `model` field, no schema change.
 * See change: add-default-thinking-level (tasks 5.x / test-plan A1-A2).
 */
describe("AutomationEditor — thinking level", () => {
  // A1
  it("writes the level as a suffix on the model field", async () => {
    const { getByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    fireEvent.change(getByTestId("create-name"), { target: { value: "m" } });
    fireEvent.click(getByTestId("model-opt-anthropic/claude-sonnet-4-5"));
    fireEvent.click(getByTestId("level-opt-high"));
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.model).toBe("anthropic/claude-sonnet-4-5:high");
  });

  it("offers only the picked model's supported levels", async () => {
    const { getByTestId, queryByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    fireEvent.click(getByTestId("model-opt-anthropic/claude-sonnet-4-5"));
    expect(getByTestId("level-opt-high")).toBeTruthy();
    expect(queryByTestId("level-opt-low")).toBeNull();
  });

  // A2
  it("renders NO level control on the @role branch and writes the bare token", async () => {
    const { getByTestId, queryByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    expect(queryByTestId("mock-thinking-level")).toBeNull();
    expect(getByTestId("create-model-role-level-hint")).toBeTruthy();
    fireEvent.change(getByTestId("create-name"), { target: { value: "r" } });
    fireEvent.click(getByTestId("role-opt-coding"));
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.model).toBe("@coding");
  });

  // 5.3 — edit path parity
  it("splits an existing suffixed model when seeding the edit form", async () => {
    const initial = {
      name: "x",
      on: { kind: "schedule", cron: "0 9 * * *" },
      model: "anthropic/claude-sonnet-4-5:high",
      action: { kind: "prompt", prompt: "hi" },
    } as unknown as AutomationConfig;
    const { getByTestId } = render(
      wrap(<AutomationEditor cwd="/repo" onClose={() => {}} initialConfig={initial} initialName="x" />),
    );
    await editorReady();
    // Level lands in the level control; the echo below the pair shows the
    // rejoined ref that will be written.
    expect(getByTestId("mock-thinking-level").getAttribute("data-current")).toBe("high");
    expect(getByTestId("create-model-selector").textContent).toContain(
      "anthropic/claude-sonnet-4-5:high",
    );
  });
});

// E25 — custom role selectable via the primitive's Role tab; no level control.
describe("AutomationEditor — role-aware model field", () => {
  it("custom role `nightly` selectable → stores `@nightly`, no thinking-level control", async () => {
    const { getByTestId, queryByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    expect(getByTestId("mock-model-selector").getAttribute("data-allow-roles")).toBe("true");
    expect(queryByTestId("create-model-role")).toBeNull();
    fireEvent.change(getByTestId("create-name"), { target: { value: "n" } });
    fireEvent.click(getByTestId("role-opt-nightly"));
    expect(queryByTestId("mock-thinking-level")).toBeNull();
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.model).toBe("@nightly");
  });

  it("hand-written @role:level survives an edit round-trip verbatim", async () => {
    const initial = {
      name: "x",
      on: { kind: "schedule", cron: "0 9 * * *" },
      model: "@fast:high",
      action: { kind: "prompt", prompt: "hi" },
    } as unknown as AutomationConfig;
    const { getByTestId } = render(
      wrap(<AutomationEditor cwd="/repo" onClose={() => {}} initialConfig={initial} initialName="x" />),
    );
    await editorReady();
    fireEvent.change(getByTestId("create-prompt"), { target: { value: "changed" } });
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(updateAutomation).toHaveBeenCalled());
    expect(updateAutomation.mock.calls[0]![0]!.config.model).toBe("@fast:high");
  });

  it("E19: the role hint names the role and says model and thinking level follow it; no level control", async () => {
    const { getByTestId, queryByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    fireEvent.click(getByTestId("role-opt-coding"));
    const hint = getByTestId("create-model-role-level-hint");
    expect(hint.textContent).toContain("Follows @coding");
    expect(hint.textContent).toMatch(/model and thinking level change when the role changes/);
    expect(hint.textContent).toContain("Settings → Roles");
    expect(queryByTestId("mock-thinking-level")).toBeNull();
  });
});

// test-plan #E59 (add-acp-session-driver): the editor's agent picker.
describe("AutomationEditor agent picker (add-acp-session-driver)", () => {
  const agentsFetch = (agents: Array<{ id: string; name: string }>) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: agents }) })));
  afterEach(() => vi.unstubAllGlobals());

  it("no agents configured → no agent select; model selector unchanged", async () => {
    agentsFetch([]);
    const { queryByTestId, getByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    await Promise.resolve();
    expect(queryByTestId("create-agent-select")).toBeNull();
    expect(getByTestId("create-model-selector")).toBeTruthy();
  });

  it("choosing an agent hides the model selector, disables the skill action and writes agent (no model)", async () => {
    agentsFetch([{ id: "qmt", name: "querymt" }]);
    listActions.mockResolvedValue([]); // built-in actions only (earlier tests leave a plugin action list behind)
    const { getByTestId, queryByTestId, findByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    const select = (await findByTestId("create-agent-select")) as HTMLSelectElement;
    fireEvent.change(getByTestId("create-name"), { target: { value: "acp-run" } });
    fireEvent.change(select, { target: { value: "qmt" } });
    expect(queryByTestId("create-model-selector")).toBeNull();
    expect(getByTestId("create-model-by-agent")).toBeTruthy();
    if (!queryByTestId("create-action-core.skill")) fireEvent.click(getByTestId("action-group-core"));
    expect(getByTestId("create-action-core.skill").hasAttribute("disabled")).toBe(true);
    expect(getByTestId("create-action-core.prompt").hasAttribute("disabled")).toBe(false);
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    const config = createAutomation.mock.calls[0]![0]!.config;
    expect(config.agent).toBe("qmt");
    expect(config.model).toBe("");
    expect(config.action.kind).toBe("prompt");
  });
});

// test-plan #E21 — the editor opens on the section the user clicked and counts
// unsaved changes in its footer. See change: polish-automation-board (design D11).
describe("AutomationEditor initialSection + dirty count", () => {
  it("E21: opens on Trigger with its first field focused; one edit reads '1 unsaved change'", async () => {
    const { getByTestId, queryByTestId } = render(
      wrap(<AutomationEditor cwd="/repo" onClose={() => {}} initialSection="trigger" />),
    );
    await editorReady();
    await waitFor(() => expect(getByTestId("group-trigger").contains(document.activeElement)).toBe(true));
    expect(getByTestId("group-trigger").getAttribute("data-open")).toBe("true");
    expect(document.activeElement).toBe(getByTestId("group-trigger").querySelector("button, input, select, textarea"));
    expect(queryByTestId("editor-dirty-count")).toBe(null);
    fireEvent.change(getByTestId("create-cron-time"), { target: { value: "17:00" } });
    expect(getByTestId("editor-dirty-count").textContent).toBe("1 unsaved change");
    fireEvent.change(getByTestId("create-name"), { target: { value: "x" } });
    expect(getByTestId("editor-dirty-count").textContent).toBe("2 unsaved changes");
  });

  it("editing a worktree automation: the form waits for the git probe; worktree survives a git folder", async () => {
    let resolveProbe!: (ok: boolean) => void;
    isGitCapable.mockImplementationOnce(() => new Promise<boolean>((r) => { resolveProbe = r; }));
    const initialConfig: AutomationConfig = {
      on: { kind: "schedule", cron: "0 6 * * *" },
      action: { kind: "prompt", prompt: "./prompt.md" },
      model: "@coding",
      mode: "worktree",
      sandbox: "read-only",
      concurrency: "queue",
      visibility: "shown",
    };
    const { getByTestId, queryByTestId } = render(
      wrap(
        <AutomationEditor cwd="/repo" onClose={() => {}} initialName="wt" initialScope="folder" initialConfig={initialConfig} initialPromptBody="x" />,
      ),
    );
    // Probe pending: the whole form is disabled and Save is unreachable.
    expect(getByTestId("editor-loading")).toBeTruthy();
    expect((getByTestId("create-prompt") as HTMLTextAreaElement).closest("fieldset")?.disabled).toBe(true);
    expect((getByTestId("create-submit") as HTMLButtonElement).disabled).toBe(true);
    resolveProbe(true);
    await editorReady();
    expect(queryByTestId("editor-dirty-count")).toBe(null);
    fireEvent.change(getByTestId("create-prompt"), { target: { value: "y" } });
    await waitFor(() => expect((getByTestId("create-submit") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(updateAutomation).toHaveBeenCalled());
    expect(updateAutomation.mock.calls.at(-1)![0]!.config.mode).toBe("worktree");
  });

  it("edit mode opened on Trigger focuses its first control", async () => {
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
        <AutomationEditor cwd="/repo" onClose={() => {}} initialName="e" initialScope="folder" initialConfig={initialConfig} initialPromptBody="x" initialSection="trigger" />,
      ),
    );
    await waitFor(() => expect(getByTestId("group-trigger").contains(document.activeElement)).toBe(true));
  });

  it("initialSection advanced expands the collapsed Advanced group", async () => {
    const { getByTestId } = render(
      wrap(<AutomationEditor cwd="/repo" onClose={() => {}} initialSection="advanced" />),
    );
    await editorReady();
    await waitFor(() => expect(getByTestId("create-advanced").contains(document.activeElement)).toBe(true));
  });
});

// inline-automation-editor: config round-trip, baseline, save bar, identity.
describe("AutomationEditor — inline editor (inline-automation-editor)", () => {
  const daily: AutomationConfig = {
    on: { kind: "schedule", cron: "0 10 * * *" },
    action: { kind: "prompt", prompt: "./prompt.md" },
    model: "@fast",
    mode: "local",
    sandbox: "workspace-write",
    concurrency: "skip",
  };
  const editDaily = (over: Partial<AutomationConfig> = {}, cwd = "/w/app") =>
    render(
      wrap(
        <AutomationEditor
          cwd={cwd}
          onClose={() => {}}
          initialName="daily-continuity"
          initialScope="folder"
          initialConfig={{ ...daily, ...over }}
          initialPromptBody="Summarise yesterday."
          initialSection="trigger"
        />,
      ),
    );

  // test-plan #E1
  it("E1: saving keeps keys the form does not own (disabled, maxConcurrentSpawns)", async () => {
    const { getByTestId } = editDaily({ disabled: true, maxConcurrentSpawns: 3 });
    await editorReady();
    fireEvent.change(getByTestId("create-prompt"), { target: { value: "Summarise today." } });
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(updateAutomation).toHaveBeenCalled());
    const body = updateAutomation.mock.calls[0]![0]!;
    expect(body.config.disabled).toBe(true);
    expect(body.config.maxConcurrentSpawns).toBe(3);
    expect(body.promptBody).toBe("Summarise today.");
  });

  // test-plan #E2
  it("E2: untouched worktree automation in a non-git folder reports no change; mode reads local", async () => {
    isGitCapable.mockResolvedValue(false);
    const { getByTestId, queryByTestId } = editDaily({ mode: "worktree" });
    await editorReady();
    expect(queryByTestId("editor-dirty-count")).toBeNull();
    expect((getByTestId("create-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByTestId("create-advanced-toggle"));
    expect((getByTestId("create-mode") as HTMLSelectElement).value).toBe("local");
  });

  // test-plan #E3
  it("E3: changing the raw cron reads '1 unsaved change' and enables Save", async () => {
    const { getByTestId } = editDaily();
    await editorReady();
    expect((getByTestId("create-cron") as HTMLInputElement).value).toBe("0 10 * * *");
    fireEvent.change(getByTestId("create-cron"), { target: { value: "30 9 * * *" } });
    expect(getByTestId("editor-dirty-count").textContent).toBe("1 unsaved change");
    expect((getByTestId("create-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  // test-plan #E4
  it("E4: sessions per run never drops below 1", async () => {
    const { getByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    const count = getByTestId("create-action-count") as HTMLInputElement;
    for (const v of ["0", "-2", ""]) {
      fireEvent.change(count, { target: { value: v } });
      expect(count.value).toBe("1");
    }
    fireEvent.change(getByTestId("create-name"), { target: { value: "n" } });
    fireEvent.click(getByTestId("create-submit"));
    await waitFor(() => expect(createAutomation).toHaveBeenCalled());
    expect(createAutomation.mock.calls[0]![0]!.config.action.count).toBeUndefined();
  });

  // test-plan #E5
  it("E5: the save bar names where it writes (global, folder, unnamed draft)", async () => {
    const global = render(
      wrap(<AutomationEditor cwd="/w/app" onClose={() => {}} initialName="pr-triage" initialScope="global" initialConfig={daily} />),
    );
    await editorReady();
    expect(global.getByTestId("editor-write-path").textContent).toContain("~/.pi/automation/pr-triage/");
    cleanup();
    const folder = editDaily();
    await editorReady();
    expect(folder.getByTestId("editor-write-path").textContent).toContain("/w/app/.pi/automation/daily-continuity/");
    cleanup();
    const draft = render(wrap(<AutomationEditor onClose={() => {}} />));
    await editorReady();
    expect(draft.getByTestId("editor-write-path").textContent).toContain(".pi/automation/<name>/");
  });

  // test-plan #E8
  it("E8: edit hides identity; the create draft keeps Name + Scope", async () => {
    const edit = editDaily();
    await editorReady();
    for (const id of ["create-name", "create-scope", "create-name-locked", "group-identity"]) {
      expect(edit.queryByTestId(id)).toBeNull();
    }
    cleanup();
    const create = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
    await editorReady();
    expect((create.getByTestId("create-name") as HTMLInputElement).disabled).toBe(false);
    expect((create.getByTestId("create-scope-global") as HTMLButtonElement).disabled).toBe(false);
  });

  // test-plan #E10
  it("E10: an agent hides model + level; pi with a direct model writes the level suffix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: "claude-code", name: "claude-code" }] }) })),
    );
    try {
      const { getByTestId, queryByTestId, findByTestId } = render(wrap(<AutomationEditor cwd="/repo" onClose={() => {}} />));
      await editorReady();
      const agent = (await findByTestId("create-agent-select")) as HTMLSelectElement;
      expect(getByTestId("group-runs-as").contains(agent)).toBe(true);
      fireEvent.change(agent, { target: { value: "claude-code" } });
      expect(getByTestId("create-model-by-agent")).toBeTruthy();
      expect(queryByTestId("create-model-selector")).toBeNull();
      expect(queryByTestId("mock-thinking-level")).toBeNull();
      fireEvent.change(agent, { target: { value: "" } });
      fireEvent.click(getByTestId("model-opt-anthropic/claude-sonnet-4-5"));
      fireEvent.click(getByTestId("level-opt-high"));
      fireEvent.change(getByTestId("create-name"), { target: { value: "m" } });
      fireEvent.click(getByTestId("create-submit"));
      await waitFor(() => expect(createAutomation).toHaveBeenCalled());
      expect(createAutomation.mock.calls[0]![0]!.config.model).toBe("anthropic/claude-sonnet-4-5:high");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("guard: renders the count with Discard / Save & close and saves with outcome 'switch'", async () => {
    const onDiscard = vi.fn();
    const onSaved = vi.fn();
    const { getByTestId, queryByTestId } = render(
      wrap(
        <AutomationEditor
          cwd="/w/app"
          onClose={() => {}}
          onSaved={onSaved}
          onDiscard={onDiscard}
          guard={{ count: 2, closing: true }}
          initialName="daily-continuity"
          initialScope="folder"
          initialConfig={daily}
          initialPromptBody="x"
        />,
      ),
    );
    await editorReady();
    expect(getByTestId("editor-guard").textContent).toContain("2 unsaved changes");
    expect(getByTestId("editor-guard-save").textContent).toBe("Save & close");
    expect(queryByTestId("create-submit")).toBeNull();
    fireEvent.click(getByTestId("editor-guard-discard"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    fireEvent.change(getByTestId("create-prompt"), { target: { value: "y" } });
    fireEvent.click(getByTestId("editor-guard-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("switch", "daily-continuity"));
  });
});
