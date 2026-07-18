/**
 * Unit coverage for the unified tool-burst group frame: single-member header,
 * multi-member breakdown, error badge, absorbed reasoning via ThinkingBlock,
 * and the `toolGroupDefaultCollapsed` preference.
 * See change: enhance-tool-call-grouping.
 */

import {
  DISPLAY_PRESETS,
  type DisplayPrefs,
} from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DisplayPrefsProvider } from "../../lib/state/DisplayPrefsContext.js";
import type { ChatMessage } from "../../lib/chat/event-reducer.js";
import type { ChatItem } from "../../lib/chat/group-tool-calls.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { ToolBurstGroup } from "../chat/ToolBurstGroup.js";
import type { ToolContext } from "../tool-renderers/index.js";

const toolContext: ToolContext = {};

// jsdom implements neither scrollTo nor matchMedia; shim them for the suite.
// NOT restored in afterAll on purpose — sibling suites (e.g. EditorFileTree)
// rely on the global scrollTo shim staying in place, matching the existing
// pattern in ChatView.test.tsx. Restoring to jsdom's undefined regresses them.
beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

let seq = 0;
function tool(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `t-${seq++}`,
    role: "toolResult",
    content: "",
    toolName: "grep",
    toolCallId: `tc-${seq}`,
    toolStatus: "complete",
    timestamp: Date.now(),
    startedAt: 1000,
    duration: 500,
    args: { pattern: "foo" },
    ...overrides,
  };
}

function renderBurst(items: ChatItem[], prefs: DisplayPrefs = DISPLAY_PRESETS.standard) {
  return render(
    <ThemeProvider>
      <DisplayPrefsProvider value={{ global: prefs, getSessionOverride: () => undefined }}>
        <ToolBurstGroup burst={{ type: "burst", id: "b1", items }} toolContext={toolContext} />
      </DisplayPrefsProvider>
    </ThemeProvider>,
  );
}

afterEach(() => cleanup());

describe("ToolBurstGroup", () => {
  it("single completed member shows its own summary, not '1 tool calls'", () => {
    const { container } = renderBurst([
      tool({ toolName: "read", args: { path: "/a" } }),
    ]);
    expect(container.querySelector('[data-testid="tool-burst-summary"]')!.textContent).toContain("Read /a");
    expect(container.textContent).not.toContain("1 tool calls");
  });

  it("multi-member header shows 'N tool calls' + a per-kind icon breakdown", () => {
    const members = [
      tool({ toolName: "grep" }),
      tool({ toolName: "grep" }),
      tool({ toolName: "grep" }),
      tool({ toolName: "read", args: { path: "/a" } }),
      tool({ toolName: "read", args: { path: "/b" } }),
      tool({ toolName: "git", args: { command: "status" } }),
    ];
    const { container } = renderBurst(members);
    expect(container.querySelector('[data-testid="tool-burst-header"]')!.textContent).toContain("6 tool calls");
    const breakdown = container.querySelector('[data-testid="tool-burst-breakdown"]')!;
    // grep=3, read=2, git=1 → three chips with counts.
    expect(breakdown.querySelectorAll("svg").length).toBeGreaterThanOrEqual(3);
    expect(breakdown.textContent).toContain("3");
    expect(breakdown.textContent).toContain("2");
    expect(breakdown.textContent).toContain("1");
  });

  it("renders a 'N failed' badge when a member errored", () => {
    const { container } = renderBurst([
      tool({ toolName: "grep" }),
      tool({ toolName: "read", toolStatus: "error", args: { path: "/x" } }),
      tool({ toolName: "git", args: { command: "log" } }),
    ]);
    expect(container.querySelector('[data-testid="tool-burst-failed-badge"]')!.textContent).toContain("1 failed");
  });

  it("renders absorbed thinking as a ThinkingBlock when reasoning is on and expanded", () => {
    const think: ChatMessage = {
      id: "th-1",
      role: "thinking",
      content: "planning the search",
      timestamp: Date.now(),
    };
    // Running so the body auto-expands; reasoning pref on.
    const prefs: DisplayPrefs = { ...DISPLAY_PRESETS.standard, reasoning: true };
    const { container } = renderBurst(
      [think, tool({ toolName: "grep" }), tool({ toolName: "read", toolStatus: "running", args: { path: "/a" } })],
      prefs,
    );
    expect(container.querySelector('[data-testid="reasoning-block"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tool-burst-narration"]')).toBeNull();
  });

  it("toolGroupDefaultCollapsed keeps a running group's body closed", () => {
    const running = [tool({ toolName: "grep" }), tool({ toolName: "read", toolStatus: "running", args: { path: "/a" } })];
    // Default off → running group is expanded (body present).
    const off = renderBurst(running, { ...DISPLAY_PRESETS.standard, toolGroupDefaultCollapsed: false });
    expect(off.container.querySelector('[data-testid="tool-burst-body"]')).not.toBeNull();
    // On → running group body starts closed; the live header still renders.
    const on = renderBurst(running, { ...DISPLAY_PRESETS.standard, toolGroupDefaultCollapsed: true });
    expect(on.container.querySelector('[data-testid="tool-burst-body"]')).toBeNull();
    expect(on.container.querySelector('[data-testid="tool-burst-header"]')!.textContent).toContain("Working");
  });
});
