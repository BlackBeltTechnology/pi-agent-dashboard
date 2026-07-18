import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
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
    // Panel uses color-mix to render bg-surface at 50% alpha so child content stays opaque.
    expect(panel.className).toContain("bg-[color-mix(in_srgb,var(--bg-surface)_50%,transparent)]");
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
