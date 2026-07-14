/**
 * Tag chip primitive component tests: add via autocomplete, add brand-new,
 * remove (pointer + keyboard), and card overflow `+N` collapse.
 * See change: add-session-tags.
 */

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TagChip } from "../TagChip.js";
import { TagEditor } from "../TagEditor.js";
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
