/**
 * Confirm dialog for "Remove from sidebar": lists every live session of the
 * folder in a height-capped scrollable box, Cancel focused by default.
 *
 * Scenario: test-plan #F5. See change: sidebar-folder-ux.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoveFromSidebarConfirm } from "../RemoveFromSidebarConfirm.js";

afterEach(cleanup);

function sessions(n: number, name = (i: number) => `session-${i}`): DashboardSession[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    cwd: "/repo",
    source: "tui" as const,
    status: "idle" as const,
    startedAt: 0,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    name: name(i),
  }));
}

function mount(live: DashboardSession[]) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(<RemoveFromSidebarConfirm cwd="/repo" sessions={live} onConfirm={onConfirm} onClose={onClose} />);
  return { onConfirm, onClose };
}

describe("RemoveFromSidebarConfirm", () => {
  it.each([1, 12, 60])("lists every one of %i live sessions in a scrollable capped box (no row cap)", (n) => {
    const long = (i: number) => `a-very-long-session-name-${i}-${"x".repeat(120)}`;
    mount(sessions(n, long));
    const list = screen.getByTestId("remove-from-sidebar-sessions");
    expect(list.className).toMatch(/max-h-32/);
    expect(list.className).toMatch(/overflow-y-auto/);
    expect(within(list).getAllByRole("listitem")).toHaveLength(n);
    for (const li of within(list).getAllByRole("listitem")) {
      expect(li.className).toMatch(/truncate/);
    }
    expect(screen.getByTestId("remove-from-sidebar-confirm-cancel")).toBeTruthy();
    expect(screen.getByTestId("remove-from-sidebar-confirm-action")).toBeTruthy();
  });

  it("is an accessible dialog with Cancel focused; Confirm and Cancel call back", () => {
    const { onConfirm, onClose } = mount(sessions(2));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId("remove-from-sidebar-confirm-cancel"));
    fireEvent.click(screen.getByTestId("remove-from-sidebar-confirm-action"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("remove-from-sidebar-confirm-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
