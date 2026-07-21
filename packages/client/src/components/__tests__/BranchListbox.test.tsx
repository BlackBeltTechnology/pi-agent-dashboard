import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, renderHook, act } from "@testing-library/react";
import React, { useState } from "react";
import { BranchListbox, useBranchListboxKeyboard } from "../worktree/BranchListbox.js";
import type { GitBranchEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

afterEach(() => cleanup());

const localOnly: GitBranchEntry[] = [
  { name: "main", isRemote: false, isCurrent: true },
  { name: "develop", isRemote: false, isCurrent: false },
  { name: "feature/ui", isRemote: false, isCurrent: false },
];

const mixed: GitBranchEntry[] = [
  ...localOnly,
  { name: "origin/fix-bug", isRemote: true, isCurrent: false },
];

describe("BranchListbox (presentational)", () => {
  it("renders local branches before remote with a separator when both groups present", () => {
    render(
      <BranchListbox
        branches={mixed}
        filter=""
        highlightIndex={-1}
        onHighlightChange={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("develop")).toBeTruthy();
    expect(screen.getByText("origin/fix-bug")).toBeTruthy();
    expect(screen.getByText("Remote")).toBeTruthy();
  });

  it("omits the separator when only local branches present", () => {
    render(
      <BranchListbox
        branches={localOnly}
        filter=""
        highlightIndex={-1}
        onHighlightChange={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByText("Remote")).toBeNull();
  });

  it("omits the separator when only remote branches present", () => {
    const remoteOnly: GitBranchEntry[] = [
      { name: "origin/x", isRemote: true, isCurrent: false },
      { name: "origin/y", isRemote: true, isCurrent: false },
    ];
    render(
      <BranchListbox
        branches={remoteOnly}
        filter=""
        highlightIndex={-1}
        onHighlightChange={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByText("Remote")).toBeNull();
    expect(screen.getByText("origin/x")).toBeTruthy();
  });

  it("renders the current-branch ● marker", () => {
    render(
      <BranchListbox
        branches={mixed}
        filter=""
        highlightIndex={-1}
        onHighlightChange={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("●")).toBeTruthy();
  });

  it("disableCurrent=true makes the current branch non-clickable", () => {
    const onSelect = vi.fn();
    render(
      <BranchListbox
        branches={mixed}
        filter=""
        highlightIndex={-1}
        onHighlightChange={() => {}}
        onSelect={onSelect}
        disableCurrent
      />,
    );
    fireEvent.click(screen.getByText("main"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("disableCurrent=false allows selecting the current branch", () => {
    const onSelect = vi.fn();
    render(
      <BranchListbox
        branches={mixed}
        filter=""
        highlightIndex={-1}
        onHighlightChange={() => {}}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText("main"));
    expect(onSelect).toHaveBeenCalledWith("main");
  });

  it("filter narrows displayed items case-insensitively", () => {
    render(
      <BranchListbox
        branches={mixed}
        filter="FEAT"
        highlightIndex={-1}
        onHighlightChange={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("feature/ui")).toBeTruthy();
    expect(screen.queryByText("main")).toBeNull();
    expect(screen.queryByText("develop")).toBeNull();
  });

  it("clicking a non-current branch row calls onSelect with the branch name", () => {
    const onSelect = vi.fn();
    render(
      <BranchListbox
        branches={mixed}
        filter=""
        highlightIndex={-1}
        onHighlightChange={() => {}}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText("develop"));
    expect(onSelect).toHaveBeenCalledWith("develop");
  });

  it("aria-selected reflects the committed selectedValue, not the highlight", () => {
    // displayItems order with mixed (all local+remote, no filter):
    //   0 main, 1 develop, 2 feature/ui, 3 separator, 4 origin/fix-bug
    // highlightIndex points at develop (visual cursor) but selectedValue
    // is main — aria-selected must follow the committed value, not the cursor.
    render(
      <BranchListbox
        branches={mixed}
        filter=""
        highlightIndex={1}
        onHighlightChange={() => {}}
        onSelect={() => {}}
        selectedValue="main"
      />,
    );
    const main = screen.getByText("main").closest('[role="option"]');
    expect(main?.getAttribute("aria-selected")).toBe("true");
    const dev = screen.getByText("develop").closest('[role="option"]');
    expect(dev?.getAttribute("aria-selected")).toBe("false");
  });

  it("no option is aria-selected when selectedValue is omitted", () => {
    render(
      <BranchListbox
        branches={mixed}
        filter=""
        highlightIndex={1}
        onHighlightChange={() => {}}
        onSelect={() => {}}
      />,
    );
    const options = document.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(0);
    options.forEach((o) => expect(o.getAttribute("aria-selected")).toBe("false"));
  });
});

describe("useBranchListboxKeyboard hook", () => {
  function Harness({
    branches,
    filter,
    disableCurrent = false,
    onSelect = () => {},
  }: {
    branches: GitBranchEntry[];
    filter: string;
    disableCurrent?: boolean;
    onSelect?: (n: string) => void;
  }) {
    const [highlightIndex, setHighlightIndex] = useState(-1);
    const { handleKey, displayItems, selectableIndices } = useBranchListboxKeyboard({
      branches,
      filter,
      highlightIndex,
      onHighlightChange: setHighlightIndex,
      onSelect,
      disableCurrent,
    });
    return (
      <input
        data-testid="kbd"
        data-highlight={highlightIndex}
        data-selectable={selectableIndices.join(",")}
        data-count={displayItems.length}
        onKeyDown={(e) => {
          handleKey(e);
        }}
      />
    );
  }

  it("ArrowDown moves through selectableIndices with wraparound", () => {
    render(<Harness branches={mixed} filter="" disableCurrent />);
    const input = screen.getByTestId("kbd");
    // mixed selectables (disableCurrent skips main idx 0): [1,2,4]
    expect(input.getAttribute("data-selectable")).toBe("1,2,4");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("data-highlight")).toBe("1");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("data-highlight")).toBe("2");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("data-highlight")).toBe("4");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // wrap
    expect(input.getAttribute("data-highlight")).toBe("1");
  });

  it("ArrowUp moves backward with wraparound", () => {
    render(<Harness branches={mixed} filter="" disableCurrent />);
    const input = screen.getByTestId("kbd");
    fireEvent.keyDown(input, { key: "ArrowUp" }); // from -1 → last
    expect(input.getAttribute("data-highlight")).toBe("4");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("data-highlight")).toBe("2");
  });

  it("Enter on a highlighted selectable branch calls onSelect", () => {
    const onSelect = vi.fn();
    render(<Harness branches={mixed} filter="" disableCurrent onSelect={onSelect} />);
    const input = screen.getByTestId("kbd");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // highlight idx 1 = develop
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("develop");
  });

  it("Enter when filter has no matches is a no-op and handleKey returns false", () => {
    const onSelect = vi.fn();
    const captured: boolean[] = [];
    function NoMatchHarness() {
      const [highlightIndex, setHighlightIndex] = useState(-1);
      const { handleKey } = useBranchListboxKeyboard({
        branches: mixed,
        filter: "zzzz-no-match",
        highlightIndex,
        onHighlightChange: setHighlightIndex,
        onSelect,
      });
      return (
        <input
          data-testid="kbd2"
          onKeyDown={(e) => {
            captured.push(handleKey(e));
          }}
        />
      );
    }
    render(<NoMatchHarness />);
    const input = screen.getByTestId("kbd2");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(captured[0]).toBe(false);
  });
});
