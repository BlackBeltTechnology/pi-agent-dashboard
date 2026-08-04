/**
 * Tag chip primitive component tests: add via autocomplete, add brand-new,
 * remove (pointer + keyboard), and card overflow `+N` collapse.
 * See change: add-session-tags.
 */

import { tagColor } from "@blackbelt-technology/pi-dashboard-shared/tags.js";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TagChip } from "../TagChip.js";
import { TagEditor } from "../TagEditor.js";
import { TagFilterGroup } from "../TagFilterGroup.js";
import { TagStrip } from "../TagStrip.js";

afterEach(() => cleanup());

describe("TagEditor", () => {
  it("adds an existing tag via autocomplete", () => {
    const onChange = vi.fn();
    const { getByLabelText, getByText } = render(
      <TagEditor tags={["feature"]} allTags={["feature", "backend", "docs"]} onChange={onChange} />,
    );

    fireEvent.click(getByLabelText("Add tag"));
    fireEvent.change(getByLabelText("Tag name"), { target: { value: "back" } });
    // Suggestion chip renders "#backend"
    fireEvent.click(getByText("#backend"));

    expect(onChange).toHaveBeenCalledWith(["feature", "backend"]);
  });

  it("adds a brand-new tag on Enter", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <TagEditor tags={[]} allTags={["feature"]} onChange={onChange} />,
    );

    fireEvent.click(getByLabelText("Add tag"));
    const input = getByLabelText("Tag name");
    fireEvent.change(input, { target: { value: "Brand-New" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Normalized to lowercase.
    expect(onChange).toHaveBeenCalledWith(["brand-new"]);
  });

  it("does not add a duplicate tag", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <TagEditor tags={["feature"]} allTags={["feature"]} onChange={onChange} />,
    );
    fireEvent.click(getByLabelText("Add tag"));
    const input = getByLabelText("Tag name");
    fireEvent.change(input, { target: { value: "feature" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a tag via the chip ✕ (pointer)", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <TagEditor tags={["feature", "backend"]} allTags={["feature", "backend"]} onChange={onChange} />,
    );
    fireEvent.click(getByLabelText("Remove tag feature"));
    expect(onChange).toHaveBeenCalledWith(["backend"]);
  });
});

describe("TagChip keyboard operability", () => {
  it("removes a tag when the remove control is activated via keyboard", () => {
    const onRemove = vi.fn();
    const { getByLabelText } = render(
      <TagChip label="feature" variant="user" onRemove={onRemove} />,
    );
    const btn = getByLabelText("Remove tag feature");
    btn.focus();
    // Enter on a focused <button> fires a click in jsdom.
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("filter chip exposes aria-pressed and toggles", () => {
    const onToggle = vi.fn();
    const { getByLabelText } = render(
      <TagChip label="feature" variant="filter" tone="user" selected onToggle={onToggle} />,
    );
    const btn = getByLabelText("Filter by tag feature");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

// Sidebar filter overflow + destructive remove control.
// See change: sidebar-tag-collapse-and-delete.
describe("TagFilterGroup overflow cap", () => {
  const tags10 = Array.from({ length: 10 }, (_, i) => `tag${i}`);
  const tags13 = Array.from({ length: 13 }, (_, i) => `tag${i}`);

  // E1: exactly at the cap → all 10 chips, NO +N more control.
  it("E1 — at the cap shows all chips and no overflow control", () => {
    const { getByLabelText, queryByTestId } = render(
      <TagFilterGroup label="Your tags" tags={tags10} selected={new Set()} onToggle={() => {}} tone="user" cap={10} />,
    );
    for (const tag of tags10) expect(getByLabelText(`Filter by tag ${tag}`)).toBeTruthy();
    expect(queryByTestId("tag-overflow-toggle")).toBeNull();
  });

  // E2: above the cap → 10 + `+3 more`; expand → all 13 + `show less`; collapse → back.
  it("E2 — above the cap shows +N more, expands to all, and collapses back", () => {
    const { getByTestId, queryByLabelText } = render(
      <TagFilterGroup label="Your tags" tags={tags13} selected={new Set()} onToggle={() => {}} tone="user" cap={10} />,
    );
    const toggle = getByTestId("tag-overflow-toggle");
    expect(toggle.textContent).toBe("+3 more");
    // First render: 10 shown, 3 hidden.
    expect(queryByLabelText("Filter by tag tag9")).toBeTruthy();
    expect(queryByLabelText("Filter by tag tag10")).toBeNull();
    // Expand → all 13 + show less.
    fireEvent.click(toggle);
    expect(getByTestId("tag-overflow-toggle").textContent).toBe("show less");
    expect(queryByLabelText("Filter by tag tag12")).toBeTruthy();
    // Collapse back → 10 + +3 more.
    fireEvent.click(getByTestId("tag-overflow-toggle"));
    expect(getByTestId("tag-overflow-toggle").textContent).toBe("+3 more");
    expect(queryByLabelText("Filter by tag tag10")).toBeNull();
  });
});

describe("TagChip filter remove control", () => {
  // F2: the ✕ is a separate control — activating it fires onRemove, NOT onToggle.
  it("F2 — remove is independent of the filter toggle", () => {
    const onToggle = vi.fn();
    const onRemove = vi.fn();
    const { getByLabelText } = render(
      <TagChip label="explore" variant="filter" tone="user" onToggle={onToggle} onRemove={onRemove} />,
    );
    const removeBtn = getByLabelText("Remove tag explore from all sessions");
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
    // The toggle is still reachable and independent.
    fireEvent.click(getByLabelText("Filter by tag explore"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // X2: the ✕ is independently keyboard-operable with an action+tag name.
  it("X2 — remove control is keyboard-operable with an accessible name", () => {
    const onRemove = vi.fn();
    const { getByLabelText } = render(
      <TagChip label="explore" variant="filter" tone="user" onToggle={() => {}} onRemove={onRemove} />,
    );
    const removeBtn = getByLabelText("Remove tag explore from all sessions");
    removeBtn.focus();
    expect(document.activeElement).toBe(removeBtn);
    fireEvent.click(removeBtn); // Enter/Space on a focused <button> fires click in jsdom.
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  // F4: phase (exec-tone) filter chips NEVER render the remove control.
  it("F4 — phase (exec) chips have no remove control even when onRemove is passed", () => {
    const onRemove = vi.fn();
    const { queryByLabelText, getByLabelText } = render(
      <TagChip label="apply" variant="filter" tone="exec" onToggle={() => {}} onRemove={onRemove} />,
    );
    expect(getByLabelText("Filter by phase apply")).toBeTruthy();
    expect(queryByLabelText("Remove tag apply from all sessions")).toBeNull();
  });

  // F4 (group): a TagFilterGroup with tone="exec" renders no remove controls.
  it("F4 — exec-tone filter group renders no remove controls", () => {
    const { queryAllByLabelText } = render(
      <TagFilterGroup label="Phase" tags={["apply", "archive"]} selected={new Set()} onToggle={() => {}} tone="exec" onRemove={() => {}} />,
    );
    expect(queryAllByLabelText(/from all sessions$/)).toHaveLength(0);
  });
});

/** jsdom serializes inline colors to `rgb(...)`; normalize a palette hex the same way. */
function asInlineColor(hex: string): string {
  const probe = document.createElement("div");
  probe.style.color = hex;
  return probe.style.color;
}

/**
 * Effective selection-ring color of a ring host: an explicit inline
 * `outlineColor` when present, else whatever `outline-current` resolves to
 * (the host's own inline `color`; empty when it inherits ambient text).
 */
function ringColor(el: HTMLElement): string {
  if (el.style.outlineColor) return el.style.outlineColor;
  if (el.className.includes("outline-current")) return el.style.color;
  return "";
}

describe("TagChip selected ring color", () => {
  // Ring color tracks the tag's own palette color, in the remove-enabled
  // (sidebar "Your tags") layout where the ring is hosted on the wrapper.
  it("remove-enabled selected chip rings in its own tag color on the wrapper", () => {
    const { getByLabelText } = render(
      <TagChip
        label="dashboard"
        variant="filter"
        tone="user"
        selected
        onToggle={() => {}}
        onRemove={() => {}}
      />,
    );
    const toggle = getByLabelText("Filter by tag dashboard");
    const wrapper = toggle.parentElement as HTMLElement;
    // The ring is hosted on the wrapper enclosing the toggle + the ✕.
    expect(within(wrapper).getByLabelText("Remove tag dashboard from all sessions")).toBeTruthy();
    expect(ringColor(wrapper)).toBe(asInlineColor(tagColor("dashboard").text));
  });

  // Both user-tone layouts must render an identical ring color (D3).
  it("toggle-only selected chip rings in the same tag color", () => {
    const { getByLabelText } = render(
      <TagChip label="dashboard" variant="filter" tone="user" selected onToggle={() => {}} />,
    );
    const toggle = getByLabelText("Filter by tag dashboard");
    expect(ringColor(toggle)).toBe(asInlineColor(tagColor("dashboard").text));
  });

  // D4: 1px ring with the offset retained — not the old boxy `outline-2`.
  it("selected ring is 1px with the offset retained", () => {
    const { getByLabelText } = render(
      <TagChip label="dashboard" variant="filter" tone="user" selected onToggle={() => {}} />,
    );
    const cls = getByLabelText("Filter by tag dashboard").className;
    expect(cls).toContain("outline-1");
    expect(cls).toContain("outline-offset-1");
    expect(cls).not.toContain("outline-2");
  });

  // D5: exec-tone chips keep `outline-current` — no inline tag color.
  it("exec-tone selected chip keeps outline-current and no inline ring color", () => {
    const { getByLabelText } = render(
      <TagChip label="apply" variant="filter" tone="exec" selected onToggle={() => {}} />,
    );
    const toggle = getByLabelText("Filter by phase apply");
    expect(toggle.className).toContain("outline-current");
    expect(toggle.style.outlineColor).toBe("");
  });

  it("unselected chip renders no selection ring and reports aria-pressed=false", () => {
    const { getByLabelText } = render(
      <TagChip
        label="dashboard"
        variant="filter"
        tone="user"
        onToggle={() => {}}
        onRemove={() => {}}
      />,
    );
    const toggle = getByLabelText("Filter by tag dashboard");
    const wrapper = toggle.parentElement as HTMLElement;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.className).not.toContain("outline");
    expect(toggle.style.outlineColor).toBe("");
    expect(wrapper.className).not.toContain("outline");
    expect(wrapper.style.outlineColor).toBe("");
  });
});

describe("TagStrip overflow", () => {
  it("collapses tags beyond the cap into +N and shows the phase chip", () => {
    const { getByText, getByLabelText } = render(
      <TagStrip tags={["a", "b", "c", "d", "e"]} phase="apply" max={3} />,
    );
    // First 3 shown.
    expect(getByText("#a")).toBeTruthy();
    expect(getByText("#c")).toBeTruthy();
    // Overflow indicator for the remaining 2.
    expect(getByLabelText("2 more tags").textContent).toBe("+2");
    // Read-only phase chip present.
    const phase = getByText("apply");
    expect(within(phase.parentElement as HTMLElement).getByText("apply")).toBeTruthy();
  });

  it("renders nothing when there are no tags and no phase", () => {
    const { container } = render(<TagStrip tags={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
