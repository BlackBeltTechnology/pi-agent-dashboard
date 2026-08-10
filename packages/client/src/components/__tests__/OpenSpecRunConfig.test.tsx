import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenSpecRunConfigValue } from "../../lib/state/OpenSpecRunConfigContext.js";
import { useOpenSpecRunConfig } from "../../lib/state/OpenSpecRunConfigContext.js";
import { makeRunConfig, RunConfigHarness } from "../../test-support/runConfigHarness.js";
import { useOpenSpecRunConfigRow } from "../openspec/useOpenSpecRunConfigRow.js";

afterEach(() => cleanup());

// Test host exercising the row hook + gate.
function Host({
  onSend,
  timeoutMs,
}: {
  onSend: () => void;
  timeoutMs?: number;
}) {
  const { rowElement, submit, sending } = useOpenSpecRunConfigRow({ timeoutMs });
  return (
    <div>
      {rowElement}
      <button type="button" data-testid="host-send" onClick={() => submit(onSend)}>
        send
      </button>
      <span data-testid="host-sending">{sending ? "1" : "0"}</span>
    </div>
  );
}

function renderHost(value: OpenSpecRunConfigValue, props: React.ComponentProps<typeof Host>) {
  return render(
    <RunConfigHarness value={value}>
      <Host {...props} />
    </RunConfigHarness>,
  );
}

function selectModel(label: string) {
  fireEvent.click(screen.getByTestId("model-selector-button"));
  fireEvent.click(screen.getByText(label));
}

describe("useOpenSpecRunConfig context", () => {
  it("throws when used outside the provider", () => {
    expect(() => renderHook(() => useOpenSpecRunConfig())).toThrow(/OpenSpecRunConfigProvider/);
  });

  it("returns the session values inside the provider", () => {
    const value = makeRunConfig();
    const { result } = renderHook(() => useOpenSpecRunConfig(), {
      wrapper: ({ children }) => <RunConfigHarness value={value}>{children}</RunConfigHarness>,
    });
    expect(result.current.model).toBe("anthropic/claude-sonnet-4-6");
    expect(result.current.thinkingLevel).toBe("high");
  });
});

describe("run-config row", () => {
  it("seeds the selectors from the session and requests models on open", () => {
    const value = makeRunConfig();
    renderHost(value, { onSend: vi.fn() });
    expect(screen.getByTestId("model-selector-button").textContent).toContain(
      "anthropic/claude-sonnet-4-6",
    );
    expect(screen.getByTestId("thinking-level-button").textContent).toContain("high");
    expect(value.refreshModels).toHaveBeenCalledOnce();
  });

  it("shows the disclosure only once a control differs from the session", () => {
    const value = makeRunConfig();
    renderHost(value, { onSend: vi.fn() });
    expect(screen.queryByTestId("run-config-disclosure")).toBeNull();
    selectModel("openai/gpt-5.1-codex");
    expect(screen.getByTestId("run-config-disclosure")).toBeTruthy();
    // Revert to the session value clears the disclosure.
    selectModel("anthropic/claude-sonnet-4-6");
    expect(screen.queryByTestId("run-config-disclosure")).toBeNull();
  });

  it("exposes aria-haspopup/expanded/controls on both selector triggers", () => {
    renderHost(makeRunConfig(), { onSend: vi.fn() });
    const modelBtn = screen.getByTestId("model-selector-button");
    const levelBtn = screen.getByTestId("thinking-level-button");
    expect(modelBtn.getAttribute("aria-haspopup")).toBe("true");
    expect(levelBtn.getAttribute("aria-haspopup")).toBe("listbox");
    expect(modelBtn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(modelBtn);
    expect(modelBtn.getAttribute("aria-expanded")).toBe("true");
    expect(modelBtn.getAttribute("aria-controls")).toBe(
      screen.getByTestId("model-dropdown").getAttribute("id"),
    );
  });

  it("renders a disabled model trigger + explanation when no model list is available", () => {
    const value = makeRunConfig({ models: [] });
    renderHost(value, { onSend: vi.fn() });
    expect((screen.getByTestId("model-selector-button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("run-config-model-loading")).toBeTruthy();
    // Effort stays interactive; send is not blocked.
    expect((screen.getByTestId("thinking-level-button") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("confirm-before-send gate", () => {
  it("sends immediately with no set_model when controls are unchanged", () => {
    const value = makeRunConfig();
    const onSend = vi.fn();
    renderHost(value, { onSend });
    fireEvent.click(screen.getByTestId("host-send"));
    expect(onSend).toHaveBeenCalledOnce();
    expect(value.setModel).not.toHaveBeenCalled();
    expect(value.setThinkingLevel).not.toHaveBeenCalled();
  });

  it("emits set_model first and defers the prompt until the session confirms", () => {
    const value = makeRunConfig();
    const onSend = vi.fn();
    const { rerender } = renderHost(value, { onSend });
    selectModel("openai/gpt-5.1-codex");
    fireEvent.click(screen.getByTestId("host-send"));
    expect(value.setModel).toHaveBeenCalledWith("openai/gpt-5.1-codex");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId("host-sending").textContent).toBe("1");
    expect(screen.getByTestId("run-config-status")).toBeTruthy();
    // Both selectors are disabled via a disabled fieldset (keyboard + pointer);
    // nested buttons match :disabled and cannot be activated.
    expect((screen.getByTestId("run-config-controls") as HTMLFieldSetElement).disabled).toBe(true);
    expect(screen.getByTestId("model-selector-button").matches(":disabled")).toBe(true);
    // Session reports the new model → prompt is sent.
    rerender(
      <RunConfigHarness value={{ ...value, model: "openai/gpt-5.1-codex" }}>
        <Host onSend={onSend} />
      </RunConfigHarness>,
    );
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("sends anyway and notifies on timeout", () => {
    vi.useFakeTimers();
    try {
      const value = makeRunConfig();
      const onSend = vi.fn();
      renderHost(value, { onSend, timeoutMs: 1000 });
      selectModel("openai/gpt-5.1-codex");
      fireEvent.click(screen.getByTestId("host-send"));
      expect(onSend).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(onSend).toHaveBeenCalledOnce();
      expect(value.notify).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not send when the dialog unmounts (cancel) during the pending window", () => {
    vi.useFakeTimers();
    try {
      const value = makeRunConfig();
      const onSend = vi.fn();
      const { unmount } = renderHost(value, { onSend, timeoutMs: 1000 });
      selectModel("openai/gpt-5.1-codex");
      fireEvent.click(screen.getByTestId("host-send"));
      expect(onSend).not.toHaveBeenCalled();
      unmount();
      // Advancing past the timeout after unmount must NOT fire a late send —
      // proves the timeout cleanup ran (guards against removing it).
      vi.advanceTimersByTime(5000);
      expect(onSend).not.toHaveBeenCalled();
      // The emitted model change stays in effect (already sent).
      expect(value.setModel).toHaveBeenCalledWith("openai/gpt-5.1-codex");
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The run-config row is the 9th popover-consumer SURFACE: it mounts the
 * existing `ModelSelector` + `ThinkingLevelSelector` call sites inside the
 * OpenSpec launch dialogs and provides the Dialog panel as their clipping
 * boundary. The panel is `max-h-[80vh] overflow-y-auto`, so an unbounded
 * popover would grow its scroll extent (second scrollbar) exactly like the
 * Settings pane did.
 *
 * See change: fix-popover-pane-bounded-height.
 */
describe("run-config row — bounded popover height (9th consumer surface)", () => {
  /** Stub an element's rect (jsdom has no layout: every rect is zeros). */
  function stubRect(el: Element, rect: Partial<DOMRect>) {
    const full = {
      top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
      toJSON: () => ({}), ...rect,
    } as DOMRect;
    el.getBoundingClientRect = () => full;
  }

  /** Render the row inside a `role="dialog"` panel, as the real Dialog does. */
  function renderInDialog(value: OpenSpecRunConfigValue) {
    const utils = render(
      <RunConfigHarness value={value}>
        {/* Mirrors packages/client-utils/src/Dialog.tsx:83-91 — the panel that
            carries role="dialog" + max-h-[80vh] overflow-y-auto. */}
        <div role="dialog" aria-modal="true" data-testid="fake-dialog-panel">
          <Host onSend={vi.fn()} />
        </div>
      </RunConfigHarness>,
    );
    return { ...utils, panel: screen.getByTestId("fake-dialog-panel") };
  }

  it("resolves its boundary to the dialog panel, not the viewport", () => {
    const { panel } = renderInDialog(makeRunConfig());
    // A short dialog panel well inside jsdom's 768px viewport.
    stubRect(panel, { top: 100, bottom: 400, left: 0, right: 600 });
    const trigger = screen.getByTestId("model-selector-button");
    stubRect(trigger, { top: 300, bottom: 320, left: 0, right: 200 });

    fireEvent.click(trigger);
    const dropdown = screen.getByTestId("model-dropdown");

    // spaceAbove = 300 - 100 - 8 = 192; spaceBelow = 400 - 320 - 8 = 72 → flips up.
    // Measured against the VIEWPORT it would instead be 768 - 320 - 8 = 440,
    // which is what a missing boundary would produce.
    expect(dropdown.style.maxHeight).toBe("192px");
  });

  it("contrast: with no dialog ancestor the same rects fall back to the viewport", () => {
    // Proves the assertion above is load-bearing rather than tautological: drop
    // the `role="dialog"` ancestor and `closest()` finds nothing, so the hook
    // measures `window.innerHeight` (768 in jsdom) and returns a bound the
    // panel could never have honoured.
    render(
      <RunConfigHarness value={makeRunConfig()}>
        <Host onSend={vi.fn()} />
      </RunConfigHarness>,
    );
    const trigger = screen.getByTestId("model-selector-button");
    stubRect(trigger, { top: 300, bottom: 320, left: 0, right: 200 });

    fireEvent.click(trigger);
    // spaceBelow = 768 - 320 - 8 = 440 (viewport), NOT the 192px pane bound.
    expect(screen.getByTestId("model-dropdown").style.maxHeight).toBe("440px");
  });

  it("caps the 260px list floor at the available space so it cannot overflow the panel", () => {
    const { panel } = renderInDialog(makeRunConfig());
    stubRect(panel, { top: 100, bottom: 400, left: 0, right: 600 });
    const trigger = screen.getByTestId("model-selector-button");
    stubRect(trigger, { top: 300, bottom: 320, left: 0, right: 200 });

    fireEvent.click(trigger);
    const dropdown = screen.getByTestId("model-dropdown");

    // ModelSelector opts into LIST_POPOVER_MIN_HEIGHT (260), but only 192px is
    // available: minHeight = min(260, 192) = 192. The floor collapses onto the
    // bound instead of inflating past the panel edge.
    expect(dropdown.style.minHeight).toBe("192px");
    expect(dropdown.style.maxHeight).toBe("192px");
    expect(Number.parseFloat(dropdown.style.minHeight)).toBeLessThanOrEqual(
      Number.parseFloat(dropdown.style.maxHeight),
    );
  });

  it("applies BOTH bounds to every popover in the row", () => {
    renderInDialog(makeRunConfig());

    // Model selector (opts into the 260 floor).
    fireEvent.click(screen.getByTestId("model-selector-button"));
    const modelDropdown = screen.getByTestId("model-dropdown");
    expect(modelDropdown.style.maxHeight).not.toBe("");
    expect(modelDropdown.style.minHeight).not.toBe("");

    // Thinking-level selector (keeps the default 120 floor). Its bounds live on
    // the inner scroll region.
    fireEvent.click(screen.getByTestId("thinking-level-button"));
    const levelScroll = screen
      .getByTestId("thinking-level-dropdown")
      .querySelector<HTMLElement>(".overflow-y-auto");
    expect(levelScroll).not.toBeNull();
    expect(levelScroll?.style.maxHeight).not.toBe("");
    expect(levelScroll?.style.minHeight).not.toBe("");
  });
});