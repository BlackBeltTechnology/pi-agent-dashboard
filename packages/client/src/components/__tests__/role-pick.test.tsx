/**
 * One-shot `@role` pick on the session pickers (Kind C): composer model chip
 * (CommandInput) and the OpenSpec run-config row. Resolves once at pick time;
 * the session never follows later preset changes.
 *
 * Note: the model picker lives in the composer (`CommandInput`), not StatusBar —
 * StatusBar was reduced to a working-status label by `redesign-prompt-input`.
 * See change: add-role-aware-model-refs (test-plan E31–E34).
 */
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRunConfig, RunConfigHarness } from "../../test-support/runConfigHarness.js";
import { CommandInput } from "../chat/CommandInput.js";
import { useOpenSpecRunConfigRow } from "../openspec/useOpenSpecRunConfigRow.js";

type Row = { role: string; assigned: boolean; model?: string; thinkingLevel?: string };
let rows: Row[];
const stubRoles = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: [{ preset: null, active: true, roles: rows }] }),
    })),
  );

const MODELS: ModelInfo[] = [
  { provider: "anthropic", id: "claude-sonnet-4-5", supportedThinkingLevels: ["off", "low", "medium", "high"] } as ModelInfo,
  { provider: "anthropic", id: "claude-haiku-4-5", supportedThinkingLevels: ["off", "low", "medium"] } as ModelInfo,
];

beforeEach(() => {
  localStorage.clear();
  rows = [
    { role: "coding", assigned: true, model: "anthropic/claude-sonnet-4-5", thinkingLevel: "high" },
    { role: "fast", assigned: true, model: "anthropic/claude-haiku-4-5", thinkingLevel: "high" },
    { role: "research", assigned: false },
  ];
  stubRoles();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Composer({ model, onSelectModel, onSelectThinkingLevel }: { model?: string; onSelectModel: (m: string) => void; onSelectThinkingLevel: (l: string) => void }) {
  return (
    <CommandInput
      commands={[]}
      onSend={() => {}}
      model={model}
      models={MODELS}
      onSelectModel={onSelectModel}
      onSelectThinkingLevel={onSelectThinkingLevel}
    />
  );
}

async function pickRole(role: string) {
  await act(async () => {});
  fireEvent.click(screen.getByTestId("model-selector-button"));
  await act(async () => {});
  fireEvent.click(screen.getByTestId("model-tab-role"));
  await act(async () => {
    fireEvent.click(screen.getAllByTestId("role-row").find((r) => r.getAttribute("data-role") === role)!);
  });
}

describe("composer model chip — role pick (CommandInput)", () => {
  it("E31: resolves once → set_model then set_thinking_level, trigger shows 'via @coding'", async () => {
    const onSelectModel = vi.fn();
    const onSelectThinkingLevel = vi.fn();
    const { rerender } = render(<Composer model="anthropic/claude-haiku-4-5" onSelectModel={onSelectModel} onSelectThinkingLevel={onSelectThinkingLevel} />);
    await pickRole("coding");
    await waitFor(() => expect(onSelectModel).toHaveBeenCalledWith("anthropic/claude-sonnet-4-5"));
    expect(onSelectThinkingLevel).toHaveBeenCalledWith("high");
    expect(onSelectModel.mock.invocationCallOrder[0]!).toBeLessThan(onSelectThinkingLevel.mock.invocationCallOrder[0]!);
    // session reports the new model
    rerender(<Composer model="anthropic/claude-sonnet-4-5" onSelectModel={onSelectModel} onSelectThinkingLevel={onSelectThinkingLevel} />);
    expect(screen.getByTestId("model-via-role").textContent).toContain("@coding");
    // preset change later: nothing is re-sent (one-shot)
    rows[0]!.model = "openai/gpt-5-mini";
    await act(async () => {});
    expect(onSelectModel).toHaveBeenCalledTimes(1);
  });

  it("E32: a resolved level the model does not support is skipped with a notice", async () => {
    const onSelectModel = vi.fn();
    const onSelectThinkingLevel = vi.fn();
    render(<Composer model="anthropic/claude-sonnet-4-5" onSelectModel={onSelectModel} onSelectThinkingLevel={onSelectThinkingLevel} />);
    await pickRole("fast"); // haiku supports low/medium, role level is high
    await waitFor(() => expect(onSelectModel).toHaveBeenCalledWith("anthropic/claude-haiku-4-5"));
    expect(onSelectThinkingLevel).not.toHaveBeenCalled();
    expect(screen.getByTestId("role-pick-notice").getAttribute("data-kind")).toBe("level-skipped");
  });

  it("E33: unassigned role → no model change, unassigned notice", async () => {
    const onSelectModel = vi.fn();
    render(<Composer model="anthropic/claude-sonnet-4-5" onSelectModel={onSelectModel} onSelectThinkingLevel={vi.fn()} />);
    await pickRole("research");
    await waitFor(() => expect(screen.getByTestId("role-pick-notice").getAttribute("data-kind")).toBe("unassigned"));
    expect(onSelectModel).not.toHaveBeenCalled();
  });

  it("E34: the hint clears when the user then picks a model directly", async () => {
    const onSelectModel = vi.fn();
    const { rerender } = render(<Composer model="anthropic/claude-haiku-4-5" onSelectModel={onSelectModel} onSelectThinkingLevel={vi.fn()} />);
    await pickRole("coding");
    rerender(<Composer model="anthropic/claude-sonnet-4-5" onSelectModel={onSelectModel} onSelectThinkingLevel={vi.fn()} />);
    expect(screen.getByTestId("model-via-role")).toBeTruthy();
    fireEvent.click(screen.getByTestId("model-selector-button"));
    await act(async () => {});
    fireEvent.click(screen.getByTestId("model-tab-model"));
    const row = screen.getAllByTestId("model-row").find((r) => r.textContent?.includes("claude-haiku-4-5"))!;
    fireEvent.click(row);
    expect(screen.queryByTestId("model-via-role")).toBeNull();
    rerender(<Composer model="anthropic/claude-haiku-4-5" onSelectModel={onSelectModel} onSelectThinkingLevel={vi.fn()} />);
    expect(screen.queryByTestId("model-via-role")).toBeNull();
  });

  it("the hint also clears when the session model moves off the resolved model (another surface)", async () => {
    const { rerender } = render(<Composer model="anthropic/claude-haiku-4-5" onSelectModel={vi.fn()} onSelectThinkingLevel={vi.fn()} />);
    await pickRole("coding");
    rerender(<Composer model="anthropic/claude-sonnet-4-5" onSelectModel={vi.fn()} onSelectThinkingLevel={vi.fn()} />);
    expect(screen.getByTestId("model-via-role")).toBeTruthy();
    rerender(<Composer model="anthropic/claude-haiku-4-5" onSelectModel={vi.fn()} onSelectThinkingLevel={vi.fn()} />);
    expect(screen.queryByTestId("model-via-role")).toBeNull();
  });
});

describe("OpenSpec run dialog — role pick (6.2)", () => {
  function Host({ onSend }: { onSend: () => void }) {
    const { rowElement, submit } = useOpenSpecRunConfigRow({ timeoutMs: 5_000 });
    return (
      <div>
        {rowElement}
        <button type="button" data-testid="host-send" onClick={() => submit(onSend)}>
          send
        </button>
      </div>
    );
  }

  it("a role pick resolves into the draft; the prompt waits for the resolved model", async () => {
    const value = makeRunConfig({ models: MODELS, model: "anthropic/claude-haiku-4-5", thinkingLevel: "low" });
    const onSend = vi.fn();
    const { rerender } = render(
      <RunConfigHarness value={value}>
        <Host onSend={onSend} />
      </RunConfigHarness>,
    );
    await pickRole("coding");
    await waitFor(() => expect(screen.getByTestId("model-selector-button").textContent).toContain("claude-sonnet-4-5"));
    fireEvent.click(screen.getByTestId("host-send"));
    expect(value.setModel).toHaveBeenCalledWith("anthropic/claude-sonnet-4-5");
    expect(value.setThinkingLevel).toHaveBeenCalledWith("high");
    expect(onSend).not.toHaveBeenCalled();
    rerender(
      <RunConfigHarness value={{ ...value, model: "anthropic/claude-sonnet-4-5", thinkingLevel: "high" }}>
        <Host onSend={onSend} />
      </RunConfigHarness>,
    );
    expect(onSend).toHaveBeenCalledOnce();
  });
});
