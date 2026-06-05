import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { BatchRenderer } from "../interactive-renderers/BatchRenderer.js";

afterEach(cleanup);

const questions = [
  { method: "input", title: "Project name" },
  { method: "select", title: "Language", options: ["TypeScript", "Go"] },
  { method: "multiselect", title: "Tooling", options: ["ESLint", "Prettier", "Vitest"] },
];

const baseProps = {
  requestId: "req-1",
  method: "batch",
  params: { title: "Project setup", questions },
};

function renderPending(onRespond = vi.fn(), onCancel = vi.fn()) {
  render(<BatchRenderer {...baseProps} status="pending" onRespond={onRespond} onCancel={onCancel} />);
  return { onRespond, onCancel };
}

describe("BatchRenderer", () => {
  it("shows one question per page with a step count", () => {
    renderPending();
    expect(screen.getByText("Question 1 of 3")).toBeTruthy();
    // First step is the input question — its field is present.
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("Back preserves the previously entered answer", () => {
    renderPending();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "pi-plugin" } });
    fireEvent.click(screen.getByText("Next →"));
    // Now on step 2 (select).
    expect(screen.getByText("Question 2 of 3")).toBeTruthy();
    fireEvent.click(screen.getByText("← Back"));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("pi-plugin");
  });

  it("withholds answers until Review submit, then sends one {answers} response", () => {
    const { onRespond } = renderPending();
    // Step 1: input
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "pi-plugin" } });
    fireEvent.click(screen.getByText("Next →"));
    // Step 2: select
    fireEvent.click(screen.getByText("TypeScript"));
    fireEvent.click(screen.getByText("Next →"));
    // Step 3: multiselect — pick two
    fireEvent.click(screen.getByText("ESLint"));
    fireEvent.click(screen.getByText("Vitest"));
    fireEvent.click(screen.getByText("Next →"));
    // Review page — nothing sent yet.
    expect(onRespond).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Submit all 3/));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith({
      answers: [
        { value: "pi-plugin" },
        { value: "TypeScript" },
        { values: ["ESLint", "Vitest"] },
      ],
    });
  });

  it("Edit from review returns to that step preserving other answers", () => {
    const { onRespond } = renderPending();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "pi-plugin" } });
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Go"));
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Prettier"));
    fireEvent.click(screen.getByText("Next →"));
    // On review — edit step 1.
    const editButtons = screen.getAllByText("Edit");
    fireEvent.click(editButtons[0]);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("pi-plugin");
    // Jump back to review via stepper and submit — other answers intact.
    fireEvent.click(screen.getByText("Next →")); // step 2
    fireEvent.click(screen.getByText("Next →")); // step 3
    fireEvent.click(screen.getByText("Next →")); // review
    fireEvent.click(screen.getByText(/Submit all 3/));
    expect(onRespond).toHaveBeenCalledWith({
      answers: [{ value: "pi-plugin" }, { value: "Go" }, { values: ["Prettier"] }],
    });
  });

  it("Cancel on the first step calls onCancel", () => {
    const { onCancel } = renderPending();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("resolved state shows a read-only Q→A summary with no Next/Submit", () => {
    render(
      <BatchRenderer
        {...baseProps}
        status="resolved"
        result={{
          answers: [
            { value: "pi-plugin" },
            { value: "TypeScript" },
            { values: ["ESLint", "Vitest"] },
          ],
        }}
        onRespond={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("pi-plugin")).toBeTruthy();
    expect(screen.getByText("TypeScript")).toBeTruthy();
    // Multiselect answers render as pills.
    expect(screen.getByText("ESLint")).toBeTruthy();
    expect(screen.getByText("Vitest")).toBeTruthy();
    // No interactive controls.
    expect(screen.queryByText("Next →")).toBeNull();
    expect(screen.queryByText(/Submit all/)).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull();
  });
});
