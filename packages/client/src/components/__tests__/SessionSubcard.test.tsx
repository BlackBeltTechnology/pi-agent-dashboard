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
    expect(title.className).toContain("-top-1.5");
    expect(title.className).toContain("rounded-full");
    expect(screen.getByText("hello")).toBeTruthy();
    const panel = container.firstChild as HTMLElement;
    // Panel has no fill — border only, so the card background shows through.
    expect(panel.className).not.toContain("bg-[");
    expect(panel.className).toContain("rounded-lg");
    expect(panel.className).toContain("border");
    expect(panel.className).toContain("relative");
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

// test-plan #E9 — capsule legend is 12 px semibold --text-secondary.
// See change: retro-ux-plugin-settings-forms.
describe("SessionSubcard capsule legend", () => {
  it("uses the section-heading recipe, not the 9 px tertiary legend", () => {
    const { container } = render(
      <SessionSubcard title="OPENSPEC">
        <span>x</span>
      </SessionSubcard>,
    );
    const legend = screen.getByText("OPENSPEC");
    for (const token of ["text-[12px]", "font-semibold", "uppercase", "text-[var(--text-secondary)]"]) {
      expect(legend.className).toContain(token);
    }
    expect(legend.className).not.toContain("text-[9px]");
    expect(legend.className).not.toContain("text-[var(--text-tertiary)]");
    expect((container.firstChild as HTMLElement).className).not.toContain("bg-[");
  });
});
