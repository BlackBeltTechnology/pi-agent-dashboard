/**
 * L1 component tests for the chain editor: ordering, promotion, keyboard
 * operability, boundary disabling, accessible names, the implicit tail,
 * and the registry-backed model selector and thinking override
 * (test-plan E10-E13, E22-E26, X2; F1-F5).
 *
 * See change: add-blackhole-plugin, blackhole-model-picker-chains.
 */
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type {
  UiModelSelectorProps,
  UiThinkingLevelSelectorProps,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ModelRef, validateBlackholeConfig } from "../../shared/blackhole-config.js";
import { ChainEditor, type RegistryState } from "../ChainEditor.js";

afterEach(cleanup);

const A: ModelRef = { provider: "openrouter", id: "model-a" };
const B: ModelRef = { provider: "ollama", id: "model-b" };
const C: ModelRef = { provider: "cerebras", id: "model-c" };

let lastThinkingProps: UiThinkingLevelSelectorProps | null = null;

function MockModelSelector(props: UiModelSelectorProps) {
  return (
    <div data-testid="mock-model-selector" data-current={props.current} data-allow-roles={String(!!props.allowRoles)}>
      <button data-testid="mock-model-trigger">{props.current ?? "select model"}</button>
      {props.allowRoles && (
        <button data-testid="role-opt-fast" onClick={() => props.onSelect("@fast")}>
          @fast
        </button>
      )}
      {(props.models ?? []).map((m) => {
        const label = `${m.provider}/${m.id}`;
        return (
          <button
            key={label}
            data-testid={`model-opt-${label}`}
            onClick={() => props.onSelect(label)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function MockThinkingLevelSelector(props: UiThinkingLevelSelectorProps) {
  lastThinkingProps = props;
  return (
    <div data-testid="mock-thinking-level-selector" data-current={props.current}>
      {(props.supportedLevels ?? []).map((lvl) => (
        <button
          key={lvl}
          data-testid={`level-opt-${lvl}`}
          onClick={() => props.onSelect(lvl)}
        >
          {lvl}
        </button>
      ))}
    </div>
  );
}

function renderChain(
  entries: ModelRef[],
  sessionFallback = true,
  options?: {
    models?: ModelInfo[];
    registry?: RegistryState;
    onRetryRegistry?: () => void;
    onReattach?: (index: number) => void;
  },
) {
  const onChange = vi.fn();
  const utils = render(
    withUiPrimitiveProvider(
      {
        [UI_PRIMITIVE_KEYS.modelSelector]: MockModelSelector,
        [UI_PRIMITIVE_KEYS.thinkingLevelSelector]: MockThinkingLevelSelector,
      },
      <ChainEditor
        worker="observer"
        name="Observer"
        role="Extracts facts"
        entries={entries}
        onChange={onChange}
        baseModel={{ provider: "openrouter", id: "base-model" }}
        sessionFallback={sessionFallback}
        models={
          options?.models ?? [
            { provider: "openrouter", id: "model-a", reasoning: true },
            { provider: "ollama", id: "model-b", reasoning: true },
            { provider: "cerebras", id: "model-c", reasoning: true },
          ]
        }
        registry={options?.registry ?? "ok"}
        onRetryRegistry={options?.onRetryRegistry}
        onReattach={options?.onReattach}
      />,
    ),
  );
  return { ...utils, onChange };
}

describe("ordering and promotion (E19)", () => {
  it("moving the first fallback up promotes it to position 0", () => {
    const { getByTestId, onChange } = renderChain([A, B, C]);
    fireEvent.click(getByTestId("blackhole-chain-observer-up-1"));
    expect(onChange).toHaveBeenCalledWith([B, A, C]);
  });

  it("moving the primary down demotes it", () => {
    const { getByTestId, onChange } = renderChain([A, B, C]);
    fireEvent.click(getByTestId("blackhole-chain-observer-down-0"));
    expect(onChange).toHaveBeenCalledWith([B, A, C]);
  });

  it("removing an entry drops exactly that entry", () => {
    const { getByTestId, onChange } = renderChain([A, B, C]);
    fireEvent.click(getByTestId("blackhole-chain-observer-remove-1"));
    expect(onChange).toHaveBeenCalledWith([A, C]);
  });
});

describe("boundary controls are disabled, not absent (F2)", () => {
  it("keeps move-up present and disabled on the first entry", () => {
    const { getByTestId } = renderChain([A, B]);
    const up = getByTestId("blackhole-chain-observer-up-0") as HTMLButtonElement;
    expect(up).toBeTruthy();
    expect(up.disabled).toBe(true);
  });

  it("keeps move-down present and disabled on the last entry", () => {
    const { getByTestId } = renderChain([A, B]);
    const down = getByTestId("blackhole-chain-observer-down-1") as HTMLButtonElement;
    expect(down).toBeTruthy();
    expect(down.disabled).toBe(true);
  });
});

describe("a worker chain cannot be emptied (E21)", () => {
  it("offers no remove control on a single-entry chain", () => {
    const { queryByTestId } = renderChain([A]);
    expect(queryByTestId("blackhole-chain-observer-remove-0")).toBeNull();
  });

  it("offers a remove control once a second entry exists", () => {
    const { getByTestId } = renderChain([A, B]);
    expect(getByTestId("blackhole-chain-observer-remove-0")).toBeTruthy();
  });
});

describe("accessible names identify the model (F1, F3)", () => {
  it("names the model in every reorder and remove control", () => {
    const { getByTestId } = renderChain([A, B, C]);
    for (const [index, model] of [A, B, C].entries()) {
      expect(getByTestId(`blackhole-chain-observer-up-${index}`).getAttribute("aria-label")).toContain(
        model.id,
      );
      expect(
        getByTestId(`blackhole-chain-observer-down-${index}`).getAttribute("aria-label"),
      ).toContain(model.id);
      expect(
        getByTestId(`blackhole-chain-observer-remove-${index}`).getAttribute("aria-label"),
      ).toContain(model.id);
    }
  });

  it("uses real buttons, so every control is focusable and keyboard-activatable", () => {
    const { getByTestId, onChange } = renderChain([A, B]);
    const down = getByTestId("blackhole-chain-observer-down-0") as HTMLButtonElement;
    down.focus();
    expect(document.activeElement).toBe(down);
    expect(down.tagName).toBe("BUTTON");
    // A native button fires click on Enter/Space; asserting the click handler
    // is the same code path the keyboard reaches.
    fireEvent.click(down);
    expect(onChange).toHaveBeenCalledWith([B, A]);
  });
});

describe("the implicit tail (F4, F5)", () => {
  it("shows the base → session tail without making it a chain entry", () => {
    const { getByTestId, queryByTestId } = renderChain([A]);
    expect(getByTestId("blackhole-chain-observer-tail").textContent).toContain("base-model");
    expect(getByTestId("blackhole-chain-observer-tail").textContent).toContain("session model");
    // The tail is not an entry: only entry-0 exists for a one-model chain.
    expect(queryByTestId("blackhole-chain-observer-entry-1")).toBeNull();
  });

  it("renders the session tail as excluded when sessionFallback is off", () => {
    const { getByTestId } = renderChain([A], false);
    const tail = getByTestId("blackhole-chain-observer-tail-session");
    expect(tail.getAttribute("data-excluded")).toBe("true");
    expect(tail.textContent).toContain("excluded");
  });

  it("renders the session tail as included when sessionFallback is on", () => {
    const { getByTestId } = renderChain([A], true);
    expect(getByTestId("blackhole-chain-observer-tail-session").getAttribute("data-excluded")).toBe(
      "false",
    );
  });
});

describe("per-model fields (E20)", () => {
  it("writes a cleared context window as absent, never 0", () => {
    const { getByLabelText, onChange } = renderChain([{ ...A, contextWindow: 128_000 }, B]);
    fireEvent.change(getByLabelText(`Context window for ${A.id}`), { target: { value: "" } });
    const next = onChange.mock.calls[0][0] as ModelRef[];
    expect(Object.hasOwn(next[0], "contextWindow")).toBe(false);
  });

  it("writes a typed NUMBER for a non-empty context window, not the raw input string", () => {
    const { getByLabelText, onChange } = renderChain([A, B]);
    fireEvent.change(getByLabelText(`Context window for ${A.id}`), { target: { value: "128000" } });
    const next = onChange.mock.calls[0][0] as ModelRef[];
    expect(next[0].contextWindow).toBe(128_000);
    expect(typeof next[0].contextWindow).toBe("number");
  });

  it("writes a typed NUMBER for a non-empty cooldown", () => {
    const { getByLabelText, onChange } = renderChain([A, B]);
    fireEvent.change(getByLabelText(`Cooldown hours for ${A.id}`), { target: { value: "12" } });
    const next = onChange.mock.calls[0][0] as ModelRef[];
    expect(next[0].cooldownHours).toBe(12);
  });

  it("omits thinking entirely when the (inherit) option is selected", () => {
    const { getByLabelText, onChange } = renderChain([{ ...A, thinking: "high" }, B]);
    const override = getByLabelText(`Override thinking level for ${A.id}`);
    fireEvent.click(override); // toggle off
    const next = onChange.mock.calls[0][0] as ModelRef[];
    expect(Object.hasOwn(next[0], "thinking")).toBe(false);
  });

  it("emits an entry the server validator accepts after a numeric edit", () => {
    const { getByLabelText, onChange } = renderChain([A, B]);
    fireEvent.change(getByLabelText(`Context window for ${A.id}`), { target: { value: "128000" } });
    const next = onChange.mock.calls[0][0] as ModelRef[];
    // The real boundary, not a shape guess: round-trip the edited chain through
    // the same validator the PUT route runs.
    expect(validateBlackholeConfig({ observerFallbackModels: next }).errors).toEqual([]);
  });

  it("exposes model group, thinking override, cooldownHours and contextWindow (no free text inputs)", () => {
    const { getByRole, getByLabelText, queryByLabelText } = renderChain([A, B]);
    expect(getByRole("group", { name: /Model for observer entry 1/i })).toBeTruthy();
    expect(queryByLabelText(`Provider for ${A.id}`)).toBeNull();
    expect(queryByLabelText(`Model ID for ${A.id}`)).toBeNull();
    expect(getByLabelText(`Override thinking level for ${A.id}`)).toBeTruthy();
    expect(getByLabelText(`Cooldown hours for ${A.id}`)).toBeTruthy();
    expect(getByLabelText(`Context window for ${A.id}`)).toBeTruthy();
  });
});

describe("Model selector and thinking level integrations (3.1-3.10)", () => {
  beforeEach(() => {
    lastThinkingProps = null;
  });

  it("3.1 exact-match pick with slash id (E10)", () => {
    const models: ModelInfo[] = [
      { provider: "openrouter", id: "meta/llama-3", reasoning: true },
      { provider: "openrouter", id: "meta", reasoning: true },
    ];
    const { getByTestId, onChange } = renderChain([A], true, { models });
    fireEvent.click(getByTestId("model-opt-openrouter/meta/llama-3"));
    expect(onChange).toHaveBeenCalledWith([
      { provider: "openrouter", id: "meta/llama-3" },
    ]);
  });

  it("3.2 level clamp: reasoning model passes blackhole's 6 levels, never max (E11)", () => {
    const models: ModelInfo[] = [{ provider: "openrouter", id: "model-a", reasoning: true }];
    const { getByLabelText } = renderChain([{ ...A, thinking: "low" }], true, { models });
    const checkbox = getByLabelText(`Override thinking level for ${A.id}`) as HTMLElement;
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    expect(lastThinkingProps?.supportedLevels).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("3.3 non-reasoning model provides supportedLevels: ['off'] (E12)", () => {
    const models: ModelInfo[] = [{ provider: "openrouter", id: "model-a", reasoning: false }];
    renderChain([{ ...A, thinking: "off" }], true, { models });
    expect(lastThinkingProps?.supportedLevels).toEqual(["off"]);
  });

  it("3.4 inherit vs off: unchecked has no primitive and inherit text; checked has thinking:'off' (E13)", () => {
    const { getByLabelText, getByText, queryByTestId, onChange } = renderChain([A]);
    const checkbox = getByLabelText(`Override thinking level for ${A.id}`) as HTMLElement;
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(queryByTestId("mock-thinking-level-selector")).toBeNull();
    expect(getByText(/inherit/i)).toBeTruthy();

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith([{ ...A, thinking: "off" }]);
  });

  it("3.5 model pick clears contextWindow and preserves cooldown and thinking (E22)", () => {
    const models: ModelInfo[] = [
      { provider: "c", id: "d", reasoning: true },
    ];
    const entry = {
      provider: "a",
      id: "b",
      contextWindow: 200000,
      cooldownHours: 2,
      thinking: "high" as const,
    };
    const { getByTestId, onChange } = renderChain([entry], true, { models });
    fireEvent.click(getByTestId("model-opt-c/d"));
    expect(onChange).toHaveBeenCalledWith([
      { provider: "c", id: "d", cooldownHours: 2, thinking: "high" },
    ]);
  });

  it("3.6 picking a non-reasoning model drops incompatible level and shows notice (E23)", () => {
    const models: ModelInfo[] = [
      { provider: "c", id: "d", reasoning: false },
    ];
    const entry = { provider: "a", id: "b", thinking: "high" as const };
    const { getByTestId, onChange } = renderChain([entry], true, { models });
    fireEvent.click(getByTestId("model-opt-c/d"));
    expect(onChange).toHaveBeenCalledWith([{ provider: "c", id: "d" }]);
    expect(getByTestId("blackhole-chain-observer-0-level-drop").textContent).toContain("high");
  });

  it("3.7 thinking:'off' survives non-reasoning pick without drop notice (E24)", () => {
    const models: ModelInfo[] = [
      { provider: "c", id: "d", reasoning: false },
    ];
    const entry = { provider: "a", id: "b", thinking: "off" as const };
    const { getByTestId, queryByTestId, onChange } = renderChain([entry], true, { models });
    fireEvent.click(getByTestId("model-opt-c/d"));
    expect(onChange).toHaveBeenCalledWith([{ provider: "c", id: "d", thinking: "off" }]);
    expect(queryByTestId("blackhole-chain-observer-0-level-drop")).toBeNull();
  });

  it("3.8 add cancel leaves chain unchanged (E25)", () => {
    const { getByTestId, queryByTestId, onChange } = renderChain([A]);
    fireEvent.click(getByTestId("blackhole-chain-observer-add"));
    expect(getByTestId("blackhole-chain-observer-adding")).toBeTruthy();

    fireEvent.keyDown(getByTestId("blackhole-chain-observer-adding"), { key: "Escape" });
    expect(queryByTestId("blackhole-chain-observer-adding")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("3.9 add appends {provider, id} only (E26)", () => {
    const models: ModelInfo[] = [{ provider: "g", id: "x-flash" }];
    const { getByTestId, queryByTestId, onChange } = renderChain([A], true, { models });
    fireEvent.click(getByTestId("blackhole-chain-observer-add"));
    const addingRow = getByTestId("blackhole-chain-observer-adding");
    fireEvent.click(within(addingRow).getByTestId("model-opt-g/x-flash"));

    expect(onChange).toHaveBeenCalledWith([A, { provider: "g", id: "x-flash" }]);
    expect(queryByTestId("blackhole-chain-observer-adding")).toBeNull();
  });

  it("3.10 registry ok -> unavailable: stored id rendered in plain-text span, picker unmounted (X2)", () => {
    const { getByTestId, queryByTestId, rerender } = renderChain([A], true, { registry: "ok" });
    expect(getByTestId("mock-model-selector")).toBeTruthy();

    rerender(
      withUiPrimitiveProvider(
        {
          [UI_PRIMITIVE_KEYS.modelSelector]: MockModelSelector,
          [UI_PRIMITIVE_KEYS.thinkingLevelSelector]: MockThinkingLevelSelector,
        },
        <ChainEditor
          worker="observer"
          name="Observer"
          role="Extracts facts"
          entries={[A]}
          onChange={vi.fn()}
          baseModel={{ provider: "openrouter", id: "base-model" }}
          sessionFallback={true}
          registry="unavailable"
        />,
      ),
    );

    expect(queryByTestId("mock-model-selector")).toBeNull();
    const span = getByTestId("blackhole-chain-observer-0-model");
    expect(span.textContent).toBe("openrouter/model-a");
  });
});


describe("role-aware slots (add-role-aware-model-refs)", () => {
  it("entry pickers enable the Role tab and a role pick marks the entry as following it", () => {
    const { getByTestId, onChange } = renderChain([A, B]);
    expect(getByTestId("blackhole-chain-observer-entry-0").querySelector('[data-testid="mock-model-selector"]')?.getAttribute("data-allow-roles")).toBe("true");
    fireEvent.click(within(getByTestId("blackhole-chain-observer-entry-0")).getByTestId("role-opt-fast"));
    const next = onChange.mock.calls[0]![0] as ModelRef[];
    expect(next[0]).toMatchObject({ role: "@fast", provider: "openrouter", id: "model-a" });
    expect(next[1]).toEqual(B);
  });

  it("a bound entry shows its role as the picker's current value and hides the thinking override", () => {
    const { getByTestId, queryByTestId } = renderChain([{ ...A, role: "@fast", roleStatus: "ok" }]);
    expect(getByTestId("blackhole-chain-observer-entry-0").querySelector('[data-testid="mock-model-selector"]')?.getAttribute("data-current")).toBe("@fast");
    expect(getByTestId("blackhole-chain-observer-entry-0-role").textContent).toBe("@fast");
    expect(getByTestId("blackhole-entry-0-thinking-from-role")).toBeTruthy();
    expect(queryByTestId("blackhole-chain-observer-entry-0-role-status")).toBeNull();
  });

  it("a dangling slot shows its status; a detached slot offers Reattach", () => {
    const onReattach = vi.fn();
    const { getByTestId } = renderChain(
      [{ ...A, role: "@fast", roleStatus: "detached" }, { ...B, role: "@fast", roleStatus: "dangling" }],
      true,
      { onReattach },
    );
    expect(getByTestId("blackhole-chain-observer-entry-0-role-status").getAttribute("data-status")).toBe("detached");
    expect(getByTestId("blackhole-chain-observer-entry-1-role-status").getAttribute("data-status")).toBe("dangling");
    fireEvent.click(getByTestId("blackhole-chain-observer-reattach-0"));
    expect(onReattach).toHaveBeenCalledWith(0);
  });

  it("a direct pick on a bound entry clears the role", () => {
    const { getByTestId, onChange } = renderChain([{ ...A, role: "@fast", roleStatus: "ok" }]);
    fireEvent.click(within(getByTestId("blackhole-chain-observer-entry-0")).getByTestId("model-opt-ollama/model-b"));
    const next = onChange.mock.calls[0]![0] as ModelRef[];
    expect(next[0]!.role).toBeUndefined();
    expect(next[0]).toMatchObject({ provider: "ollama", id: "model-b" });
  });
});

// ── retro-ux-model-selector: shared RoleRef, status vocabulary, notices ──
describe("chain slot role refs + notices (retro-ux-model-selector)", () => {
  it("E14: role-bound summaries render RoleRef with the file value; status pills; 'No model assigned' without a value; detached callout", () => {
    const onReattach = vi.fn();
    const { getByTestId } = renderChain(
      [
        { provider: "anthropic", id: "claude-sonnet-4-5", role: "@coding", roleStatus: "detached" },
        { provider: "anthropic", id: "claude-haiku-4-5", role: "@research", roleStatus: "dangling" },
        { provider: "", id: "", role: "@research" },
      ],
      true,
      { onReattach },
    );
    const e0 = getByTestId("blackhole-chain-observer-entry-0");
    expect(getByTestId("blackhole-chain-observer-entry-0-role").textContent).toBe("@coding");
    expect(e0.querySelector("[data-role-ref-model]")?.textContent).toContain("anthropic/claude-sonnet-4-5");
    const s0 = getByTestId("blackhole-chain-observer-entry-0-role-status");
    expect(s0.textContent).toBe("Detached");
    expect(s0.getAttribute("data-status")).toBe("detached");
    expect(s0.className).toContain("--severity-warning-bg");
    const e1 = getByTestId("blackhole-chain-observer-entry-1");
    expect(e1.querySelector("[data-role-ref-model]")?.textContent).toContain("claude-haiku-4-5");
    expect(getByTestId("blackhole-chain-observer-entry-1-role-status").textContent).toBe("Role unassigned, keeps its last model");
    const e2 = getByTestId("blackhole-chain-observer-entry-2");
    expect(within(e2).getByText("No model assigned")).toBeTruthy();
    expect(e2.querySelector("[data-role-ref-model]")).toBeNull();
    // detached callout: reason + "Reattach to @coding"
    const btn = getByTestId("blackhole-chain-observer-reattach-0");
    expect(btn.textContent).toBe("Reattach to @coding");
    expect(btn.parentElement?.className).toContain("--severity-warning-bg");
    expect(btn.parentElement?.textContent).toContain("no longer follows @coding");
    fireEvent.click(btn);
    expect(onReattach).toHaveBeenCalledWith(0);
  });

  it("E15: the level-drop notice is a warning callout with the one-sentence copy, an icon and no emoji", () => {
    const models: ModelInfo[] = [{ provider: "c", id: "d", reasoning: false }];
    const { getByTestId } = renderChain([{ provider: "a", id: "b", thinking: "high" }], true, { models });
    fireEvent.click(getByTestId("model-opt-c/d"));
    const notice = getByTestId("blackhole-chain-observer-0-level-drop");
    expect(notice.textContent).toBe("Thinking level high isn't supported by c/d, so the level was dropped.");
    expect(notice.className).toContain("--severity-warning-bg");
    expect(notice.querySelector("svg")).toBeTruthy();
    expect(notice.textContent).not.toMatch(/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u);
  });
});


describe("chain rows use kit status + danger-ghost controls (retro-ux-plugin-settings-wave-2, X11/BH7)", () => {
  it("the remove control is a named danger-ghost icon button, no accent-red, 11px+ text, no glyph", () => {
    const { getByTestId, container } = renderChain([A, B]);
    const remove = getByTestId("blackhole-chain-observer-remove-1");
    expect(remove.getAttribute("aria-label")).toBe("Remove model-b from the observer chain");
    expect(remove.className).toContain("--severity-error");
    expect(remove.textContent).toBe("");
    expect(remove.querySelector("svg")).toBeTruthy();
    expect(container.innerHTML).not.toContain("accent-red");
    expect(container.innerHTML).not.toMatch(/text-\[(9|10)px\]/);
  });

  it("the Primary marker is a neutral pill and the move buttons carry icons, not arrow glyphs", () => {
    const { getByTestId, container } = renderChain([A, B]);
    const first = getByTestId("blackhole-chain-observer-entry-0");
    expect(within(first).getByText("Primary").getAttribute("data-tone")).toBe("neutral");
    expect(getByTestId("blackhole-chain-observer-up-1").querySelector("svg")).toBeTruthy();
    expect(container.textContent).not.toMatch(/[↑↓✕]/);
  });

  it("no interactive control lives inside a <summary>", () => {
    const { container } = renderChain([A, B]);
    for (const summary of Array.from(container.querySelectorAll("summary"))) {
      expect(summary.querySelector("button, input, select, a")).toBeNull();
    }
  });
});
