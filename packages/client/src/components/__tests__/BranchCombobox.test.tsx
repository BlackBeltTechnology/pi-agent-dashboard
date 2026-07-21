import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React, { useState } from "react";
import { BranchCombobox } from "../worktree/BranchCombobox.js";
import type { GitBranchEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

afterEach(() => cleanup());

const branches: GitBranchEntry[] = [
  { name: "main", isRemote: false, isCurrent: true },
  { name: "develop", isRemote: false, isCurrent: false },
  { name: "feature/ui", isRemote: false, isCurrent: false },
  { name: "origin/fix-bug", isRemote: true, isCurrent: false },
];

function Controlled({
  initial = "",
  onChange,
  disabled,
  placeholder,
}: {
  initial?: string;
  onChange?: (b: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <BranchCombobox
      data-testid="bc"
      branches={branches}
      value={value}
      onChange={(b) => {
        setValue(b);
        onChange?.(b);
      }}
      disabled={disabled}
      placeholder={placeholder}
    />
  );
}

describe("BranchCombobox", () => {
  it("closed by default: trigger renders, popover absent", () => {
    render(<Controlled initial="main" />);
    expect(screen.getByTestId("bc")).toBeTruthy();
    expect(screen.queryByTestId("bc-popover")).toBeNull();
    expect(screen.getByTestId("bc").getAttribute("aria-expanded")).toBe("false");
  });

  it("clicking the trigger opens the popover and focuses the filter input", () => {
    render(<Controlled initial="main" />);
    fireEvent.click(screen.getByTestId("bc"));
    const filter = screen.getByTestId("bc-filter") as HTMLInputElement;
    expect(filter).toBeTruthy();
    expect(document.activeElement).toBe(filter);
    expect(screen.getByTestId("bc").getAttribute("aria-expanded")).toBe("true");
  });

  it("typing in the filter narrows the listbox", () => {
    render(<Controlled initial="main" />);
    fireEvent.click(screen.getByTestId("bc"));
    fireEvent.change(screen.getByTestId("bc-filter"), { target: { value: "feat" } });
    const popover = screen.getByTestId("bc-popover");
    // Scope text queries to popover so the trigger label ("main") doesn't false-positive.
    const within = (text: string) =>
      Array.from(popover.querySelectorAll("*")).find((n) => n.textContent === text);
    expect(within("feature/ui")).toBeTruthy();
    expect(within("main")).toBeUndefined();
    expect(within("develop")).toBeUndefined();
  });

  it("click on a row calls onChange, closes popover, and updates trigger label", () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.click(screen.getByTestId("bc"));
    fireEvent.click(screen.getByText("develop"));
    expect(onChange).toHaveBeenCalledWith("develop");
    expect(screen.queryByTestId("bc-popover")).toBeNull();
    expect(screen.getByTestId("bc").textContent).toContain("develop");
  });

  it("ArrowDown then Enter selects the highlighted branch", () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.click(screen.getByTestId("bc"));
    const filter = screen.getByTestId("bc-filter");
    fireEvent.keyDown(filter, { key: "ArrowDown" }); // highlight first selectable = main (idx 0, disableCurrent=false)
    fireEvent.keyDown(filter, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("main");
    expect(screen.queryByTestId("bc-popover")).toBeNull();
  });

  it("Enter when filter matches nothing does not call onChange and does not close", () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.click(screen.getByTestId("bc"));
    fireEvent.change(screen.getByTestId("bc-filter"), { target: { value: "zzzz" } });
    fireEvent.keyDown(screen.getByTestId("bc-filter"), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("bc-popover")).not.toBeNull();
  });

  it("Esc closes the popover and does not propagate to parent listeners", () => {
    const parentSpy = vi.fn();
    function Wrapper() {
      return (
        <div onKeyDown={parentSpy}>
          <Controlled initial="main" />
        </div>
      );
    }
    render(<Wrapper />);
    fireEvent.click(screen.getByTestId("bc"));
    fireEvent.keyDown(screen.getByTestId("bc-filter"), { key: "Escape" });
    expect(screen.queryByTestId("bc-popover")).toBeNull();
    expect(parentSpy).not.toHaveBeenCalled();
  });

  it("outside-click closes the popover", () => {
    render(
      <div>
        <Controlled initial="main" />
        <button data-testid="outside">outside</button>
      </div>,
    );
    fireEvent.click(screen.getByTestId("bc"));
    expect(screen.queryByTestId("bc-popover")).not.toBeNull();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("bc-popover")).toBeNull();
  });

  it("disabled prop: trigger does not open on click", () => {
    render(<Controlled initial="main" disabled />);
    fireEvent.click(screen.getByTestId("bc"));
    expect(screen.queryByTestId("bc-popover")).toBeNull();
  });

  it('value === "" with placeholder set: trigger renders the placeholder', () => {
    render(<Controlled initial="" placeholder="pick a base" />);
    expect(screen.getByTestId("bc").textContent).toContain("pick a base");
  });
});
