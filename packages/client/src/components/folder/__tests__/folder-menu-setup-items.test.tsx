/**
 * Contract for the folder actions menu's directory-group additions
 * (change: add-folder-action-banner): the permanent `Project setup…` item with
 * its `n/N` tally and `● update` badge, and the broken-session cleanup item.
 *
 * The tally/badge logic lives in the pure `projectSetupLabel`; the rendering +
 * test-id convention is exercised by driving `FolderActionsMenu` with items
 * shaped exactly as `SessionList.folderMenuItems` builds them.
 *
 * Covers test-plan #E9, #E10, #E12, #E13, #E14 (and #E5's menu half).
 */

import { mdiBroom, mdiTextBoxCheckOutline } from "@mdi/js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SetupArtifact, WorktreeInitStatus } from "../../../lib/git/git-api.js";
import { FolderActionsMenu, type FolderMenuItem } from "../FolderActionsMenu.js";
import { projectSetupLabel } from "../folder-menu-labels.js";

vi.mock("../../../hooks/useMobile.js", () => ({ useMobile: () => false }));

afterEach(() => cleanup());

const CWD = "/a/proj";
const ALL: SetupArtifact["id"][] = ["settings", "agents", "prompts", "openspec", "kb"];
function checklist(present: SetupArtifact["id"][]): SetupArtifact[] {
  return ALL.map((id) => ({ id, present: present.includes(id), required: id === "settings" }));
}

/** Mirror of SessionList.folderMenuItems' directory-group additions. */
function directoryItems(status: WorktreeInitStatus | null, brokenCount: number): FolderMenuItem[] {
  const items: FolderMenuItem[] = [
    { id: "project-setup", group: "directory", label: projectSetupLabel(status), icon: mdiTextBoxCheckOutline, onSelect: () => {} },
  ];
  if (brokenCount > 0) {
    items.push({ id: "cleanup-broken", group: "directory", label: `Clean up broken (${brokenCount})`, icon: mdiBroom, onSelect: () => {} });
  }
  return items;
}

function Harness({ items }: { items: FolderMenuItem[] }) {
  const [open, setOpen] = React.useState(false);
  return <FolderActionsMenu cwd={CWD} items={items} open={open} onOpenChange={setOpen} />;
}

function openMenu() {
  fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
}

describe("projectSetupLabel", () => {
  it("E12: full checklist → 5/5", () => {
    expect(projectSetupLabel({ hasHook: false, checklist: checklist(ALL) })).toBe("Project setup… 5/5");
  });
  it("E5: partial checklist → 3/5", () => {
    expect(projectSetupLabel({ hasHook: false, checklist: checklist(["settings", "agents", "openspec"]) })).toBe("Project setup… 3/5");
  });
  it("E13: setupOutdated adds a ● update badge", () => {
    expect(projectSetupLabel({ hasHook: false, checklist: checklist(ALL), setupOutdated: true })).toContain("● update");
  });
  it("E14: absent setupOutdated → no badge", () => {
    expect(projectSetupLabel({ hasHook: false, checklist: checklist(ALL) })).not.toContain("● update");
  });
  it("absent checklist → bare label, never a misleading 0/5", () => {
    expect(projectSetupLabel({ hasHook: false })).toBe("Project setup…");
  });
});

describe("directory-group menu items", () => {
  it("E12: permanent Project setup item is present for a fully configured directory", () => {
    render(<Harness items={directoryItems({ hasHook: false, checklist: checklist(ALL) }, 0)} />);
    openMenu();
    const item = screen.getByTestId("folder-menu-item-project-setup");
    expect(item.textContent).toContain("Project setup… 5/5");
  });

  it("E13: update badge renders on the flag", () => {
    render(<Harness items={directoryItems({ hasHook: false, checklist: checklist(ALL), setupOutdated: true }, 0)} />);
    openMenu();
    expect(screen.getByTestId("folder-menu-item-project-setup").textContent).toContain("● update");
  });

  it("E9: cleanup item appears in the DIRECTORY group naming the count", () => {
    render(<Harness items={directoryItems({ hasHook: false, checklist: checklist(ALL) }, 3)} />);
    openMenu();
    const item = screen.getByTestId("folder-menu-item-cleanup-broken");
    expect(item.textContent).toContain("3");
    // It lives in the directory group.
    expect(screen.getByTestId("folder-menu-group-directory").contains(item)).toBe(true);
  });

  it("E10: cleanup item is absent at zero broken sessions", () => {
    render(<Harness items={directoryItems({ hasHook: false, checklist: checklist(ALL) }, 0)} />);
    openMenu();
    expect(screen.queryByTestId("folder-menu-item-cleanup-broken")).toBeNull();
  });
});
