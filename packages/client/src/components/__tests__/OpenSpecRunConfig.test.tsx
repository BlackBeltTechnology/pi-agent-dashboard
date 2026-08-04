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
    expect(modelBtn.getAttribute("aria-haspopup")).toBe("listbox");
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
    const value = makeRunConfig();
    const onSend = vi.fn();
    const { unmount } = renderHost(value, { onSend });
    selectModel("openai/gpt-5.1-codex");
    fireEvent.click(screen.getByTestId("host-send"));
    expect(onSend).not.toHaveBeenCalled();
    unmount();
    expect(onSend).not.toHaveBeenCalled();
    // The emitted model change stays in effect (already sent).
    expect(value.setModel).toHaveBeenCalledWith("openai/gpt-5.1-codex");
  });
});