/**
 * pi-flows tools are ordinary tools, not debug tools: with the debug toggle
 * off `flow_agents` / `flow_results` render and `resources_discover` hides;
 * toggle on → all three render. (The dead `flow:*` debug names were removed.)
 * See change: update-flows-plugin (D8; test-plan E47).
 */
import type { DisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createInitialState, reduceEvent } from "../../lib/chat/event-reducer.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

const prefsRef: { current: DisplayPrefs } = { current: { ...DISPLAY_PRESETS.everything } };
vi.mock("../../hooks/useDisplayPrefs.js", () => ({ useDisplayPrefs: () => prefsRef.current }));

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
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
afterEach(() => {
  cleanup();
  prefsRef.current = { ...DISPLAY_PRESETS.everything };
});

let ts = 0;
const ev = (eventType: string, data: Record<string, unknown>): DashboardEvent =>
  ({ eventType, timestamp: ++ts, data: { type: eventType, ...data } }) as unknown as DashboardEvent;

function stateWithTools(names: string[]) {
  let s = createInitialState();
  s = reduceEvent(s, ev("message_start", { message: { role: "user", content: [{ type: "text", text: "go" }] } }));
  names.forEach((toolName, i) => {
    const toolCallId = `t${i}`;
    s = reduceEvent(s, ev("tool_execution_start", { toolCallId, toolName, args: {} }));
    s = reduceEvent(s, ev("tool_execution_end", { toolCallId, toolName, result: `RESULT-${toolName}`, isError: false }));
  });
  return s;
}

function renderChat(debugTools: boolean) {
  prefsRef.current = { ...prefsRef.current, debugTools };
  const state = stateWithTools(["flow_agents", "flow_results", "resources_discover"]);
  const view = render(
    <ThemeProvider>
      <ChatView sessionId="s1" state={state} toolContext={{}} onRespondToUi={vi.fn()} />
    </ThemeProvider>,
  );
  return view.container.innerHTML;
}

describe("debug tool visibility (E47)", () => {
  it("toggle off: pi-flows tools render, resources_discover hides", () => {
    const html = renderChat(false);
    expect(html).toContain("flow_agents");
    expect(html).toContain("flow_results");
    expect(html).not.toContain("resources_discover");
  });

  it("toggle on: all three render", () => {
    const html = renderChat(true);
    for (const n of ["flow_agents", "flow_results", "resources_discover"]) expect(html, n).toContain(n);
  });
});
