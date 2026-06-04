import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { StatusBar } from "../StatusBar.js";
import { ChatViewMenu } from "../ChatViewMenu.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

const models: ModelInfo[] = [
  { provider: "anthropic", id: "claude-4" },
  { provider: "openai", id: "gpt-4.1" },
];

describe("StatusBar", () => {
  it("renders model selector with current model", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    expect(screen.getByTestId("model-selector-button").textContent).toContain("anthropic/claude-4");
  });

  it("shows working status when streaming", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="streaming" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    expect(screen.getByTestId("working-status")).toBeTruthy();
    expect(screen.getByTestId("working-status").textContent).toContain("Thinking");
  });

  it("shows tool name when running tool", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="streaming" currentTool="bash" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    expect(screen.getByTestId("working-status").textContent).toContain("bash");
  });

  it("hides working status when idle", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    expect(screen.queryByTestId("working-status")).toBeNull();
  });
});

describe("StatusBar display-prefs menu (relocate-view-menu-to-status-bar)", () => {
  it("renders the View menu inside the status bar, after refresh and before the model selector", () => {
    render(
      <StatusBar
        model="anthropic/claude-4"
        models={models}
        status="idle"
        onSelectModel={() => {}}
        onSelectThinkingLevel={() => {}}
        leading={(
          <>
            <button data-testid="status-refresh" type="button">⟳</button>
            <ChatViewMenu sessionId="s1" currentOverride={undefined} send={() => {}} />
          </>
        )}
      />,
    );
    const statusBar = screen.getByTestId("status-bar");
    const refresh = screen.getByTestId("status-refresh");
    // Exactly one View trigger must exist, and it must live in the status bar.
    const viewButtons = screen.getAllByTitle("View options");
    expect(viewButtons).toHaveLength(1);
    const viewButton = viewButtons[0];
    const modelButton = screen.getByTestId("model-selector-button");

    expect(statusBar.contains(viewButton)).toBe(true);
    // DOM order: refresh -> View menu -> model selector
    expect(refresh.compareDocumentPosition(viewButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(viewButton.compareDocumentPosition(modelButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("ModelSelector", () => {
  it("opens dropdown on click", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    fireEvent.click(screen.getByTestId("model-selector-button"));
    expect(screen.getByTestId("model-dropdown")).toBeTruthy();
  });

  it("filters models", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    fireEvent.click(screen.getByTestId("model-selector-button"));
    const input = screen.getByTestId("model-filter");
    fireEvent.change(input, { target: { value: "gpt" } });
    // Should show gpt-4.1 but not claude-4
    const buttons = screen.getByTestId("model-dropdown").querySelectorAll("button");
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain("gpt-4.1");
  });

  it("calls onSelectModel when model clicked", () => {
    const onSelect = vi.fn();
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={onSelect} onSelectThinkingLevel={() => {}} />);
    fireEvent.click(screen.getByTestId("model-selector-button"));
    const buttons = screen.getByTestId("model-dropdown").querySelectorAll("button");
    // Click second model (openai/gpt-4.1)
    fireEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith("openai/gpt-4.1");
  });

  it("is disabled when no models available", () => {
    render(<StatusBar model="anthropic/claude-4" status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    const btn = screen.getByTestId("model-selector-button");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });
});

describe("ThinkingLevelSelector", () => {
  it("renders current thinking level", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} thinkingLevel="high" status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    expect(screen.getByTestId("thinking-level-button").textContent).toContain("high");
  });

  it("shows 'off' when no thinking level set", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    expect(screen.getByTestId("thinking-level-button").textContent).toContain("off");
  });

  it("opens dropdown and calls onSelectThinkingLevel", () => {
    const onSelect = vi.fn();
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={() => {}} onSelectThinkingLevel={onSelect} />);
    fireEvent.click(screen.getByTestId("thinking-level-button"));
    expect(screen.getByTestId("thinking-level-dropdown")).toBeTruthy();
    const buttons = screen.getByTestId("thinking-level-dropdown").querySelectorAll("button");
    // Click "high" (index 4)
    fireEvent.click(buttons[4]);
    expect(onSelect).toHaveBeenCalledWith("high");
  });
});
