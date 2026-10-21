/**
 * Render-level suite for chat-motion LIVE-ARRIVAL entry (tasks 2.2, 2.4–2.12,
 * 2.14). jsdom has no CSS, so "entering" is observed as the latched
 * `chat-motion-enter` class; the real @starting-style transition is the
 * Playwright F1 scenario.
 *
 * Harness glue copied from `ChatView.replay-in-flight-pill.test.tsx`.
 * See change: add-fluid-chat-motion (D2).
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { type ChatMessage, createInitialState, type SessionState } from "../../../lib/chat/event-reducer.js";
import { DisplayPrefsProvider } from "../../../lib/state/DisplayPrefsContext.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import type { ToolContext } from "../../tool-renderers/index.js";
import { ChatView } from "../ChatView.js";

const toolContext: ToolContext = {};
const ENTER = ".chat-motion-enter";

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

afterEach(() => cleanup());

function tool(id: string, status: "running" | "complete" | "error" = "complete", extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `tool-${id}`,
    role: "toolResult",
    content: "bash",
    toolName: "bash",
    toolCallId: id,
    args: { command: `echo ${id}` },
    toolStatus: status,
    result: "ok",
    timestamp: 1000,
    startedAt: 1000,
    ...extra,
  };
}

function stateOf(messages: ChatMessage[], extra: Partial<SessionState> = {}): SessionState {
  return { ...createInitialState(), messages, ...extra };
}

interface Props {
  sessionId?: string;
  state: SessionState;
  replayInFlight?: boolean | undefined;
  pendingSteering?: string[];
  bash?: boolean;
}

function tree(props: Props) {
  const { sessionId = "s1", state, pendingSteering, bash = true } = props;
  // `replayInFlight: undefined` must stay undefined (replay-unaware host); only OMITTING it means false.
  const replayInFlight = "replayInFlight" in props ? props.replayInFlight : false;
  const global = { ...DISPLAY_PRESETS.standard, toolCalls: { ...DISPLAY_PRESETS.standard.toolCalls, bash } };
  return (
    <ThemeProvider>
      <DisplayPrefsProvider value={{ global, getSessionOverride: () => undefined }}>
        <ChatView
          sessionId={sessionId}
          state={state}
          toolContext={toolContext}
          replayInFlight={replayInFlight}
          pendingSteering={pendingSteering}
        />
      </DisplayPrefsProvider>
    </ThemeProvider>
  );
}

const entering = (c: HTMLElement) => c.querySelectorAll(ENTER).length;

describe("ChatView live-arrival entry", () => {
  // E7 — entry seeding
  it("a first commit for a session animates nothing, then a live arrival animates only itself (E7)", () => {
    const thirty = Array.from({ length: 30 }, (_, i) => tool(`t${i}`));
    const { container, rerender } = render(tree({ state: stateOf(thirty) }));
    expect(entering(container)).toBe(0);

    rerender(tree({ state: stateOf([...thirty, tool("live", "running")]) }));
    expect(entering(container)).toBe(1);
    // Latched: the class never re-triggers on a later re-render.
    rerender(tree({ state: stateOf([...thirty, tool("live", "running")]) }));
    expect(entering(container)).toBe(1);
  });

  // E8 — switch-back
  it("switching back to a session whose rows arrived while hidden animates nothing (E8)", () => {
    const a1 = tool("a1");
    const { container, rerender } = render(tree({ sessionId: "A", state: stateOf([a1]) }));
    rerender(tree({ sessionId: "B", state: stateOf([tool("b1")]) }));
    rerender(tree({ sessionId: "A", state: stateOf([a1, tool("a2", "running"), tool("a3", "running"), tool("a4", "running")]) }));
    expect(entering(container)).toBe(0);
  });

  // E9 — bulk guard (BVA)
  it("bulk guard: 4 new tool rows all enter, 5 enter none (E9)", () => {
    const seed = tool("seed");
    const four = ["a", "b", "c", "d"].map((id) => tool(id, "running"));
    const r4 = render(tree({ state: stateOf([seed]) }));
    r4.rerender(tree({ state: stateOf([seed, ...four]) }));
    expect(entering(r4.container)).toBe(4);
    cleanup();

    const five = ["a", "b", "c", "d", "e"].map((id) => tool(id, "running"));
    const r5 = render(tree({ state: stateOf([seed]) }));
    r5.rerender(tree({ state: stateOf([seed, ...five]) }));
    expect(entering(r5.container)).toBe(0);
  });

  // E10 — replay-unaware host
  it("a host that does not pass replayInFlight gets no entry class (E10)", () => {
    const { container, rerender } = render(tree({ state: stateOf([tool("seed")]), replayInFlight: undefined }));
    rerender(tree({ state: stateOf([tool("seed"), tool("live", "running")]), replayInFlight: undefined }));
    expect(entering(container)).toBe(0);
  });

  // E11 — re-parenting
  it("a ×N group formed from visible rows does not enter; only a later joiner's line does (E11)", () => {
    const same = (id: string, status: "running" | "complete" = "complete") => tool(id, status, { args: { command: "echo same" } });
    const { container, rerender } = render(tree({ state: stateOf([same("c1"), same("c2")]) }));
    // 3rd identical call arrives → the three fold into a ×N group.
    rerender(tree({ state: stateOf([same("c1"), same("c2"), same("c3", "running")]) }));
    rerender(tree({ state: stateOf([same("c1"), same("c2"), same("c3")]) }));
    expect(container.querySelector('[data-testid="collapsed-group"]')).not.toBeNull();
    expect(container.querySelector(`[data-testid="tool-burst-group"]${ENTER}`)).toBeNull();
    expect(container.querySelector(`[data-testid="collapsed-group"]${ENTER}`)).toBeNull();
    expect(entering(container)).toBe(0);
    // A 4th, different call joins the visible burst: only its own line enters.
    rerender(tree({ state: stateOf([same("c1"), same("c2"), same("c3"), tool("c4", "running")]) }));
    expect(container.querySelector(`[data-testid="tool-burst-group"]${ENTER}`)).toBeNull();
    expect(entering(container)).toBe(1);
  });

  // E12 — steering multiset
  it("steering is a multiset: consume does not animate, a re-add animates one card (E12)", () => {
    const base = stateOf([]);
    const { container, rerender } = render(tree({ state: base, pendingSteering: ["A", "A"] }));
    expect(entering(container)).toBe(0);
    rerender(tree({ state: base, pendingSteering: ["A"] }));
    expect(entering(container)).toBe(0);
    rerender(tree({ state: base, pendingSteering: ["A", "A"] }));
    expect(container.querySelectorAll(`[data-testid="pending-steer-card"]${ENTER}`).length).toBe(1);
    expect(container.querySelectorAll('[data-testid="pending-steer-card"]').length).toBe(2);
  });

  // E13 — filter toggle
  it("toggling a display filter on never animates the rows it reveals (E13)", () => {
    const { container, rerender } = render(tree({ state: stateOf([]), bash: false }));
    rerender(tree({ state: stateOf([tool("b1", "running"), tool("b2", "running")]), bash: false }));
    expect(container.querySelector('[data-testid="tool-burst-group"]')).toBeNull();
    rerender(tree({ state: stateOf([tool("b1", "running"), tool("b2", "running")]), bash: true }));
    expect(container.querySelector('[data-testid="tool-burst-group"]')).not.toBeNull();
    expect(entering(container)).toBe(0);
  });

  // E14 — off-screen arrival while scroll-locked
  it("an arrival while scroll-locked never animates, even after following again (E14)", () => {
    const scrollEl = () => document.querySelector<HTMLElement>('[data-testid="chat-scroll-container"]')!;
    const { container, rerender } = render(tree({ state: stateOf([tool("seed")]) }));
    Object.defineProperty(scrollEl(), "scrollHeight", { configurable: true, value: 3000 });
    Object.defineProperty(scrollEl(), "clientHeight", { configurable: true, value: 400 });
    scrollEl().scrollTop = 0; // far above the bottom
    fireEvent.scroll(scrollEl());
    rerender(tree({ state: stateOf([tool("seed"), tool("off", "running")]) }));
    expect(entering(container)).toBe(0);
    // Back at the bottom: a re-render with the same rows still animates nothing.
    scrollEl().scrollTop = 3000;
    fireEvent.scroll(scrollEl());
    rerender(tree({ state: stateOf([tool("seed"), tool("off", "running")]) }));
    expect(entering(container)).toBe(0);
  });

  // E15 — commit swaps
  it("a pending card and streaming bubble enter; their committed twins do not (E15)", async () => {
    const { container, rerender } = render(tree({ state: stateOf([]) }));
    rerender(
      tree({
        state: stateOf([], {
          streamingText: "Hello there",
          pendingPrompt: { text: "do it", status: "sent" },
        }),
      }),
    );
    // The streaming bubble appears on the first paced reveal frame.
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(container.querySelector(`[data-testid="pending-prompt-card"]${ENTER}`)).not.toBeNull();
    expect(entering(container)).toBe(2); // pending card + streaming bubble

    // message_end commit + server user message confirms the card.
    const committed: ChatMessage[] = [
      { id: "u1", role: "user", content: "do it", timestamp: 2000 },
      { id: "a1", role: "assistant", content: "Hello there", timestamp: 2001 },
    ];
    rerender(tree({ state: stateOf(committed) }));
    expect(container.querySelector('[data-testid="pending-prompt-card"]')).toBeNull();
    expect(entering(container)).toBe(0);
  });

  // 2.2 — ineligible: a user selection held suppresses entry
  it("does not animate while the user is scrolled away (not following)", () => {
    const scrollEl = () => document.querySelector<HTMLElement>('[data-testid="chat-scroll-container"]')!;
    const { container, rerender } = render(tree({ state: stateOf([tool("seed")]) }));
    Object.defineProperty(scrollEl(), "scrollHeight", { configurable: true, value: 3000 });
    Object.defineProperty(scrollEl(), "clientHeight", { configurable: true, value: 400 });
    scrollEl().scrollTop = 0;
    fireEvent.scroll(scrollEl());
    rerender(tree({ state: stateOf([], { pendingPrompt: { text: "x", status: "sending" } }) }));
    expect(entering(container)).toBe(0);
  });

  // X1 — reconnect replay is bulk
  it("a reconnect replay batch animates nothing and plays no completion cue (X1)", () => {
    const seed = [tool("s1", "running"), tool("s2", "running")];
    const { container, rerender } = render(tree({ state: stateOf(seed) }));
    const batch = [
      tool("s1"), // flipped inside the batch
      tool("s2", "error"), // flipped inside the batch
      ...Array.from({ length: 12 }, (_, i) => tool(`r${i}`)),
    ];
    // replayInFlight true: the strict gate.
    rerender(tree({ state: stateOf(batch), replayInFlight: true }));
    expect(entering(container)).toBe(0);
    expect(container.querySelectorAll('[data-testid="tool-completion-cue"]').length).toBe(0);
    // The same batch arriving with the flag already cleared is still bulk.
    cleanup();
    const r2 = render(tree({ state: stateOf(seed) }));
    r2.rerender(tree({ state: stateOf(batch), replayInFlight: false }));
    expect(entering(r2.container)).toBe(0);
    expect(r2.container.querySelectorAll('[data-testid="tool-completion-cue"]').length).toBe(0);
  });
});
