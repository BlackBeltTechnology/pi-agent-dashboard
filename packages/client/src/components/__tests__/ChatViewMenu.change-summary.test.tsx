/**
 * The ⚙ View popover exposes the per-session change-summary toggle
 * (change: add-change-summary-table).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatViewMenu } from "../chat/ChatViewMenu.js";

afterEach(cleanup);

describe("ChatViewMenu — change-summary axis", () => {
  it("toggling the Per-turn change summary row emits setSessionDisplayPrefs", () => {
    const send = vi.fn();
    render(<ChatViewMenu sessionId="s1" send={send} currentOverride={undefined} />);
    fireEvent.click(screen.getByText("View"));

    const row = screen.getByText("Per-turn change summary");
    fireEvent.click(row);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setSessionDisplayPrefs",
        sessionId: "s1",
        override: expect.objectContaining({ changeSummaryTable: expect.any(Boolean) }),
      }),
    );
  });
});
