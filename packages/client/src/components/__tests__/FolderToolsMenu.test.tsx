import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderToolsMenu } from "../folder/FolderToolsMenu.js";

vi.mock("../../hooks/useInitStatus.js", () => ({
  useInitStatus: () => ({ status: { hasHook: true, needsInit: true, trusted: true }, refetch: vi.fn() }),
}));

afterEach(() => cleanup());

describe("FolderToolsMenu", () => {
  it("opens supplied secondary content and closes with Escape", () => {
    render(
      <FolderToolsMenu cwd="/repo" hasOpenSpec>
        <button type="button">OpenSpec board</button>
      </FolderToolsMenu>,
    );

    const trigger = screen.getByTestId("folder-tools-trigger");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("folder-tools-menu")).toBeNull();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("folder-tools-menu")).toBeTruthy();
    expect(screen.getByText("OpenSpec board")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("folder-tools-menu")).toBeNull();
  });

  it("omits the trigger when no secondary tool is available", () => {
    render(<FolderToolsMenu cwd="/repo" hasOpenSpec={false} />);
    expect(screen.queryByTestId("folder-tools-trigger")).toBeNull();
  });

  it("keeps Initialize inside the folder tools menu", () => {
    render(<FolderToolsMenu cwd="/repo" hasOpenSpec={false} showWorktreeInit />);

    expect(screen.queryByTestId("worktree-init-btn")).toBeNull();
    fireEvent.click(screen.getByTestId("folder-tools-trigger"));
    expect(screen.getByRole("menuitem", { name: /Initialize/ })).toBeTruthy();
  });
});
