/**
 * Change: restore-assistant-greeting-stream
 *
 * A greeting chat row exposes its structured `state` as a row-level DOM
 * attribute `data-greeting-marker="<state>"`, emitted by a greeting-SPECIFIC
 * wrapper in ChatView (the shared MessageBubble is untouched). Non-greeting rows
 * carry no such attribute. A producer-authored raw inline `<svg><path/></svg>`
 * glyph in greeting content renders as real DOM. Presence/count of the marker is
 * asserted before any ordering, so a missing marker fails "expected N, got 0".
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { createInitialState, reduceEvent, type SessionState } from "../../lib/chat/event-reducer.js";
import type { ToolContext } from "../tool-renderers/index.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

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

function greeting(id: string, state: string, content: string, ts: number): DashboardEvent {
  return { eventType: "ib_greeting", timestamp: ts, data: { id, state, content } };
}
function assistantEnd(text: string, ts: number): DashboardEvent {
  return {
    eventType: "message_end",
    timestamp: ts,
    data: { message: { role: "assistant", content: [{ type: "text", text }] } },
  };
}
function apply(events: DashboardEvent[]): SessionState {
  return events.reduce((s, e) => reduceEvent(s, e), createInitialState());
}

describe("ChatView greeting marker", () => {
  it("exposes data-greeting-marker=<state> on the greeting row", () => {
    const state = apply([greeting("g1", "pending_approval", "Jóváhagyásra vár", 1000)]);
    const { container } = render(
      <ThemeProvider>
        <ChatView state={state} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    const markers = container.querySelectorAll("[data-greeting-marker]");
    // Presence/count first — a missing marker fails "expected 1, got 0".
    expect(markers).toHaveLength(1);
    expect(markers[0].getAttribute("data-greeting-marker")).toBe("pending_approval");
  });

  it("does not put the attribute on non-greeting assistant rows", () => {
    const state = apply([assistantEnd("plain assistant", 1000)]);
    const { container } = render(
      <ThemeProvider>
        <ChatView state={state} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    expect(container.querySelectorAll("[data-greeting-marker]")).toHaveLength(0);
  });

  it("one marker per greeting, keyed by state, alongside a plain assistant row", () => {
    const state = apply([
      greeting("g1", "partner_pending", "A", 1000),
      assistantEnd("chat", 2000),
      greeting("g2", "exported", "B", 3000),
    ]);
    const { container } = render(
      <ThemeProvider>
        <ChatView state={state} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    const markers = Array.from(container.querySelectorAll("[data-greeting-marker]"));
    expect(markers).toHaveLength(2);
    expect(markers.map((m) => m.getAttribute("data-greeting-marker"))).toEqual([
      "partner_pending",
      "exported",
    ]);
  });

  it("renders a producer-authored raw inline <svg><path/></svg> glyph as real DOM", () => {
    const state = apply([
      greeting("g1", "exported", 'Kész <svg data-glyph="mdi"><path d="M0 0h24"/></svg>', 1000),
    ]);
    const { container } = render(
      <ThemeProvider>
        <ChatView state={state} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    const row = container.querySelector('[data-greeting-marker="exported"]')!;
    expect(row).toBeTruthy();
    const svg = row.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg!.querySelector("path")).toBeTruthy();
  });
});
