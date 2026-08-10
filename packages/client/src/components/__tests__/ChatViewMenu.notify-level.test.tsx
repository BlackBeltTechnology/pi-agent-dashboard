/**
 * The ⚙ View popover's first NON-boolean row: the 4-stop `notifyMinLevel`
 * selector. It must reuse the existing override plumbing (same patch/clear
 * callbacks) rather than a parallel path, and it must not copy the ~26px
 * sibling row height.
 *
 * Covers test-plan #F6, #F7.
 * See change: gate-notify-rows-by-level.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { ChatViewMenu } from "../chat/ChatViewMenu.js";
import { DisplayPrefsProvider } from "../../lib/state/DisplayPrefsContext.js";

afterEach(cleanup);

/**
 * Render the popover with the real prefs context, so the row reflects the
 * EFFECTIVE value (global merged with the session override) exactly as it does
 * in the app. Global defaults to the standard preset (`notifyMinLevel: "all"`).
 */
function openMenu(currentOverride: Record<string, unknown> | undefined = undefined) {
  const send = vi.fn();
  const utils = render(
    <DisplayPrefsProvider
      value={{
        global: DISPLAY_PRESETS.standard,
        getSessionOverride: () => currentOverride as never,
      }}
    >
      <ChatViewMenu sessionId="s1" send={send} currentOverride={currentOverride as never} />
    </DisplayPrefsProvider>,
  );
  fireEvent.click(screen.getByText("View"));
  return { send, ...utils };
}

function notifySelect(): HTMLSelectElement {
  const el = document.querySelector<HTMLSelectElement>('select[data-testid="notify-min-level"]');
  if (!el) throw new Error("notifyMinLevel select not found in the popover");
  return el;
}

describe("ChatViewMenu — notifyMinLevel row", () => {
  it("renders a 4-stop selector, not a checkbox", () => {
    openMenu();
    const select = notifySelect();
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "all",
      "success",
      "warnings",
      "errors",
    ]);
  });

  it("shows the current effective value", () => {
    openMenu({ notifyMinLevel: "warnings" });
    expect(notifySelect().value).toBe("warnings");
  });

  // The server deliberately round-trips arbitrary floors (validation lives in
  // the predicate, not the store), so the control must display the EFFECTIVE
  // floor rather than a value matching no <option>.
  //
  // CAVEAT, deliberately recorded: jsdom resolves a controlled <select> whose
  // value matches no option to the FIRST option, which here IS "all" — so this
  // assertion cannot fail while "all" leads NOTIFY_MIN_LEVELS, and it must not
  // be read as proof of normalization. The teeth live in the direct
  // `normalizeNotifyMinLevel` unit tests in packages/shared. What this DOES
  // pin is the honest invariant: the rendered selection is always a real
  // option. See CodeRabbit, PR #453.
  it.each([["critical"], ["oops"], [""], ["toString"], ["warning"]])(
    "renders a real option (never a blank selection) for stored floor %p",
    (stored) => {
      openMenu({ notifyMinLevel: stored });
      const select = notifySelect();
      expect(Array.from(select.options).map((o) => o.value)).toContain(select.value);
      expect(select.selectedIndex).toBeGreaterThanOrEqual(0);
      expect(select.value).toBe("all");
    },
  );

  // 2.28 / #F6 — selecting a value emits an explicit override through the
  // SAME patch path the boolean rows use.
  it("emits setSessionDisplayPrefs through the shared patch path", () => {
    const { send } = openMenu();
    fireEvent.change(notifySelect(), { target: { value: "errors" } });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setSessionDisplayPrefs",
        sessionId: "s1",
        override: expect.objectContaining({ notifyMinLevel: "errors" }),
      }),
    );
  });

  // 2.28 / #F6 — the redundant-write edge: picking the global's own value must
  // still RECORD the override, so a later global change cannot move the session.
  it("records an explicit override even when the value equals global", () => {
    // Global default is "all"; selecting "all" must still emit an override.
    const { send } = openMenu();
    fireEvent.change(notifySelect(), { target: { value: "all" } });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        override: expect.objectContaining({ notifyMinLevel: "all" }),
      }),
    );
  });

  // 2.28 / #F6 — it accumulates with, rather than replacing, other overrides.
  it("preserves sibling overrides when patched", () => {
    const { send } = openMenu({ reasoning: true });
    fireEvent.change(notifySelect(), { target: { value: "warnings" } });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        override: expect.objectContaining({ reasoning: true, notifyMinLevel: "warnings" }),
      }),
    );
  });

  // 2.28 / #F6 — clear-override still returns the session to global.
  it("participates in clear-override", () => {
    const { send } = openMenu({ notifyMinLevel: "errors" });
    fireEvent.click(screen.getByText("Use global settings"));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "setSessionDisplayPrefs", override: null }),
    );
  });

  // 2.28 / #F6 — the override marker is generic over key type.
  it("marks the row as overridden when it differs from global", () => {
    openMenu({ notifyMinLevel: "errors" });
    const row = notifySelect().closest("label, div");
    expect(row?.getAttribute("data-overridden")).toBe("true");
  });

  // 2.29 / #F7 — 44px hit area, matching ThinkingLevelSelector.
  it("lands at a 44px minimum hit area, not the ~26px sibling pattern", () => {
    openMenu();
    const row = notifySelect().closest("[data-testid='notify-min-level-row']");
    expect(row).toBeTruthy();
    expect(row?.className).toContain("min-h-[44px]");
  });

  // 2.29 / #F7 — scope discipline: the pre-existing rows are NOT restyled here.
  it("leaves the sibling boolean rows untouched", () => {
    openMenu();
    const label = screen.getByText("Reasoning blocks").closest("label");
    expect(label?.className).not.toContain("min-h-[44px]");
  });
});
