import { SLOT_PILL_LEGEND } from "@blackbelt-technology/dashboard-plugin-runtime";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SessionSubcard } from "../session/SessionSubcard.js";

afterEach(() => cleanup());

describe("SessionSubcard", () => {
  it("renders title and children when children non-empty", () => {
    const { container } = render(
      <SessionSubcard title="OPENSPEC">
        <span>hello</span>
      </SessionSubcard>,
    );
    const title = screen.getByText("OPENSPEC");
    expect(title).toBeTruthy();
    expect(title.className).toContain("uppercase");
    // Title is a capsule overhanging the panel top border (legend style).
    expect(title.className).toContain("absolute");
    expect(title.className).toContain("-top-2");
    expect(title.className).toContain("rounded-full");
    expect(screen.getByText("hello")).toBeTruthy();
    const panel = container.firstChild as HTMLElement;
    // Panel has no fill — border only, so the card background shows through.
    expect(panel.className).not.toContain("bg-[");
    expect(panel.className).toContain("rounded-lg");
    expect(panel.className).toContain("border");
    expect(panel.className).toContain("relative");
    // test-plan #E4: legend clearance — mt-2.5 above, pt-2.5 pb-1.5 inside.
    const tokens = panel.className.split(/\s+/);
    for (const t of ["mt-2.5", "px-2", "pt-2.5", "pb-1.5"]) expect(tokens).toContain(t);
    for (const bad of ["mt-1.5", "py-1.5"]) expect(tokens).not.toContain(bad);
  });

  it("renders nothing when children are null", () => {
    const { container } = render(
      <SessionSubcard title="MEMORY">{null}</SessionSubcard>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when children are false", () => {
    const { container } = render(
      <SessionSubcard title="PROCESS">{false}</SessionSubcard>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when children are an empty array", () => {
    const { container } = render(
      <SessionSubcard title="FLOWS">{[]}</SessionSubcard>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when children are undefined", () => {
    const { container } = render(
      <SessionSubcard title="WORKSPACE">{undefined}</SessionSubcard>,
    );
    expect(container.firstChild).toBeNull();
  });
});

// test-plan #E4/#E5 — capsule legend is 11 px semibold --text-secondary, parity with SlotPill.
// See change: retro-ux-plugin-settings-forms; fix-slot-pill-legend-and-stale-overflow.
describe("SessionSubcard capsule legend", () => {
  it("uses the 11 px section-heading recipe, not the 9 px tertiary legend", () => {
    const { container } = render(
      <SessionSubcard title="OPENSPEC">
        <span>x</span>
      </SessionSubcard>,
    );
    const legend = screen.getByText("OPENSPEC");
    for (const token of ["-top-2", "text-[11px]", "font-semibold", "uppercase", "tracking-wide", "text-[var(--text-secondary)]"]) {
      expect(legend.className.split(/\s+/)).toContain(token);
    }
    for (const bad of ["text-[9px]", "text-[12px]", "tracking-wider", "text-[var(--text-tertiary)]"]) {
      expect(legend.className.split(/\s+/)).not.toContain(bad);
    }
    expect((container.firstChild as HTMLElement).className).not.toContain("bg-[");
  });

  it("shares the size/weight/tracking/overhang/colour tokens with SLOT_PILL_LEGEND", () => {
    render(
      <SessionSubcard title="OPENSPEC">
        <span>x</span>
      </SessionSubcard>,
    );
    const legend = screen.getByText("OPENSPEC").className.split(/\s+/);
    const shared = SLOT_PILL_LEGEND.split(/\s+/);
    for (const token of ["text-[11px]", "font-semibold", "tracking-wide", "-top-2", "text-[var(--text-secondary)]"]) {
      expect(shared).toContain(token);
      expect(legend).toContain(token);
    }
  });
});
