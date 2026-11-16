/**
 * Inline-chat steering tests — verifies the v2 design where pending steer
 * messages render as user-style bubbles INSIDE the chat list (not as chips
 * in QueuePanel above CommandInput).
 *
 * Held steers (bridge-owned-cancellable-steer) carry the follow-up controls:
 * per-entry ✕, image badge, Clear all from two entries (test-plan #E30–#E33).
 *
 * See change: add-followup-edit-and-steer-cancel (tasks 12.x),
 * bridge-owned-cancellable-steer.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

afterEach(() => cleanup());
import React from "react";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import type { ToolContext } from "../tool-renderers/index.js";
import type { SteerEntryView } from "@blackbelt-technology/pi-dashboard-shared/types.js";

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

function renderWith(overrides: {
  pendingSteering?: (SteerEntryView | string)[];
  withMessages?: boolean;
  onCancelSteer?: (id: string) => void;
  onClearSteers?: () => void;
} = {}) {
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
        onCancelSteer={overrides.onCancelSteer}
        onClearSteers={overrides.onClearSteers}
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

  // Steers are cancellable while the BRIDGE holds them (pi's ExtensionAPI
  // still exposes no queue removal). A legacy plain-string entry carries no id,
  // so it stays display-only. See change: bridge-owned-cancellable-steer.
  it("E33: legacy string entries render as steer bubbles without a cancel control; id entries get one", () => {
    const { getAllByTestId, container } = renderWith({
      pendingSteering: ["focus on X", { id: "2", text: "y", imageCount: 0 }],
      onCancelSteer: vi.fn(),
    });
    const cards = getAllByTestId("pending-steer-card");
    expect(cards).toHaveLength(2);
    for (const card of cards) expect(card.textContent?.toLowerCase()).toContain("steering");
    expect(cards[0].querySelectorAll("[data-testid^='pending-steer-cancel-']")).toHaveLength(0);
    expect(cards[1].querySelectorAll("[data-testid='pending-steer-cancel-2']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-testid^='pending-steer-cancel-']")).toHaveLength(1);
  });

  it("E30: each held steer has its own cancel; the image badge shows only on the entry with images", () => {
    const { getAllByTestId, queryAllByTestId } = renderWith({
      pendingSteering: [{ id: "1", text: "x", imageCount: 0 }, { id: "2", text: "y", imageCount: 2 }],
      onCancelSteer: vi.fn(),
    });
    const cards = getAllByTestId("pending-steer-card");
    expect(queryAllByTestId("pending-steer-cancel-1")).toHaveLength(1);
    expect(queryAllByTestId("pending-steer-cancel-2")).toHaveLength(1);
    expect(cards[0].querySelectorAll("[data-testid='pending-steer-attachments']")).toHaveLength(0);
    const badge = cards[1].querySelector("[data-testid='pending-steer-attachments']");
    expect(badge?.textContent).toBe("2");
    expect(cards[1].textContent?.toLowerCase()).toContain("steering");
  });

  it("E31: Clear all is absent at 0 and 1 entries, present at 2", () => {
    const entry = (id: string) => ({ id, text: id, imageCount: 0 });
    for (const [steers, expected] of [[[], 0], [[entry("1")], 0], [[entry("1"), entry("2")], 1]] as const) {
      const { queryAllByTestId, unmount } = renderWith({ pendingSteering: [...steers], onClearSteers: vi.fn() });
      expect(queryAllByTestId("pending-steer-clear-all"), `${steers.length} entries`).toHaveLength(expected);
      unmount();
    }
  });

  it("E32: cancel and Clear all dispatch immediately, with no confirmation", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onCancelSteer = vi.fn();
    const onClearSteers = vi.fn();
    const { getByTestId } = renderWith({
      pendingSteering: [{ id: "1", text: "a", imageCount: 0 }, { id: "2", text: "b", imageCount: 0 }],
      onCancelSteer,
      onClearSteers,
    });
    fireEvent.click(getByTestId("pending-steer-cancel-1"));
    fireEvent.click(getByTestId("pending-steer-clear-all"));
    expect(onCancelSteer).toHaveBeenCalledWith("1");
    expect(onClearSteers).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("E34: two held steers with identical text render as two distinct bubbles without a duplicate-key warning", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getAllByTestId } = renderWith({
      pendingSteering: [{ id: "1", text: "same", imageCount: 0 }, { id: "2", text: "same", imageCount: 0 }],
    });
    expect(getAllByTestId("pending-steer-card")).toHaveLength(2);
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
    errorSpy.mockRestore();
  });

  it("cards render in user-bubble style (right-aligned + blue tint tokens)", () => {
    const { getAllByTestId } = renderWith({ pendingSteering: ["msg"] });
    const card = getAllByTestId("pending-steer-card")[0];
    expect(card.className).toContain("justify-end");
    const inner = card.firstElementChild as HTMLElement;
    expect(inner.className).toMatch(/bg-\[var\(--tint-blue-bg\)\]/);
    expect(inner.className).toMatch(/border-l-\[var\(--accent-blue\)\]/);
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
