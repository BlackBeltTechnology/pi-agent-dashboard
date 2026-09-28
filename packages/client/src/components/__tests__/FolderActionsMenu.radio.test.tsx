/**
 * FolderActionsMenu radio group (folder Group-by choice): menuitemradio ARIA,
 * focus-on-checked at open, arrow-key roving, select closes + restores focus.
 * See change: session-list-group-by.
 */
import { mdiPin } from "@mdi/js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderActionsMenu, type FolderMenuRadioGroup } from "../folder/FolderActionsMenu.js";

vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => true }));

afterEach(() => cleanup());

const CWD = "/a/b";

function Harness({ radio }: { radio: FolderMenuRadioGroup }) {
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

function radio(onSelect = vi.fn()): FolderMenuRadioGroup {
  return {
    id: "group-by",
    label: "Group sessions by",
    items: [
      { id: "gb-default", label: "Use default (None)", checked: false, onSelect },
      { id: "gb-status", label: "Status", description: "Needs you · Working · Idle", checked: true, onSelect },
      { id: "gb-location", label: "Location", checked: false, onSelect },
    ],
  };
}

describe("FolderActionsMenu radioGroup", () => {
  it("renders menuitemradio with aria-checked and focuses the checked item on open", () => {
    render(<Harness radio={radio()} />);
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    const status = screen.getByTestId("folder-menu-radio-gb-status");
    expect(status.getAttribute("role")).toBe("menuitemradio");
    expect(status.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("folder-menu-radio-gb-default").getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(status);
  });

  it("ArrowDown roves across radios and menuitems", () => {
    render(<Harness radio={radio()} />);
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    const panel = screen.getByTestId(`folder-actions-menu-panel-${CWD}`);
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("folder-menu-radio-gb-location"));
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("folder-menu-item-pin"));
  });

  it("selecting closes the menu, restores focus to the trigger, and fires onSelect", () => {
    const onSelect = vi.fn();
    render(<Harness radio={radio(onSelect)} />);
    const trigger = screen.getByTestId(`folder-actions-menu-${CWD}`);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId("folder-menu-radio-gb-location"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(`folder-actions-menu-panel-${CWD}`)).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
