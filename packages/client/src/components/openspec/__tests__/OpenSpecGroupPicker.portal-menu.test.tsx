/**
 * Overlay-layering contract for OpenSpecGroupPicker dropdown.
 * Verifies fixed z-popover not absolute z-50.
 * See change: migrate-workspace-menus-to-portal-layer.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { OpenSpecGroupPicker } from "../OpenSpecGroupPicker.js";

afterEach(() => cleanup());

const GROUPS: OpenSpecGroup[] = [
  { id: "g1", name: "Core", color: "blue", order: 0 },
  { id: "g2", name: "Backlog", color: "gray", order: 1 },
];

describe("OpenSpecGroupPicker dropdown overlay-layering", () => {
  it("dropdown panel has fixed and z-popover, not absolute or z-50", () => {
    render(<OpenSpecGroupPicker groups={GROUPS} onAssign={() => {}} />);
    fireEvent.click(screen.getByTestId("group-picker-trigger"));
    const panel = screen.getByTestId("group-picker-dropdown");
    expect(panel.className).toContain("fixed");
    expect(panel.className).toContain("z-popover");
    expect(panel.className).not.toContain("absolute");
    expect(panel.className).not.toContain("z-50");
  });

  it("clicking a group item calls onAssign", () => {
    const onAssign = vi.fn();
    render(<OpenSpecGroupPicker groups={GROUPS} onAssign={onAssign} />);
    fireEvent.click(screen.getByTestId("group-picker-trigger"));
    fireEvent.click(screen.getByTestId("group-option-g1"));
    expect(onAssign).toHaveBeenCalledWith("g1");
  });

  it("outside click closes the dropdown", () => {
    const { container } = render(<OpenSpecGroupPicker groups={GROUPS} onAssign={() => {}} />);
    fireEvent.click(screen.getByTestId("group-picker-trigger"));
    expect(screen.queryByTestId("group-picker-dropdown")).not.toBeNull();
    fireEvent.mouseDown(container.ownerDocument.body);
    expect(screen.queryByTestId("group-picker-dropdown")).toBeNull();
  });
});
