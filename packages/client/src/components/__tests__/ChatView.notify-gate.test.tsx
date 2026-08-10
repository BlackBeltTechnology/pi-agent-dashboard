/**
 * `notifyMinLevel` gating in the chat transcript.
 *
 * Two invariants matter here and they are NOT the same (design D3):
 *  - `isRowVisible` filters `displayRows`, which the virtualizer counts. A row
 *    filtered here is never counted and never mounted — that gate alone is
 *    functionally sufficient.
 *  - The render branch gates too. Gating ONLY there would leave a counted row
 *    whose wrapper renders nothing — a measured blank.
 * So the row-count invariant passes with EITHER site alone; it is the blank
 * wrapper that betrays a render-branch-only gate, and a structural pin that
 * proves the second site exists.
 *
 * Covers test-plan #F1, #F2, #F3, #F4, #F5.
 * See change: gate-notify-rows-by-level.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { type ChatMessage, createInitialState } from "../../lib/chat/event-reducer.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const CHAT_VIEW_SRC = readFileSync(resolve(here, "../chat/ChatView.tsx"), "utf8");

// Prefs are injected through the hook so each case can pick a floor.
const prefsRef: { current: DisplayPrefs } = {
  current: { ...DISPLAY_PRESETS.everything, notifyMinLevel: "all" },
};
vi.mock("../../hooks/useDisplayPrefs.js", () => ({
  useDisplayPrefs: () => prefsRef.current,
}));

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

afterEach(() => {
  cleanup();
  prefsRef.current = { ...DISPLAY_PRESETS.everything, notifyMinLevel: "all" };
});

const LEVELS = ["info", "success", "warning", "error"] as const;

function notifyRow(level: (typeof LEVELS)[number]): ChatMessage {
  return {
    id: `ui-n-${level}`,
    role: "interactiveUi",
    content: "notify",
    timestamp: Date.now(),
    args: {
      requestId: `n-${level}`,
      method: "notify",
      params: { message: `notify-body-${level}`, level },
      status: "pending",
    },
  } as ChatMessage;
}

function askRow(method: string): ChatMessage {
  return {
    id: `ui-ask-${method}`,
    role: "interactiveUi",
    content: method,
    timestamp: Date.now(),
    args: {
      requestId: `ask-${method}`,
      method,
      params: { title: `ask-title-${method}`, message: `ask-body-${method}` },
      status: "pending",
    },
  } as ChatMessage;
}

function stateWith(messages: ChatMessage[]) {
  const state = createInitialState();
  state.messages.push(...messages);
  return state;
}

function renderChat(state: ReturnType<typeof createInitialState>, onRespondToUi = vi.fn()) {
  const utils = render(
    <ThemeProvider>
      <ChatView
        sessionId="s1"
        state={state}
        toolContext={defaultToolContext}
        onRespondToUi={onRespondToUi}
      />
    </ThemeProvider>,
  );
  return { ...utils, onRespondToUi };
}

/** Every mounted virtual row wrapper. */
function rowWrappers(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-index]"));
}

describe("notify gate — row count vs rendered rows (test-plan #F1)", () => {
  // 2.16
  it("leaves no blank measured row where a hidden notify was", () => {
    prefsRef.current = { ...prefsRef.current, notifyMinLevel: "warnings" };
    const state = stateWith([
      ...LEVELS.map(notifyRow),
      askRow("confirm"),
      askRow("select"),
    ]);
    const { container } = renderChat(state);

    // Sub-floor notifies are gone from the transcript entirely…
    expect(container.textContent).not.toContain("notify-body-info");
    expect(container.textContent).not.toContain("notify-body-success");
    // …and the at/above-floor ones remain.
    expect(container.textContent).toContain("notify-body-warning");
    expect(container.textContent).toContain("notify-body-error");

    // The invariant: every counted/mounted row produced an element. An empty
    // wrapper is the exact signature of a render-branch-only gate.
    const wrappers = rowWrappers(container);
    expect(wrappers.length).toBeGreaterThan(0);
    for (const w of wrappers) {
      expect(w.innerHTML.trim(), `blank wrapper at ${w.getAttribute("data-index")}`).not.toBe("");
    }
  });

  it.each(LEVELS)("shows every level at the 'all' floor (%s)", (level) => {
    prefsRef.current = { ...prefsRef.current, notifyMinLevel: "all" };
    const { container } = renderChat(stateWith([notifyRow(level)]));
    expect(container.textContent).toContain(`notify-body-${level}`);
  });

  it("hides everything below error at the strictest floor, but never error", () => {
    prefsRef.current = { ...prefsRef.current, notifyMinLevel: "errors" };
    const { container } = renderChat(stateWith([...LEVELS.map(notifyRow)]));
    expect(container.textContent).not.toContain("notify-body-info");
    expect(container.textContent).not.toContain("notify-body-success");
    expect(container.textContent).not.toContain("notify-body-warning");
    expect(container.textContent).toContain("notify-body-error");
  });
});

describe("notify gate — the render branch is gated too (test-plan #F2)", () => {
  // 2.17: structural pin. A runtime test cannot isolate this site — a row the
  // filter already dropped never reaches the branch — so assert the branch
  // itself consults the shared predicate and can return null.
  it("applies the shared predicate in BOTH gate sites", () => {
    const calls = CHAT_VIEW_SRC.match(/isNotifyRowVisible/g) ?? [];
    // One import + one call per site.
    expect(calls.length).toBeGreaterThanOrEqual(3);

    // The isRowVisible site: inside the `interactiveUi` case.
    const isRowVisibleBlock = CHAT_VIEW_SRC.slice(
      CHAT_VIEW_SRC.indexOf("const isRowVisible"),
      CHAT_VIEW_SRC.indexOf("const displayRows"),
    );
    expect(isRowVisibleBlock).toContain("isNotifyRowVisible");

    // The render-branch site: the `msg.role === "interactiveUi"` branch must
    // itself consult the predicate and bail with `return null` when hidden —
    // mirroring the rawEvent precedent. Slice exactly that branch so the
    // assertion cannot be satisfied by an unrelated call elsewhere.
    const branchStart = CHAT_VIEW_SRC.indexOf('if (msg.role === "interactiveUi")');
    expect(branchStart).toBeGreaterThan(-1);
    const renderBranch = CHAT_VIEW_SRC.slice(
      branchStart,
      CHAT_VIEW_SRC.indexOf('if (msg.role === "rawEvent")', branchStart),
    );
    expect(renderBranch).toContain("isNotifyRowVisible");
    expect(renderBranch).toContain("return null");
    // …and it reads the same pref the filter does.
    expect(renderBranch).toContain("prefs.notifyMinLevel");
  });
});

describe("notify gate — blocking asks stay visible (test-plan #F3)", () => {
  // 2.18 — regression teeth for D2. If this goes green by accident the gate
  // has drifted onto the row's role and a session can deadlock silently.
  it.each(["confirm", "select", "input", "ask_user"])(
    "renders an unanswered %s row at the strictest floor",
    (method) => {
      prefsRef.current = { ...prefsRef.current, notifyMinLevel: "errors" };
      const { container } = renderChat(stateWith([askRow(method), notifyRow("info")]));
      // The ask survives…
      expect(container.textContent).toContain(`ask-title-${method}`);
      // …while the sub-floor notify beside it does not.
      expect(container.textContent).not.toContain("notify-body-info");
    },
  );

  it("keeps the ask answerable at the strictest floor", () => {
    prefsRef.current = { ...prefsRef.current, notifyMinLevel: "errors" };
    const state = stateWith([askRow("confirm")]);
    const { container, onRespondToUi } = renderChat(state);

    const buttons = Array.from(container.querySelectorAll("button")).filter(
      (b) => (b.textContent ?? "").trim().length > 0,
    );
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);
    expect(onRespondToUi).toHaveBeenCalled();
  });
});

describe("notify gate — reversibility and scope (test-plan #F4, #F5)", () => {
  // 2.19
  it("re-reveals hidden rows in their original order with no refetch", () => {
    const fetchSpy = vi.fn();
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    prefsRef.current = { ...prefsRef.current, notifyMinLevel: "errors" };
    const state = stateWith([...LEVELS.map(notifyRow)]);
    const { container, rerender } = renderChat(state);
    expect(container.textContent).not.toContain("notify-body-info");

    prefsRef.current = { ...prefsRef.current, notifyMinLevel: "all" };
    rerender(
      <ThemeProvider>
        <ChatView
          sessionId="s1"
          state={state}
          toolContext={defaultToolContext}
          onRespondToUi={vi.fn()}
        />
      </ThemeProvider>,
    );

    // All four are back…
    for (const level of LEVELS) {
      expect(container.textContent).toContain(`notify-body-${level}`);
    }
    // …in their original relative order.
    const text = container.textContent ?? "";
    const positions = LEVELS.map((l) => text.indexOf(`notify-body-${l}`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // …and nothing was refetched to get them.
    expect(fetchSpy).not.toHaveBeenCalled();
    globalThis.fetch = realFetch;
  });

  // 2.20 — the override is per-session; the gate reads effective prefs only.
  it("hides rows for the overridden session without touching the other", () => {
    const state = stateWith([...LEVELS.map(notifyRow)]);

    prefsRef.current = { ...prefsRef.current, notifyMinLevel: "errors" };
    const a = renderChat(state);
    expect(a.container.textContent).not.toContain("notify-body-info");
    cleanup();

    prefsRef.current = { ...prefsRef.current, notifyMinLevel: "all" };
    const b = renderChat(state);
    expect(b.container.textContent).toContain("notify-body-info");
    // Session state itself was never mutated by the display gate.
    expect(state.messages.length).toBe(LEVELS.length);
  });
});
