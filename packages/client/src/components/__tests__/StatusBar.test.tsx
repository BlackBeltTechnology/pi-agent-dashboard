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
    const rows = screen.getAllByTestId("model-row");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("gpt-4.1");
  });

  it("calls onSelectModel when model clicked", () => {
    const onSelect = vi.fn();
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={onSelect} onSelectThinkingLevel={() => {}} />);
    fireEvent.click(screen.getByTestId("model-selector-button"));
    // Click the gpt-4.1 row (rows are data-testid="model-row"; star toggle is nested)
    const row = screen.getAllByTestId("model-row").find((r) => r.textContent?.includes("gpt-4.1"));
    fireEvent.click(row!);
    expect(onSelect).toHaveBeenCalledWith("openai/gpt-4.1");
  });

  it("is disabled when no models available", () => {
    render(<StatusBar model="anthropic/claude-4" status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    const btn = screen.getByTestId("model-selector-button");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });
});

describe("StatusBar model refresh (refresh-model-selector-models)", () => {
  it("forwards the footer refresh to onRefreshModels, sending request_models for the selected session even when modelsMap already has it", () => {
    // Mirror the App wiring: send() closure + selectedId, guarded ONLY on
    // selectedId (the !modelsMap.has(sid) fetch-once guard must NOT apply).
    const send = vi.fn();
    const selectedId = "s1";
    const modelsMap = new Map<string, ModelInfo[]>([[selectedId, models]]); // already cached
    const onRefreshModels = () => selectedId && send({ type: "request_models", sessionId: selectedId });

    render(
      <StatusBar
        model="anthropic/claude-4"
        models={modelsMap.get(selectedId)}
        status="idle"
        onSelectModel={() => {}}
        onSelectThinkingLevel={() => {}}
        onRefreshModels={onRefreshModels}
      />,
    );
    fireEvent.click(screen.getByTestId("model-selector-button"));
    fireEvent.click(screen.getByTestId("model-refresh"));
    expect(send).toHaveBeenCalledWith({ type: "request_models", sessionId: selectedId });
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
