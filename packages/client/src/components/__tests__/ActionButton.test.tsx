import { describe, it, expect, vi } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import { ActionButton } from "../ActionButton.js";

describe("ActionButton", () => {
  it("renders pending label and disables while the action runs", async () => {
    let resolveFn: (() => void) | undefined;
    const action = vi.fn(() => new Promise<void>((res) => { resolveFn = res; }));

    const { getByRole } = render(
      <ActionButton action={action} pendingLabel="Working…">
        Go
      </ActionButton>,
    );
    const btn = getByRole("button") as HTMLButtonElement;
    expect(btn.textContent).toContain("Go");
    expect(btn.disabled).toBe(false);

    act(() => { fireEvent.click(btn); });
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("Working…");

    await act(async () => { resolveFn?.(); });
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain("Go");
  });
});
