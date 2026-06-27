import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "../EmptyState.js";

afterEach(() => cleanup());

describe("EmptyState", () => {
  it("renders title, body, and a single primary CTA", () => {
    const onClick = vi.fn();
    const { getByText, getAllByRole, container } = render(
      <EmptyState
        title="No sessions yet"
        body="Spawn a pi session to see it here."
        action={{ label: "Spawn session", onClick }}
      />,
    );
    expect(getByText("No sessions yet")).toBeDefined();
    expect(getByText("Spawn a pi session to see it here.")).toBeDefined();
    const primaries = container.querySelectorAll('[data-empty-state-action="primary"]');
    expect(primaries).toHaveLength(1);
    fireEvent.click(getAllByRole("button")[0]);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("allows at most one primary action (single `action` prop)", () => {
    const { container } = render(
      <EmptyState
        title="Empty"
        action={{ label: "Primary", onClick: () => {} }}
        secondaryAction={{ label: "Escape", onClick: () => {} }}
      />,
    );
    // The contract: exactly one primary, at most one secondary — never >1 primary.
    expect(container.querySelectorAll('[data-empty-state-action="primary"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-empty-state-action="secondary"]')).toHaveLength(1);
  });

  it("renders without any actions", () => {
    const { container, getByText } = render(<EmptyState title="Nothing here" />);
    expect(getByText("Nothing here")).toBeDefined();
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
