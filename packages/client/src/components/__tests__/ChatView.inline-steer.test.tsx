/**
 * Inline-chat steering tests — verifies the v2 design where pending steer
 * messages render as user-style bubbles INSIDE the chat list (not as chips
 * in QueuePanel above CommandInput).
 *
 * See change: add-followup-edit-and-steer-cancel (tasks 12.x).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

afterEach(() => cleanup());
import React from "react";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import type { ToolContext } from "../tool-renderers/index.js";

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

function renderWith(overrides: { pendingSteering?: string[]; withMessages?: boolean } = {}) {
  const state = createInitialState();
  if (overrides.withMessages) {
    state.messages.push({
      id: "u1",
      role: "user",
      content: "previous user message",
      timestamp: Date.now() - 1000,
    });
    state.messages.push({
      id: "a1",
      role: "assistant",
      content: "previous assistant response",
      timestamp: Date.now() - 500,
    });
  }
  return render(
    <ThemeProvider>
      <ChatView
        sessionId="s1"
        state={state}
        toolContext={defaultToolContext}
        pendingSteering={overrides.pendingSteering}
      />
    </ThemeProvider>,
  );
}

describe("ChatView inline-chat steering", () => {
  it("renders nothing steer-related when pendingSteering is empty", () => {
    const { queryAllByTestId } = renderWith({ pendingSteering: [] });
    expect(queryAllByTestId("pending-steer-card")).toHaveLength(0);
  });

  it("renders nothing steer-related when pendingSteering is undefined", () => {
    const { queryAllByTestId } = renderWith({ pendingSteering: undefined });
    expect(queryAllByTestId("pending-steer-card")).toHaveLength(0);
  });

  it("renders a user-style bubble per pending steer entry", () => {
    const { getAllByTestId } = renderWith({ pendingSteering: ["focus on X", "also try Y"] });
    const cards = getAllByTestId("pending-steer-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("focus on X");
    expect(cards[1].textContent).toContain("also try Y");
  });

  it("each card has a STEERING header and spinner", () => {
    const { getAllByTestId } = renderWith({ pendingSteering: ["msg"] });
    const card = getAllByTestId("pending-steer-card")[0];
    expect(card.textContent?.toLowerCase()).toContain("steering");
    // Spinner is rendered via @mdi mdiLoading — check for the animate-spin class.
    expect(card.querySelector(".animate-spin")).toBeTruthy();
  });

  // Steering ✕ cancel button removed: pi's ExtensionAPI doesn't expose
  // queue mutation, so the button was a silent lie — pi delivered the
  // message anyway. See change: unify-status-banner-and-terminal-limit-stop.
  it("no cancel button rendered on steer cards (pi API gap, fictional clearSteeringQueue)", () => {
    const { queryAllByTestId } = renderWith({ pendingSteering: ["foo", "bar"] });
    expect(queryAllByTestId("pending-steer-cancel")).toHaveLength(0);
  });

  it("cards render in user-bubble style (right-aligned + blue border)", () => {
    const { getAllByTestId } = renderWith({ pendingSteering: ["msg"] });
    const card = getAllByTestId("pending-steer-card")[0];
    expect(card.className).toContain("justify-end");
    const inner = card.firstElementChild as HTMLElement;
    expect(inner.className).toMatch(/bg-blue-500\/10/);
    expect(inner.className).toMatch(/border-l-blue-400/);
  });

  it("renders cards AFTER previous chat messages (positioned at bottom)", () => {
    const { getByTestId, container } = renderWith({
      withMessages: true,
      pendingSteering: ["latest steer"],
    });
    const card = getByTestId("pending-steer-card");
    // The steer card is a sibling later in the chat list than the assistant
    // message bubble. Walk the container's children and assert order.
    const all = container.querySelectorAll("div");
    let assistantSeen = false;
    let steerAfterAssistant = false;
    for (const el of Array.from(all)) {
      const t = el.textContent || "";
      // Direct text match (no descendants) to identify the actual leaf nodes.
      if (el.children.length === 0 || el.querySelector("[data-testid='pending-steer-card']") === null) {
        if (t.includes("previous assistant response") && !t.includes("latest steer")) {
          assistantSeen = true;
        }
        if (el === card || card.contains(el)) {
          if (assistantSeen) steerAfterAssistant = true;
          break;
        }
      }
    }
    expect(steerAfterAssistant).toBe(true);
  });

  it("empty-state guard hides 'No messages yet' placeholder when pendingSteering is non-empty", () => {
    const { queryByText } = renderWith({ pendingSteering: ["only thing"] });
    expect(queryByText("No messages yet")).toBeNull();
  });
});
