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
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../lib/chat/event-reducer.js";
import type { ChatItem } from "../../lib/chat/group-tool-calls.js";
import { DisplayPrefsProvider } from "../../lib/state/DisplayPrefsContext.js";
import { MobileProvider } from "../../hooks/useMobile.js";
import { ToolBurstGroup } from "../chat/ToolBurstGroup.js";
import { ToolCallStep } from "../chat/ToolCallStep.js";
import { FORCE_STOP_ARM_MS } from "../chat/ToolStopControl.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
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

  // #F4 (repair-tool-error-surfaces) — this badge is one of the five single-line
  // error surfaces: the whole element takes the severity accent, no chrome/content
  // split, and no raw red literal may return.
  it("#F4 the failed badge sources its colour from the severity tokens", () => {
    const { container } = renderBurst([
      tool({ toolName: "read", toolStatus: "error", args: { path: "/x" } }),
      tool({ toolName: "grep" }),
    ]);
    const badge = container.querySelector('[data-testid="tool-burst-failed-badge"]') as HTMLElement;
    expect(badge.className).toContain("bg-[var(--severity-error-bg)]");
    expect(badge.className).toContain("text-[var(--severity-error-fg)]");
    expect(badge.className).toContain("border-[var(--severity-error-border)]");
    expect(badge.className).not.toMatch(/\bred-\d{2,3}\b/);
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

/**
 * An `elided` member must not let the burst read as a success — the second half
 * of the CodeRabbit-found gap in D5's renderer audit.
 *
 * Excluding elided from `doneCount` was necessary but not sufficient: with no
 * member running, the header glyph still took the green completion accent, so a
 * burst holding an unloadable result looked fully succeeded before the user
 * expanded it.
 * See change: fix-lazy-history-backfill-ux (D5).
 */
describe("ToolBurstGroup — an elided member (fix-lazy-history-backfill-ux)", () => {
  it("does not count an elided member as done", () => {
    const { container } = renderBurst([
      tool({ toolStatus: "complete" }),
      tool({ toolStatus: "elided" }),
      tool({ toolStatus: "running" }),
    ]);
    // Running burst → header reports "<doneCount> done"; the elided member is
    // terminal but its result never arrived, so only the completed one counts.
    expect(container.querySelector('[data-testid="tool-burst-header"]')!.textContent).toContain("1 done");
  });

  it("takes a neutral glyph instead of the green completion accent", () => {
    const { container } = renderBurst([
      tool({ toolStatus: "complete" }),
      tool({ toolStatus: "elided" }),
    ]);
    expect(container.querySelector('[data-testid="tool-burst-elided-glyph"]')).not.toBeNull();
    expect(container.querySelector(".text-green-400")).toBeNull();
  });

  it("CONTROL: an all-complete burst keeps the green completion accent", () => {
    const { container } = renderBurst([
      tool({ toolStatus: "complete" }),
      tool({ toolStatus: "complete" }),
    ]);
    expect(container.querySelector('[data-testid="tool-burst-elided-glyph"]')).toBeNull();
    expect(container.querySelector(".text-green-400")).not.toBeNull();
  });
});

/**
 * Mobile viewports: a running group does not auto-expand (caps DOM growth in
 * the non-virtualized streaming tail); tap still expands; desktop unchanged.
 * Test-plan #E20–#E22. See change: harden-ios-safari-memory-and-ws-diagnostics.
 */
describe("ToolBurstGroup — collapsed on mobile (mobile-resilience)", () => {
  function withViewport(mobile: boolean, run: () => void) {
    const prev = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: mobile,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    try {
      run();
    } finally {
      window.matchMedia = prev;
    }
  }

  function renderViewportBurst(items: ChatItem[]) {
    const prefs = { ...DISPLAY_PRESETS.standard, toolGroupDefaultCollapsed: false };
    const ui = (list: ChatItem[]) => (
      <MobileProvider>
        <ThemeProvider>
          <DisplayPrefsProvider value={{ global: prefs, getSessionOverride: () => undefined }}>
            <ToolBurstGroup burst={{ type: "burst", id: "b1", items: list }} toolContext={toolContext} />
          </DisplayPrefsProvider>
        </ThemeProvider>
      </MobileProvider>
    );
    const r = render(ui(items));
    return { ...r, rerenderItems: (list: ChatItem[]) => r.rerender(ui(list)) };
  }

  const body = (c: HTMLElement) => c.querySelector('[data-testid="tool-burst-body"]');
  const header = (c: HTMLElement) => c.querySelector('[data-testid="tool-burst-header"]') as HTMLElement;

  it("#E20 a running group stays collapsed on mobile, live header visible", () => {
    withViewport(true, () => {
      const running = [tool({ toolName: "grep" }), tool({ toolName: "read", toolStatus: "running", args: { path: "/a" } })];
      const { container } = renderViewportBurst(running);
      expect(body(container)).toBeNull();
      expect(header(container).textContent).toContain("Working");
      expect(header(container).textContent).toContain("1 done"); // live tool count
    });
  });

  it("#E21 tap expands on mobile and the body stays mounted after running→done", () => {
    withViewport(true, () => {
      const done = tool({ toolName: "grep" });
      const runningMember = tool({ toolName: "read", toolStatus: "running", args: { path: "/a" } });
      const { container, rerenderItems } = renderViewportBurst([done, runningMember]);
      expect(body(container)).toBeNull();
      fireEvent.click(header(container));
      expect(body(container)).not.toBeNull();
      rerenderItems([done, { ...runningMember, toolStatus: "complete" }]);
      expect(body(container)).not.toBeNull();
    });
  });

  it("#E22 desktop: a running group still auto-expands", () => {
    withViewport(false, () => {
      const running = [tool({ toolName: "grep" }), tool({ toolName: "read", toolStatus: "running", args: { path: "/a" } })];
      const { container } = renderViewportBurst(running);
      expect(body(container)).not.toBeNull();
    });
  });
});

/**
 * Shared burst stop control (header + running rows).
 * Test-plan #E1–#E7, #F1–#F11, #F17, #X1, #X2, #X4. See change: fix-chat-burst-tool-stop.
 */
describe("ToolBurstGroup — shared stop control", () => {
  const ARM = FORCE_STOP_ARM_MS;
  const q = (c: ParentNode, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;
  const qa = (c: ParentNode, id: string) => c.querySelectorAll(`[data-testid="${id}"]`);
  const runningBash = (o: Partial<ChatMessage> = {}) =>
    tool({ toolName: "bash", toolStatus: "running", args: { command: "sleep 60" }, ...o });

  function ui(
    items: ChatItem[],
    handlers: { onAbort?: () => void; onForceKill?: () => void },
    prefs: DisplayPrefs = { ...DISPLAY_PRESETS.standard, toolGroupDefaultCollapsed: false },
  ) {
    return (
      <MobileProvider>
        <ThemeProvider>
          <DisplayPrefsProvider value={{ global: prefs, getSessionOverride: () => undefined }}>
            <ToolBurstGroup burst={{ type: "burst", id: "b1", items }} toolContext={toolContext} {...handlers} />
          </DisplayPrefsProvider>
        </ThemeProvider>
      </MobileProvider>
    );
  }
  function setup(
    items: ChatItem[],
    handlers: { onAbort?: () => void; onForceKill?: () => void } = { onAbort: vi.fn(), onForceKill: vi.fn() },
    prefs?: DisplayPrefs,
  ) {
    const r = render(ui(items, handlers, prefs));
    return { ...r, handlers, rerenderItems: (list: ChatItem[]) => r.rerender(ui(list, handlers, prefs)) };
  }
  const collapsed = { ...DISPLAY_PRESETS.standard, toolGroupDefaultCollapsed: true };
  const body = (c: HTMLElement) => q(c, "tool-burst-body");

  function withMobile(mobile: boolean, run: () => void) {
    const prev = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: mobile,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    try {
      run();
    } finally {
      window.matchMedia = prev;
    }
  }

  afterEach(() => vi.useRealTimers());

  it("#E1 handler gating: none → 0, onAbort → 1, both → 1", () => {
    const cases: [Record<string, () => void>, number][] = [
      [{}, 0],
      [{ onAbort: vi.fn() }, 1],
      [{ onAbort: vi.fn(), onForceKill: vi.fn() }, 1],
    ];
    for (const [h, n] of cases) {
      const { container, unmount } = setup([runningBash()], h);
      expect(qa(container, "tool-burst-stop-button").length).toBe(n);
      unmount();
    }
  });

  it("#E2 onAbort only: click aborts, Stop stays, no Force Stop", () => {
    const onAbort = vi.fn();
    const { container } = setup([runningBash()], { onAbort });
    fireEvent.click(q(container, "tool-burst-stop-button")!);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(q(container, "tool-burst-stop-button")).not.toBeNull();
    expect(q(container, "tool-burst-force-stop-button")).toBeNull();
  });

  it("#E3 hidden kind: no stop control and no header", () => {
    const prefs = { ...DISPLAY_PRESETS.standard, toolCalls: { ...DISPLAY_PRESETS.standard.toolCalls, bash: false } };
    const { container } = setup([runningBash()], undefined, prefs);
    expect(container.querySelector('[data-testid^="tool-burst-stop"]')).toBeNull();
    expect(q(container, "tool-burst-header")).toBeNull();
  });

  it("#E4 row gating: only the running row carries a stop button", () => {
    const { container } = setup([tool({ toolName: "read" }), tool({ toolName: "read" }), runningBash()]);
    const b = body(container)!;
    const stops = qa(b, "tool-stop-button");
    expect(stops.length).toBe(1);
    expect(stops[0].closest(".border-l-2")?.textContent).toContain("sleep 60");
  });

  it("#E5 collapsed pref: header stop present, body absent", () => {
    const { container } = setup([runningBash()], undefined, collapsed);
    expect(q(container, "tool-burst-stop-button")).not.toBeNull();
    expect(body(container)).toBeNull();
  });

  it("#E6 double-click sends one abort, never a force kill", () => {
    vi.useFakeTimers();
    const { container, handlers } = setup([runningBash()], undefined, collapsed);
    const btn = q(container, "tool-burst-stop-button")!;
    fireEvent.click(btn);
    vi.advanceTimersByTime(50);
    fireEvent.click(btn);
    expect(handlers.onAbort).toHaveBeenCalledTimes(1);
    expect(handlers.onForceKill).toHaveBeenCalledTimes(0);
    expect(q(container, "tool-burst-arming-button")!.disabled).toBe(true);
  });

  it("#E7 double Force Stop sends exactly one force kill", () => {
    vi.useFakeTimers();
    const { container, handlers } = setup([runningBash()], undefined, collapsed);
    fireEvent.click(q(container, "tool-burst-stop-button")!);
    act(() => vi.advanceTimersByTime(ARM));
    const fs = q(container, "tool-burst-force-stop-button")!;
    fireEvent.click(fs);
    fireEvent.click(fs);
    expect(handlers.onForceKill).toHaveBeenCalledTimes(1);
    expect(q(container, "tool-burst-killing-button")!.disabled).toBe(true);
  });

  it("#F1 header Stop arms for 600 ms without toggling the body", () => {
    vi.useFakeTimers();
    const { container, handlers } = setup([runningBash()], undefined, collapsed);
    fireEvent.click(q(container, "tool-burst-stop-button")!);
    expect(handlers.onAbort).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(ARM - 1));
    expect(q(container, "tool-burst-arming-button")!.disabled).toBe(true);
    expect(body(container)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(q(container, "tool-burst-force-stop-button")!.disabled).toBe(false);
    expect(body(container)).toBeNull();
  });

  it("#F2 Force Stop kills without toggling the body", () => {
    vi.useFakeTimers();
    const { container, handlers } = setup([runningBash()], undefined, collapsed);
    fireEvent.click(q(container, "tool-burst-stop-button")!);
    act(() => vi.advanceTimersByTime(ARM));
    fireEvent.click(q(container, "tool-burst-force-stop-button")!);
    expect(handlers.onForceKill).toHaveBeenCalledTimes(1);
    expect(q(container, "tool-burst-killing-button")!.disabled).toBe(true);
    expect(body(container)).toBeNull();
  });

  it("#F3 row Stop drives the header state too", () => {
    vi.useFakeTimers();
    const { container, handlers } = setup([tool({ toolName: "read" }), tool({ toolName: "read" }), runningBash()]);
    fireEvent.click(q(body(container)!, "tool-stop-button")!);
    expect(handlers.onAbort).toHaveBeenCalledTimes(1);
    expect(q(container, "tool-burst-arming-button")).not.toBeNull();
    expect(q(container, "tool-arming-button")).not.toBeNull();
    act(() => vi.advanceTimersByTime(ARM));
    expect(q(container, "tool-burst-force-stop-button")).not.toBeNull();
    expect(q(container, "tool-force-stop-button")).not.toBeNull();
  });

  it("#F4 header Stop drives the running row", () => {
    vi.useFakeTimers();
    const { container } = setup([runningBash()]);
    fireEvent.click(q(container, "tool-burst-stop-button")!);
    act(() => vi.advanceTimersByTime(ARM));
    expect(q(container, "tool-force-stop-button")).not.toBeNull();
    expect(q(container, "tool-stop-button")).toBeNull();
  });

  it("#F5 killing survives collapse / re-expand", () => {
    vi.useFakeTimers();
    const { container } = setup([runningBash()]);
    fireEvent.click(q(container, "tool-burst-stop-button")!);
    act(() => vi.advanceTimersByTime(ARM));
    fireEvent.click(q(container, "tool-burst-force-stop-button")!);
    fireEvent.click(q(container, "tool-burst-header")!);
    expect(body(container)).toBeNull();
    fireEvent.click(q(container, "tool-burst-header")!);
    expect(q(body(container)!, "tool-killing-button")).not.toBeNull();
    expect(q(container, "tool-stop-button")).toBeNull();
  });

  for (const [label, advanceToAborting] of [["arming", false], ["aborting", true]] as const) {
    for (const end of ["complete", "error"] as const) {
      it(`#F6 ${label} resets on ${end}`, () => {
        vi.useFakeTimers();
        const m = runningBash();
        const { container, rerenderItems } = setup([m]);
        fireEvent.click(q(container, "tool-burst-stop-button")!);
        if (advanceToAborting) act(() => vi.advanceTimersByTime(ARM));
        rerenderItems([{ ...m, toolStatus: end }]);
        act(() => vi.advanceTimersByTime(1000));
        expect(container.querySelector('[data-testid*="stop-button"]')).toBeNull();
        expect(container.querySelector('[data-testid*="arming-button"]')).toBeNull();
        expect(container.querySelector('[data-testid*="killing-button"]')).toBeNull();
      });
    }
  }

  it("#F7 re-arms after a completed kill when a new member runs", () => {
    vi.useFakeTimers();
    const m = runningBash();
    const { container, rerenderItems } = setup([m]);
    fireEvent.click(q(container, "tool-burst-stop-button")!);
    act(() => vi.advanceTimersByTime(ARM));
    fireEvent.click(q(container, "tool-burst-force-stop-button")!);
    const done = { ...m, toolStatus: "complete" as const };
    rerenderItems([done]);
    rerenderItems([done, runningBash()]);
    expect(q(container, "tool-burst-stop-button")).not.toBeNull();
  });

  it("resets when one call completes and another starts in the same render", () => {
    vi.useFakeTimers();
    const a = runningBash();
    const { container, rerenderItems } = setup([a]);
    fireEvent.click(q(container, "tool-burst-stop-button")!);
    act(() => vi.advanceTimersByTime(ARM));
    fireEvent.click(q(container, "tool-burst-force-stop-button")!);
    rerenderItems([{ ...a, toolStatus: "complete" }, runningBash()]);
    expect(q(container, "tool-burst-stop-button")).not.toBeNull();
    expect(q(container, "tool-burst-killing-button")).toBeNull();
  });

  it("#F8 stop controls sit outside toggles and are labelled buttons", () => {
    const { container } = render(
      <>
        {ui([runningBash()], { onAbort: vi.fn(), onForceKill: vi.fn() })}
        <ThemeProvider>
          <ToolCallStep toolName="bash" toolCallId="solo" status="running" context={toolContext} onAbort={vi.fn()} onForceKill={vi.fn()} />
        </ThemeProvider>
      </>,
    );
    const isStop = (el: Element) => /(stop|arming|killing)-button$/.test(el.getAttribute("data-testid") ?? "");
    const toggles = Array.from(container.querySelectorAll("button")).filter((b) => !isStop(b));
    expect(toggles.length).toBeGreaterThanOrEqual(3); // burst header + burst row + standalone row
    for (const t of toggles) expect(t.querySelectorAll("button, [role=button]").length).toBe(0);
    const stops = container.querySelectorAll('[data-testid$="stop-button"]');
    expect(stops.length).toBeGreaterThanOrEqual(3);
    for (const s of Array.from(stops)) {
      expect(s.tagName).toBe("BUTTON");
      expect(s.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("#F9 keyboard activation keeps focus and does not toggle", () => {
    const { container, handlers } = setup([runningBash()], undefined, collapsed);
    const btn = q(container, "tool-burst-stop-button")!;
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.click(btn); // native <button> Enter activation dispatches click
    expect(document.activeElement).toBe(btn);
    expect(handlers.onAbort).toHaveBeenCalledTimes(1);
    expect(body(container)).toBeNull();
  });

  it("#F10 target size: 44px mobile, 24px desktop", () => {
    withMobile(true, () => {
      const prefs = { ...DISPLAY_PRESETS.standard, toolGroupDefaultCollapsed: false };
      const { container, unmount } = setup([runningBash()], undefined, prefs);
      fireEvent.click(q(container, "tool-burst-header")!); // mobile never auto-expands
      for (const id of ["tool-burst-stop-button", "tool-stop-button"]) {
        const cls = q(container, id)!.className;
        expect(cls).toContain("min-w-[44px]");
        expect(cls).toContain("min-h-[44px]");
      }
      unmount();
    });
    withMobile(false, () => {
      const { container } = setup([runningBash()]);
      for (const id of ["tool-burst-stop-button", "tool-stop-button"]) {
        const cls = q(container, id)!.className;
        expect(cls).toContain("min-w-6");
        expect(cls).toContain("min-h-6");
        expect(cls).not.toContain("44px");
      }
    });
  });

  it("#F11 exactly one tool-burst-header, a BUTTON that toggles the body", () => {
    const { container } = setup([runningBash()]);
    const headers = qa(container, "tool-burst-header");
    expect(headers.length).toBe(1);
    expect(headers[0].tagName).toBe("BUTTON");
    expect(body(container)).not.toBeNull();
    fireEvent.click(headers[0]);
    expect(body(container)).toBeNull();
  });

  it("#F17 label per viewport", () => {
    withMobile(false, () => {
      const { container, unmount } = setup([runningBash()]);
      expect(q(container, "tool-burst-stop-button")!.textContent).toContain("Stop");
      expect(q(container, "tool-stop-button")!.textContent).toBe("");
      expect(q(container, "tool-stop-button")!.getAttribute("aria-label")).toBeTruthy();
      unmount();
    });
    withMobile(true, () => {
      const { container } = setup([runningBash()]);
      const b = q(container, "tool-burst-stop-button")!;
      expect(b.textContent).toBe("");
      expect(b.getAttribute("aria-label")).toBeTruthy();
    });
  });

  it("#X1 ignored kill: Killing persists, Stop never reappears", () => {
    vi.useFakeTimers();
    const m = runningBash();
    const { container, handlers, rerenderItems } = setup([m], { onAbort: vi.fn(), onForceKill: vi.fn() });
    fireEvent.click(q(container, "tool-burst-stop-button")!);
    act(() => vi.advanceTimersByTime(ARM));
    fireEvent.click(q(container, "tool-burst-force-stop-button")!);
    for (let i = 0; i < 3; i++) rerenderItems([{ ...m }]);
    expect(q(container, "tool-burst-killing-button")!.disabled).toBe(true);
    expect(q(container, "tool-burst-stop-button")).toBeNull();
    expect(handlers.onForceKill).toHaveBeenCalledTimes(1);
  });

  it("#X2 killing aria-label falls back to English, not the raw key", () => {
    vi.useFakeTimers();
    const { container } = setup([runningBash()], undefined, collapsed);
    fireEvent.click(q(container, "tool-burst-stop-button")!);
    act(() => vi.advanceTimersByTime(ARM));
    fireEvent.click(q(container, "tool-burst-force-stop-button")!);
    expect(q(container, "tool-burst-killing-button")!.getAttribute("aria-label")).toBe("Killing process...");
  });

  it("#X4 unmount mid-arm leaks no timer", () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, handlers, unmount } = setup([runningBash()], undefined, collapsed);
    fireEvent.click(q(container, "tool-burst-stop-button")!);
    unmount();
    vi.advanceTimersByTime(1000);
    expect(handlers.onForceKill).toHaveBeenCalledTimes(0);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
