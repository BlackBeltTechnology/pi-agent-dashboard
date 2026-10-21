/**
 * Group pills: pressed = selected-chip recipe, unpressed/manage = --text-secondary, 12px.
 * See change: fix-folder-card-pill-contrast (test-plan #E19).
 */
import type { OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { OpenSpecGroupPills } from "../openspec/OpenSpecGroupPills.js";

afterEach(() => cleanup());

const groups = [{ id: "g1", name: "Alpha", color: "blue" }] as unknown as OpenSpecGroup[];
const ACTIVE = ["text-[var(--text-primary)]", "bg-[var(--accent-soft)]", "border-[var(--accent)]"];

describe("OpenSpecGroupPills colour roles", () => {
  it("All pill is pressed when no group is active", () => {
    render(<OpenSpecGroupPills groups={groups} activeGroupId={null} onSelect={() => {}} />);
    const all = screen.getByTestId("group-pill-all");
    for (const c of ACTIVE) expect(all.className).toContain(c);
    const g = screen.getByTestId("group-pill-g1");
    expect(g.className).toContain("text-[var(--text-secondary)]");
    expect(g.className).not.toContain("bg-[var(--accent-soft)]");
  });

  it("an active group is pressed, All is unpressed, labels are 12px", () => {
    render(<OpenSpecGroupPills groups={groups} activeGroupId="g1" onSelect={() => {}} />);
    const g = screen.getByTestId("group-pill-g1");
    for (const c of ACTIVE) expect(g.className).toContain(c);
    const all = screen.getByTestId("group-pill-all");
    expect(all.className).toContain("text-[var(--text-secondary)]");
    for (const el of [g, all]) {
      expect(el.className).toContain("text-[12px]");
      expect(el.className).not.toMatch(/-(blue|red)-\d{3}/);
      expect(el.className).not.toContain("--text-muted");
    }
  });

  it("manage link is --text-secondary, hover --link-hover, 12px", () => {
    render(<OpenSpecGroupPills groups={groups} activeGroupId={null} onSelect={() => {}} onManageGroups={() => {}} />);
    const m = screen.getByTestId("manage-groups-link");
    expect(m.className).toContain("text-[var(--text-secondary)]");
    expect(m.className).toContain("hover:text-[var(--link-hover)]");
    expect(m.className).toContain("text-[12px]");
  });
});
