/**
 * Settings "Default grouping" segmented radiogroup. See change: session-list-group-by.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DefaultGroupingField } from "../settings/DefaultGroupingField.js";

afterEach(() => cleanup());

describe("DefaultGroupingField", () => {
  it("exposes a radiogroup with the current value checked", () => {
    render(<DefaultGroupingField value="status" onChange={() => {}} />);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getByTestId("settings-default-grouping-status").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("settings-default-grouping-none").getAttribute("aria-checked")).toBe("false");
  });

  it("click sends the chosen mode", () => {
    const onChange = vi.fn();
    render(<DefaultGroupingField value="none" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("settings-default-grouping-location"));
    expect(onChange).toHaveBeenCalledWith("location");
  });

  it("ArrowRight / ArrowLeft change the value (wrapping)", () => {
    const onChange = vi.fn();
    render(<DefaultGroupingField value="location" onChange={onChange} />);
    fireEvent.keyDown(screen.getByTestId("settings-default-grouping-location"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("none");
    fireEvent.keyDown(screen.getByTestId("settings-default-grouping-location"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("status");
  });
});
