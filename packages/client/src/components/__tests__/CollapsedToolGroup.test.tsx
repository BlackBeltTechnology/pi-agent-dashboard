import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
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

const ctx: ToolContext = { editors: [] };

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
    const group: ToolCallGroup = {
      type: "group",
      toolName: "bash",
      summary: `$ ${longCommand}`,
      messages: [makeMsg("m1", longCommand), makeMsg("m2", longCommand)],
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
});
