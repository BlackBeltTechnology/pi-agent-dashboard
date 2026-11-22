/**
 * Popover form: scrolling the (viewport-bounded) panel re-measures the trigger
 * (`usePopoverFlip` listens to capture-phase scroll), which must NOT pull focus
 * back to the checked radio — otherwise a keyboard user can never step onto an
 * item below the fold on a short viewport (a focused item scrolls the panel,
 * the scroll re-measures, focus snaps back to the top).
 *
 * See change: sidebar-folder-ux (#1153 reproduce-first, test-plan #F1).
 */
import { mdiPin } from "@mdi/js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderActionsMenu, type FolderMenuRadioGroup } from "../folder/FolderActionsMenu.js";

vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => false }));

afterEach(() => cleanup());

const CWD = "/a/b";
const radio: FolderMenuRadioGroup = {
  id: "gb",
  label: "Group sessions by",
  items: [
    { id: "default", label: "Use default", checked: true, onSelect: () => {} },
    { id: "status", label: "Status", checked: false, onSelect: () => {} },
  ],
};

function Harness() {
  const [open, setOpen] = React.useState(false);
  return (
    <FolderActionsMenu
      cwd={CWD}
      items={[{ id: "pin", group: "directory", label: "Pin directory", icon: mdiPin, onSelect: () => {} }]}
      open={open}
      onOpenChange={setOpen}
      radioGroup={radio}
    />
  );
}

describe("FolderActionsMenu — focus survives panel re-measure (popover form)", () => {
  it("opens with focus on the checked radio", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    expect(document.activeElement).toBe(screen.getByTestId("folder-menu-radio-default"));
  });

  it("a scroll (re-measure) after the user moved focus does not steal it back", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    const pin = screen.getByTestId("folder-menu-item-pin");
    pin.focus();
    expect(document.activeElement).toBe(pin);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
    });
    expect(document.activeElement).toBe(pin);
  });

  it("re-opening focuses the checked radio again", () => {
    render(<Harness />);
    const trigger = screen.getByTestId(`folder-actions-menu-${CWD}`);
    fireEvent.click(trigger);
    screen.getByTestId("folder-menu-item-pin").focus();
    fireEvent.keyDown(screen.getByTestId(`folder-actions-menu-panel-${CWD}`), { key: "Escape" });
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByTestId("folder-menu-radio-default"));
  });
});
