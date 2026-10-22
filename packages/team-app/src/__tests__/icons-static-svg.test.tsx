/**
 * Team-app constant icon markup goes through `pi-static-svg`
 * (change: harden-client-sinks, test-plan #E16).
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GALLERY, ICON } from "../i18n/catalog.js";
import { Avatar, Icon } from "../ui/icons.js";

describe("Icon / Avatar static SVG (#E16)", () => {
  it("a known ICON key renders the constant SVG", () => {
    const { container } = render(<Icon name="plus" />);
    const svg = container.querySelector("svg");
    expect(ICON.plus).toContain("M12 5v14");
    expect(svg?.innerHTML).toContain("M12 5v14");
  });

  it("an unknown ICON key renders an empty <svg> and does not throw", () => {
    const { container } = render(<Icon name="nope" />);
    expect(container.querySelector("svg")?.innerHTML).toBe("");
  });

  it("a prototype key is not a map entry", () => {
    const { container } = render(<Icon name="constructor" />);
    expect(container.querySelector("svg")?.innerHTML).toBe("");
  });

  it("a known GALLERY key renders the constant SVG", () => {
    const id = Object.keys(GALLERY)[0];
    const { container } = render(<Avatar avatar={{ kind: "gallery", id }} name="Fox" />);
    expect(container.querySelector("svg")?.innerHTML.length).toBeGreaterThan(0);
  });

  it("an unknown GALLERY key renders no SVG markup and does not throw (initials, as today)", () => {
    const { container } = render(<Avatar avatar={{ kind: "gallery", id: "nope" }} name="Ada Lovelace" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toBe("AL");
  });
});
