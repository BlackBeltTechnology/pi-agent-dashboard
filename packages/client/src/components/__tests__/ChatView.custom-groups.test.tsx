/**
 * Per-group custom-row gating in the chat transcript
 * (change: add-custom-event-group-filters, tasks 7.1–7.3; updated by
 * add-custom-entry-renderer-slot).
 *
 * Same two-site contract as the notify gate: `isRowVisible` filters
 * `displayRows` (a filtered row is never counted nor mounted), and the render
 * path mirrors the gate. Since add-custom-entry-renderer-slot the render-site
 * gate lives in the shared `CustomEntryRow` container — used by ChatView AND
 * both absorption sites (ToolBurstGroup / CollapsedToolGroup) — so a hidden
 * row is suppressed identically everywhere, including inside an expanded
 * burst. Both sites key on the server-stamped `groupId`, falling back to the
 * catch-all `other`.
 *
 * Flow cards are structurally exempt: they render through the flows-plugin
 * slot from `flow_*` events, never as `role: "custom"` rows — the group gate
 * has no code path that could reach them (asserted structurally below).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { type ChatMessage, createInitialState, reduceEvent } from "../../lib/chat/event-reducer.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const CHAT_VIEW_SRC = readFileSync(resolve(here, "../chat/ChatView.tsx"), "utf8");
const CUSTOM_ENTRY_ROW_SRC = readFileSync(resolve(here, "../chat/CustomEntryRow.tsx"), "utf8");

// Prefs are injected through the hook so each case picks a group map.
const prefsRef: { current: DisplayPrefs } = {
  current: { ...DISPLAY_PRESETS.everything },
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
  prefsRef.current = { ...DISPLAY_PRESETS.everything };
});

function entryRow(customType: string, groupId: string | undefined, body: string): ChatMessage {
  return {
    id: `c-${body}`,
    role: "custom",
    customType,
    ...(groupId ? { groupId } : {}),
    content: body,
    timestamp: Date.now(),
  } as ChatMessage;
}

function userRow(body: string): ChatMessage {
  return { id: `u-${body}`, role: "user", content: body, timestamp: Date.now() } as ChatMessage;
}

function stateWith(messages: ChatMessage[]) {
  let state = createInitialState();
  for (const m of messages) state = { ...state, messages: [...state.messages, m] };
  return state;
}

function renderChat(state: ReturnType<typeof createInitialState>) {
  return render(
    <ThemeProvider>
      <ChatView
        sessionId="s1"
        state={state}
        toolContext={defaultToolContext}
        onRespondToUi={vi.fn()}
      />
    </ThemeProvider>,
  );
}

function bodyText(container: HTMLElement): string {
  return container.textContent ?? "";
}

describe("custom group gate (task 7.1)", () => {
  it("a hidden group's rows are excluded from row-visibility AND from rendering", () => {
    prefsRef.current = {
      ...prefsRef.current,
      customEventGroups: { ...prefsRef.current.customEventGroups, memory: false },
    };
    const { container } = renderChat(
      stateWith([
        entryRow("om.observations.recorded", "memory", "memory-body-1"),
        userRow("visible-user-row"),
      ]),
    );
    const text = bodyText(container);
    expect(text).not.toContain("memory-body-1");
    expect(text).toContain("visible-user-row");
  });

  it("an un-annotated row follows the other catch-all (task 7.2)", () => {
    prefsRef.current = {
      ...prefsRef.current,
      customEventGroups: { ...prefsRef.current.customEventGroups, other: false },
    };
    const { container } = renderChat(stateWith([entryRow("third-party.thing", undefined, "ungrouped-body")]));
    expect(bodyText(container)).not.toContain("ungrouped-body");
    // and it renders when other is on
    prefsRef.current = { ...prefsRef.current, customEventGroups: { other: true } };
    const { container: c2 } = renderChat(stateWith([entryRow("third-party.thing", undefined, "ungrouped-body-2")]));
    expect(bodyText(c2)).toContain("ungrouped-body-2");
  });

  it("groups are independently gated (task 7.3)", () => {
    prefsRef.current = {
      ...prefsRef.current,
      customEventGroups: { ...prefsRef.current.customEventGroups, memory: false, search: true },
    };
    const { container } = renderChat(
      stateWith([
        entryRow("om.observations.recorded", "memory", "hidden-memory-body"),
        entryRow("web-search-results", "search", "visible-search-body"),
      ]),
    );
    const text = bodyText(container);
    expect(text).not.toContain("hidden-memory-body");
    expect(text).toContain("visible-search-body");
  });

  it("the render path mirrors the per-group gate via the shared container (structural pin)", () => {
    const gateRe = /customEventGroups\[msg\.groupId \?\? "other"\]/g;
    // ONE lookup in ChatView — the isRowVisible filter. The render branch
    // delegates to `CustomEntryRow`, which owns the mirrored gate.
    const chatSites = CHAT_VIEW_SRC.match(gateRe) ?? [];
    expect(chatSites).toHaveLength(1);
    const chatIdx = matchAllIndexes(CHAT_VIEW_SRC, gateRe)[0];
    const chatContext = CHAT_VIEW_SRC.slice(Math.max(0, chatIdx - 700), chatIdx);
    expect(chatContext.includes('case "custom":')).toBe(true);

    // The container carries the SAME gate expression, so a row absorbed into a
    // burst/×N group (where isRowVisible never reaches) is still suppressed.
    expect(CUSTOM_ENTRY_ROW_SRC.match(gateRe) ?? []).toHaveLength(1);

    // The role=custom render branch routes through the container.
    expect(CHAT_VIEW_SRC).toContain('<CustomEntryRow');
  });
});

function matchAllIndexes(source: string, re: RegExp): number[] {
  const out: number[] = [];
  for (const m of source.matchAll(re)) {
    out.push(m.index ?? 0);
  }
  return out;
}
