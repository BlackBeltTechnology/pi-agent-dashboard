/**
 * Component-level contract for `FolderActionsMenu` — the single trailing
 * control on a sidebar folder header.
 *
 * Menu-harness glue (outside-click listener, `act()`-free fireEvent driving)
 * mirrors `MobileActionMenu.test.tsx`.
 *
 * Scenarios: test-plan X1 (Escape closes + restores focus), X2 (outside click
 * closes, no item fires), X4 (ARIA contract).
 * See change: add-folder-actions-menu.
 */

import { mdiPin, mdiSortVariant } from "@mdi/js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderActionsMenu, type FolderMenuItem } from "../folder/FolderActionsMenu.js";

afterEach(() => cleanup());

const CWD = "/a/b";

/** Uncontrolled-looking harness: holds the scope-keyed open flag like SessionList does. */
function Harness({ items }: { items: FolderMenuItem[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button type="button" data-testid="outside">outside</button>
      <FolderActionsMenu
        cwd={CWD}
        items={items}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

function makeItems(onSelect = vi.fn()): FolderMenuItem[] {
  return [
    { id: "pin", group: "directory", label: "Pin directory", icon: mdiPin, onSelect },
    { id: "urgency-sort", group: "directory", label: "Float blocked sessions to top", icon: mdiSortVariant, onSelect },
  ];
}

describe("FolderActionsMenu ARIA contract (X4)", () => {
  it("trigger exposes aria-haspopup=menu and aria-expanded that flips on open", () => {
    render(<Harness items={makeItems()} />);
    const trigger = screen.getByTestId(`folder-actions-menu-${CWD}`);
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(screen.getByTestId(`folder-actions-menu-${CWD}`).getAttribute("aria-expanded")).toBe("true");
  });

  it("items expose role=menuitem and the panel exposes role=menu", () => {
    render(<Harness items={makeItems()} />);
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    const panel = screen.getByTestId(`folder-actions-menu-panel-${CWD}`);
    expect(panel.getAttribute("role")).toBe("menu");
    expect(screen.getByTestId("folder-menu-item-pin").getAttribute("role")).toBe("menuitem");
    expect(screen.getByTestId("folder-menu-item-urgency-sort").getAttribute("role")).toBe("menuitem");
  });
});

describe("FolderActionsMenu dismissal (X1, X2)", () => {
  it("X1: Escape closes the menu and returns focus to the trigger", () => {
    render(<Harness items={makeItems()} />);
    const trigger = screen.getByTestId(`folder-actions-menu-${CWD}`);
    fireEvent.click(trigger);
    const first = screen.getByTestId("folder-menu-item-pin");
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Escape" });
    expect(screen.queryByTestId(`folder-actions-menu-panel-${CWD}`)).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId(`folder-actions-menu-${CWD}`));
  });

  it("X2: a click outside closes the menu and fires no item handler", () => {
    const onSelect = vi.fn();
    render(<Harness items={makeItems(onSelect)} />);
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    expect(screen.getByTestId(`folder-actions-menu-panel-${CWD}`)).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId(`folder-actions-menu-panel-${CWD}`)).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("FolderActionsMenu keyboard traversal", () => {
  it("ArrowDown / ArrowUp move focus between items", () => {
    render(<Harness items={makeItems()} />);
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    const pin = screen.getByTestId("folder-menu-item-pin");
    const sort = screen.getByTestId("folder-menu-item-urgency-sort");
    pin.focus();
    fireEvent.keyDown(pin, { key: "ArrowDown" });
    expect(document.activeElement).toBe(sort);
    fireEvent.keyDown(sort, { key: "ArrowUp" });
    expect(document.activeElement).toBe(pin);
  });
});

describe("FolderActionsMenu grouping", () => {
  it("renders a group only when it holds at least one item, workspace before directory", () => {
    render(
      <Harness
        items={[
          { id: "pin", group: "directory", label: "Pin directory", icon: mdiPin, onSelect: () => {} },
          { id: "remove-from-workspace", group: "workspace", label: "Remove from workspace", icon: mdiPin, onSelect: () => {} },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    const panel = screen.getByTestId(`folder-actions-menu-panel-${CWD}`);
    const groups = Array.from(panel.querySelectorAll("[data-testid^='folder-menu-group-']")).map((n) =>
      n.getAttribute("data-testid"),
    );
    expect(groups).toEqual(["folder-menu-group-workspace", "folder-menu-group-directory"]);
  });

  it("omits the workspace group heading when no workspace item applies", () => {
    render(<Harness items={makeItems()} />);
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    expect(screen.queryByTestId("folder-menu-group-workspace")).toBeNull();
    expect(screen.getByTestId("folder-menu-group-directory")).toBeTruthy();
  });
});
