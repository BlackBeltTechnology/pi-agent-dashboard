/**
 * Inline streamingBehavior badge tests — verifies the user bubble shows a
 * "steered" / "queued" badge when a message arrived mid-stream, and shows
 * nothing for an ordinary (idle) user message.
 *
 * See change: surface-input-streaming-behavior.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { createInitialState, type ChatMessage } from "../../lib/chat/event-reducer.js";
import type { ToolContext } from "../tool-renderers/index.js";

afterEach(() => cleanup());

const defaultToolContext: ToolContext = {};

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

function renderWithUser(extra: Partial<ChatMessage>) {
  const state = createInitialState();
  state.messages.push({
    id: "u1",
    role: "user",
    content: "do the thing",
    timestamp: Date.now(),
    ...extra,
  });
  return render(
    <ThemeProvider>
      <ChatView sessionId="s1" state={state} toolContext={defaultToolContext} />
    </ThemeProvider>,
  );
}

describe("ChatView streamingBehavior badge", () => {
  it("renders 'steered' badge for streamingBehavior=steer", () => {
    const { getByText } = renderWithUser({ streamingBehavior: "steer" });
    const badge = getByText("steered");
    expect(badge).toBeTruthy();
    expect(badge.getAttribute("title")).toMatch(/steered the current turn/i);
  });

  it("renders 'queued' badge for streamingBehavior=followUp", () => {
    const { getByText } = renderWithUser({ streamingBehavior: "followUp" });
    const badge = getByText("queued");
    expect(badge).toBeTruthy();
    expect(badge.getAttribute("title")).toMatch(/after the current turn/i);
  });

  it("renders no badge for an ordinary idle user message", () => {
    const { queryByText } = renderWithUser({});
    expect(queryByText("steered")).toBeNull();
    expect(queryByText("queued")).toBeNull();
  });
});
