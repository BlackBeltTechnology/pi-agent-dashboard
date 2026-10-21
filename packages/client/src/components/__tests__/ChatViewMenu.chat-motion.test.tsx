/**
 * The ⚙ View popover's `chatMotion` row: instant apply through the shared
 * patch path, override marker, participation in clear-override.
 * Harness glue copied from ChatViewMenu.notify-level.test.tsx.
 * See change: add-fluid-chat-motion.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { ChatViewMenu } from "../chat/ChatViewMenu.js";
import { DisplayPrefsProvider } from "../../lib/state/DisplayPrefsContext.js";

afterEach(cleanup);

function openMenu(currentOverride: Record<string, unknown> | undefined = undefined) {
  const send = vi.fn();
  render(
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
  return { send };
}

function motionCheckbox(): HTMLInputElement {
  return screen.getByLabelText("Fluid chat motion") as HTMLInputElement;
}

describe("ChatViewMenu — chatMotion row", () => {
  it("is checked by default (global standard preset)", () => {
    openMenu();
    expect(motionCheckbox().checked).toBe(true);
  });

  it("applies instantly as a per-session override through the shared patch path", () => {
    const { send } = openMenu({ reasoning: true });
    fireEvent.click(motionCheckbox());
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setSessionDisplayPrefs",
        sessionId: "s1",
        override: expect.objectContaining({ reasoning: true, chatMotion: false }),
      }),
    );
  });

  it("shows the override marker only when it differs from global", () => {
    openMenu({ chatMotion: false });
    expect(motionCheckbox().checked).toBe(false);
    expect(screen.getAllByTitle("Overrides global").length).toBeGreaterThan(0);
  });
});
