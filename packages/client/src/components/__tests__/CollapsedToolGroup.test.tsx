import { describe, it, expect, vi, beforeAll } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { CollapsedToolGroup } from "../CollapsedToolGroup.js";
import { ThemeProvider } from "../ThemeProvider.js";
import type { ToolCallGroup } from "../../lib/group-tool-calls.js";
import type { ChatMessage } from "../../lib/event-reducer.js";
import type { ToolContext } from "../tool-renderers/index.js";

vi.mock("../../hooks/useMobile.js", () => ({
  useMobile: () => false,
  MobileProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

const ctx: ToolContext = {};

function makeMsg(id: string, command: string): ChatMessage {
  return {
    id,
    role: "toolResult",
    content: "",
    timestamp: 0,
    toolName: "bash",
    toolCallId: id,
    args: { command },
    toolStatus: "complete",
    result: "",
  };
}

describe("CollapsedToolGroup", () => {
  it("preserves the full bash command in the summary (no slice) and exposes it via title=", () => {
    const longCommand =
      "test -e openspec/changes/archive/2026-05-28-bump-pi-compat-to-0-75/proposal.md";
    const groupMsgs = [makeMsg("m1", longCommand), makeMsg("m2", longCommand)];
    const group: ToolCallGroup = {
      type: "group",
      toolName: "bash",
      summary: `$ ${longCommand}`,
      messages: groupMsgs,
      rendered: groupMsgs,
    };
    const { container } = render(
      <ThemeProvider>
        <CollapsedToolGroup group={group} toolContext={ctx} />
      </ThemeProvider>,
    );
    const button = container.querySelector('[data-testid="collapsed-group"]')!;
    expect(button.textContent).toContain(longCommand);
    expect(button.getAttribute("title")).toBe(`$ ${longCommand}`);
    const summarySpan = button.querySelector("span.truncate");
    expect(summarySpan).not.toBeNull();
    expect(summarySpan!.textContent).toBe(`$ ${longCommand}`);
  });

  it("renders absorbed narration from `rendered` when expanded", () => {
    const m1 = makeMsg("m1", "curl x");
    const m2 = makeMsg("m2", "curl x");
    const m3 = makeMsg("m3", "curl x");
    const prose: ChatMessage = {
      id: "p1",
      role: "assistant",
      content: "still starting",
      timestamp: 0,
    };
    const group: ToolCallGroup = {
      type: "group",
      toolName: "bash",
      summary: "$ curl x",
      messages: [m1, m2, m3],
      rendered: [m1, prose, m2, m3],
    };
    const { container, getByTestId, queryByTestId } = render(
      <ThemeProvider>
        <CollapsedToolGroup group={group} toolContext={ctx} />
      </ThemeProvider>,
    );
    // Collapsed: narration hidden.
    expect(queryByTestId("collapsed-group-narration")).toBeNull();
    // Count badge reflects toolResult-only messages (×3), not rendered length.
    expect(container.querySelector('[data-testid="collapsed-group"]')!.textContent).toContain("×3");
    fireEvent.click(container.querySelector('[data-testid="collapsed-group"]')!);
    // Expanded: absorbed prose now visible.
    expect(getByTestId("collapsed-group-narration").textContent).toContain("still starting");
  });
});
