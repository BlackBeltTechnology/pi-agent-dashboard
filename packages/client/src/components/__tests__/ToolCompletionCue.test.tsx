/**
 * Tool completion cue decision table (test-plan #E29, task 3.3). The cue is an
 * in-instance running→(done|error) flip, allowed only when the commit is
 * live-follow, non-bulk, replay-aware and motion-active (surfaced to the rows
 * as `ChatMotionContext.cueAllowed`). jsdom has no CSS: the cue is observed as
 * the keyed `tool-completion-cue` wrapper (status icon) carrying the entry
 * class; the real @starting-style transition is Playwright F10.
 *
 * Harness glue copied from `ToolBurstGroup.test.tsx`.
 * See change: add-fluid-chat-motion (D7).
 */
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { mdiAlertCircle } from "@mdi/js";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPLETION_CUE_MS, ChatMotionContext, NO_CHAT_MOTION } from "../../lib/chat/chat-motion-context.js";
import type { ChatMessage } from "../../lib/chat/event-reducer.js";
import { DisplayPrefsProvider } from "../../lib/state/DisplayPrefsContext.js";
import { ToolBurstGroup } from "../chat/ToolBurstGroup.js";
import { ToolCallStep } from "../chat/ToolCallStep.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const toolContext: ToolContext = {};
const CUE = '[data-testid="tool-completion-cue"]';

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
beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Status = "running" | "complete" | "error" | "elided";
const ctx = (cueAllowed: boolean) => ({ enteringToolIds: new Set<string>(), cueAllowed });

function step(status: Status, cueAllowed: boolean) {
  return (
    <ThemeProvider>
      <ChatMotionContext.Provider value={ctx(cueAllowed)}>
        <ToolCallStep toolName="bash" toolCallId="tc1" args={{ command: "ls" }} status={status} result="ok" context={toolContext} />
      </ChatMotionContext.Provider>
    </ThemeProvider>
  );
}

describe("ToolCallStep completion cue (E29)", () => {
  it("cues a live running→done flip, with the entry class on the status icon", () => {
    const { container, rerender } = render(step("running", true));
    expect(container.querySelector(CUE)).toBeNull();
    rerender(step("complete", true));
    const cue = container.querySelector(CUE)!;
    expect(cue).not.toBeNull();
    expect(cue.className).toContain("chat-motion-cue");
  });

  it("cues a live running→error flip and shows the alert icon", () => {
    const { container, rerender } = render(step("running", true));
    rerender(step("error", true));
    const cue = container.querySelector(CUE)!;
    expect(cue).not.toBeNull();
    expect(cue.querySelector("path")?.getAttribute("d")).toBe(mdiAlertCircle);
  });

  it.each([
    ["mount-as-done", () => render(step("complete", true))],
    ["a flip inside a replay / bulk / scroll-locked commit (cueAllowed false)", () => {
      const r = render(step("running", false));
      r.rerender(step("complete", false));
      return r;
    }],
    ["running→elided", () => {
      const r = render(step("running", true));
      r.rerender(step("elided", true));
      return r;
    }],
  ])("plays no cue for %s", (_label, run) => {
    const { container } = run();
    expect(container.querySelector(CUE)).toBeNull();
  });

  it("is inert with no ChatMotionContext (flow views, embeds mounting rows directly)", () => {
    const bare = (status: Status) => (
      <ThemeProvider>
        <ChatMotionContext.Provider value={NO_CHAT_MOTION}>
          <ToolCallStep toolName="bash" toolCallId="tc1" status={status} context={toolContext} />
        </ChatMotionContext.Provider>
      </ThemeProvider>
    );
    const { container, rerender } = render(bare("running"));
    rerender(bare("complete"));
    expect(container.querySelector(CUE)).toBeNull();
  });

  it("a later manual expand never cues: the cue window closes", () => {
    const { container, rerender } = render(step("running", true));
    rerender(step("complete", true));
    expect(container.querySelector(CUE)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(COMPLETION_CUE_MS + 50);
    });
    expect(container.querySelector(CUE)).toBeNull();
    fireEvent.click(container.querySelector("button")!); // manual expand
    expect(container.querySelector(".chat-motion-enter")).toBeNull();
  });

  it("a result body shown by the live flip fades in", () => {
    const withBody = (status: Status) => (
      <ThemeProvider>
        <ChatMotionContext.Provider value={ctx(true)}>
          <ToolCallStep toolName="ask_user" toolCallId="tc2" args={{}} status={status} result="answer" context={toolContext} />
        </ChatMotionContext.Provider>
      </ThemeProvider>
    );
    const { container, rerender } = render(withBody("running"));
    rerender(withBody("complete"));
    expect(container.querySelector(".chat-motion-enter")).not.toBeNull();
  });
});

describe("ToolBurstGroup completion cue (E29)", () => {
  function member(status: Status): ChatMessage {
    return { id: "t1", role: "toolResult", content: "", toolName: "grep", toolCallId: "tc1", toolStatus: status, timestamp: 1, startedAt: 1, args: { pattern: "foo" } };
  }
  function burst(status: Status, cueAllowed: boolean) {
    return (
      <ThemeProvider>
        <DisplayPrefsProvider value={{ global: DISPLAY_PRESETS.standard, getSessionOverride: () => undefined }}>
          <ChatMotionContext.Provider value={ctx(cueAllowed)}>
            <ToolBurstGroup burst={{ type: "burst", id: "b1", items: [member(status)] }} toolContext={toolContext} />
          </ChatMotionContext.Provider>
        </DisplayPrefsProvider>
      </ThemeProvider>
    );
  }

  it("replaces tool-group-flash with the cue on a live flip", () => {
    const { container, rerender } = render(burst("running", true));
    rerender(burst("complete", true));
    expect(container.querySelector(CUE)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(container.querySelector(".tool-group-flash")).toBeNull();
  });

  it("keeps today's flash (and no cue) when the commit is not live-follow", () => {
    const { container, rerender } = render(burst("running", false));
    rerender(burst("complete", false));
    expect(container.querySelector(CUE)).toBeNull();
    expect(container.querySelector(".tool-group-flash")).not.toBeNull();
  });

  it("plays no cue for a group that mounts already done", () => {
    const { container } = render(burst("complete", true));
    expect(container.querySelector(CUE)).toBeNull();
  });
});
