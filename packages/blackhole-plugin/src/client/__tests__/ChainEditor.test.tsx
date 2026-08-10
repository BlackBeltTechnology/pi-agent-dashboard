/**
 * L1 component tests for the chain editor: ordering, promotion, keyboard
 * operability, boundary disabling, accessible names, and the implicit tail
 * (test-plan E19, E21, F1-F5 at component level; the browser versions live in
 * the L3 Playwright spec).
 *
 * See change: add-blackhole-plugin.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ModelRef, validateBlackholeConfig } from "../../shared/blackhole-config.js";
import { ChainEditor } from "../ChainEditor.js";

afterEach(cleanup);

const A: ModelRef = { provider: "openrouter", id: "model-a" };
const B: ModelRef = { provider: "ollama", id: "model-b" };
const C: ModelRef = { provider: "cerebras", id: "model-c" };

function renderChain(entries: ModelRef[], sessionFallback = true) {
  const onChange = vi.fn();
  const utils = render(
    <ChainEditor
      worker="observer"
      name="Observer"
      role="Extracts facts"
      entries={entries}
      onChange={onChange}
      baseModel={{ provider: "openrouter", id: "base-model" }}
      sessionFallback={sessionFallback}
    />,
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
    fireEvent.change(getByLabelText(`Thinking level for ${A.id}`), { target: { value: "" } });
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

  it("exposes provider, id, thinking, cooldownHours and contextWindow", () => {
    const { getByLabelText } = renderChain([A, B]);
    expect(getByLabelText(`Provider for ${A.id}`)).toBeTruthy();
    expect(getByLabelText(`Model ID for ${A.id}`)).toBeTruthy();
    expect(getByLabelText(`Thinking level for ${A.id}`)).toBeTruthy();
    expect(getByLabelText(`Cooldown hours for ${A.id}`)).toBeTruthy();
    expect(getByLabelText(`Context window for ${A.id}`)).toBeTruthy();
  });
});
