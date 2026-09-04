/**
 * The ⚙ View popover's per-group custom event toggles
 * (change: add-custom-event-group-filters, task 7.5).
 *
 * One toggle per configured group (labels from the definitions fetch), the
 * existing per-session "overridden" indicator, and a patch of one group id
 * that touches ONLY that group in the override.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { ChatViewMenu } from "../chat/ChatViewMenu.js";
import { DisplayPrefsProvider } from "../../lib/state/DisplayPrefsContext.js";

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url === "/api/custom-event-groups") {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            groups: [
              { id: "memory", label: "Memory telemetry", default: false },
              { id: "search", label: "Web search results", default: true },
              { id: "other", label: "Catch-all other", default: true },
            ],
          }),
      });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  }) as never;
});

afterEach(cleanup);

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

describe("ChatViewMenu — custom event group rows (task 7.5)", () => {
  it("renders one toggle per configured group, in configured order, legacy row absent", async () => {
    openMenu();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Memory telemetry" })).toBeTruthy());
    const memory = screen.getByRole("checkbox", { name: "Memory telemetry" });
    const search = screen.getByRole("checkbox", { name: "Web search results" });
    const other = screen.getByRole("checkbox", { name: "Catch-all other" });
    // configured order memory → search → other (DOM order)
    expect(
      memory.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      search.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // the single combined toggle is gone (task 7.6 half)
    expect(screen.queryByRole("checkbox", { name: "Custom entries in chat" })).toBeNull();
  });

  it("toggling one group creates a session override affecting only that group", async () => {
    const { send } = openMenu();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Memory telemetry" })).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: "Memory telemetry" }));
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][0] as {
      type: string;
      sessionId: string;
      override: { customEventGroups?: Record<string, boolean> };
    };
    expect(msg.type).toBe("setSessionDisplayPrefs");
    expect(msg.sessionId).toBe("s1");
    expect(msg.override.customEventGroups).toEqual({ memory: true });
  });

  it("shows the per-session overridden indicator for a group coming from the override", async () => {
    openMenu({ customEventGroups: { memory: true } });
    await waitFor(() => expect(screen.getByTestId("chat-view-modified-pill")).toBeTruthy());
    // The Row marks the overridden group (aria/visual dot via `marked`).
    const memoryRow = screen.getByRole("checkbox", { name: "Memory telemetry" });
    const row = memoryRow.closest("label");
    expect(row?.querySelector('span[title="Overrides global"]')).toBeTruthy();
  });
});
