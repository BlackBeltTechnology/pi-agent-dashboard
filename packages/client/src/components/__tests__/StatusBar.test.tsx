import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSelector } from "../settings/ModelSelector.js";
import { StatusBar } from "../shell/StatusBar.js";
import { ThinkingLevelSelector } from "../settings/ThinkingLevelSelector.js";

afterEach(() => cleanup());

const models: ModelInfo[] = [
  { provider: "anthropic", id: "claude-4" },
  { provider: "openai", id: "gpt-4.1" },
];

// ---------------------------------------------------------------------------
// StatusBar — working-status label only (model row retired in
// redesign-prompt-input). T3: no standalone model row renders.
// ---------------------------------------------------------------------------
describe("StatusBar", () => {
  it("shows working status when streaming", () => {
    render(<StatusBar status="streaming" />);
    expect(screen.getByTestId("working-status")).toBeTruthy();
    expect(screen.getByTestId("working-status").textContent).toContain("Thinking");
  });

  it("shows tool name when running tool", () => {
    render(<StatusBar status="streaming" currentTool="bash" />);
    expect(screen.getByTestId("working-status").textContent).toContain("bash");
  });

  it("shows generating when streaming text is present", () => {
    render(<StatusBar status="streaming" streamingText="partial" />);
    expect(screen.getByTestId("working-status").textContent).toContain("Generating");
  });

  it("renders nothing when idle", () => {
    const { container } = render(<StatusBar status="idle" />);
    expect(screen.queryByTestId("working-status")).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("T3: does NOT render a standalone model selector row", () => {
    const { container } = render(<StatusBar status="streaming" />);
    expect(container.querySelector('[data-testid="model-selector-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="thinking-level-button"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ModelSelector — now hosted in the composer toolbar; tested directly.
// ---------------------------------------------------------------------------
describe("ModelSelector", () => {
  it("renders current model", () => {
    render(<ModelSelector current="anthropic/claude-4" models={models} onSelect={() => {}} />);
    expect(screen.getByTestId("model-selector-button").textContent).toContain("anthropic/claude-4");
  });

  it("opens dropdown on click", () => {
    render(<ModelSelector current="anthropic/claude-4" models={models} onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId("model-selector-button"));
    expect(screen.getByTestId("model-dropdown")).toBeTruthy();
  });

  it("filters models", () => {
    render(<ModelSelector current="anthropic/claude-4" models={models} onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId("model-selector-button"));
    fireEvent.change(screen.getByTestId("model-filter"), { target: { value: "gpt" } });
    const rows = screen.getAllByTestId("model-row");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("gpt-4.1");
  });

  it("calls onSelect when model clicked", () => {
    const onSelect = vi.fn();
    render(<ModelSelector current="anthropic/claude-4" models={models} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("model-selector-button"));
    const row = screen.getAllByTestId("model-row").find((r) => r.textContent?.includes("gpt-4.1"));
    fireEvent.click(row!);
    expect(onSelect).toHaveBeenCalledWith("openai/gpt-4.1");
  });

  it("is disabled when no models available", () => {
    render(<ModelSelector current="anthropic/claude-4" onSelect={() => {}} />);
    expect(screen.getByTestId("model-selector-button").hasAttribute("disabled")).toBe(true);
  });

  it("forwards the footer refresh to onRefresh (refresh-model-selector-models)", () => {
    const send = vi.fn();
    const selectedId = "s1";
    const onRefresh = () => selectedId && send({ type: "request_models", sessionId: selectedId });
    render(<ModelSelector current="anthropic/claude-4" models={models} onSelect={() => {}} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByTestId("model-selector-button"));
    fireEvent.click(screen.getByTestId("model-refresh"));
    expect(send).toHaveBeenCalledWith({ type: "request_models", sessionId: selectedId });
  });
});

// ---------------------------------------------------------------------------
// ThinkingLevelSelector — now hosted in the composer toolbar; tested directly.
// ---------------------------------------------------------------------------
describe("ThinkingLevelSelector", () => {
  it("renders current thinking level", () => {
    render(<ThinkingLevelSelector current="high" onSelect={() => {}} />);
    expect(screen.getByTestId("thinking-level-button").textContent).toContain("high");
  });

  it("shows 'off' when no thinking level set", () => {
    render(<ThinkingLevelSelector onSelect={() => {}} />);
    expect(screen.getByTestId("thinking-level-button").textContent).toContain("off");
  });

  it("opens dropdown and calls onSelect", () => {
    const onSelect = vi.fn();
    render(<ThinkingLevelSelector onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("thinking-level-button"));
    expect(screen.getByTestId("thinking-level-dropdown")).toBeTruthy();
    const buttons = screen.getByTestId("thinking-level-dropdown").querySelectorAll("button");
    // Click "high" (index 4 in the canonical order).
    fireEvent.click(buttons[4]);
    expect(onSelect).toHaveBeenCalledWith("high");
  });
});
