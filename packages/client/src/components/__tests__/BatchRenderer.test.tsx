import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROMPT_DRAFT_KEY_PREFIX, resetPromptDraftMemory } from "../../lib/state/prompt-draft-storage.js";
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

// ── Inline Other — test-plan #F8. See change: add-ask-user-inline-other ──
describe("BatchRenderer inline Other", () => {
  const qs = [
    { method: "select", title: "S0", options: ["A", "B"], allowOther: true },
    { method: "multiselect", title: "M1", options: ["A", "B"], allowOther: true },
    { method: "select", title: "S2", options: ["A", "B"] },
    { method: "confirm", title: "C3" },
    { method: "input", title: "I4" },
  ];
  const mount = (onRespond = vi.fn()) => {
    render(<BatchRenderer requestId="r" method="batch" params={{ title: "T", questions: qs }} status="pending" onRespond={onRespond} onCancel={vi.fn()} />);
    return onRespond;
  };
  const next = () => screen.getByText("Next →") as HTMLButtonElement;

  it("keeps the draft across Back/Next, gates Next, skips non-opted steps, submits plain values", () => {
    const onRespond = mount();
    // Step 0: Other empty blocks Next.
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    expect(next().disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Other answer" }), { target: { value: "C" } });
    expect(next().disabled).toBe(false);
    fireEvent.click(next());
    // Step 1: multiselect A + Other D; Other empty blocks Next.
    fireEvent.click(screen.getByRole("checkbox", { name: "A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Other" }));
    expect(next().disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Other answer" }), { target: { value: "D" } });
    expect(next().disabled).toBe(false);
    // Back to step 0: draft intact.
    fireEvent.click(screen.getByText("← Back"));
    expect((screen.getByRole("textbox", { name: "Other answer" }) as HTMLInputElement).value).toBe("C");
    fireEvent.click(next());
    expect((screen.getByRole("textbox", { name: "Other answer" }) as HTMLInputElement).value).toBe("D");
    fireEvent.click(next());
    // Step 2 (non-opted select): no Other row.
    expect(screen.queryByTestId("other-option")).toBeNull();
    fireEvent.click(screen.getByText("A"));
    fireEvent.click(next());
    // Step 3 confirm
    expect(screen.queryByTestId("other-option")).toBeNull();
    fireEvent.click(screen.getByText("Yes"));
    fireEvent.click(next());
    // Step 4 input
    expect(screen.queryByTestId("other-option")).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "free" } });
    fireEvent.click(next());
    // Review shows the custom values; submit.
    expect(screen.getByText("C")).toBeTruthy();
    expect(screen.getByText("D")).toBeTruthy();
    fireEvent.click(screen.getByText(/Submit all/));
    expect(onRespond).toHaveBeenCalledWith({
      answers: [{ value: "C" }, { values: ["A", "D"] }, { value: "A" }, { confirmed: true }, { value: "free", images: undefined }],
    });
  });

  it("picking an option after Other drops the custom text answer", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Other answer" }), { target: { value: "C" } });
    fireEvent.click(screen.getByText("B"));
    expect(screen.queryByRole("textbox", { name: "Other answer" })).toBeNull();
    expect(next().disabled).toBe(false);
  });
});

// ── #1116 own Other collapses into the inline row. See change: fix-input-state-consistency ──
describe("BatchRenderer own Other (#1116)", () => {
  const qs = [
    { method: "select", title: "S0", options: ["X", "Other"], allowOther: true },
    { method: "multiselect", title: "M1", options: ["A", "B", "Other: specify"], allowOther: true },
  ];
  const next = () => screen.getByText("Next →") as HTMLButtonElement;

  it("S24: own Other is hidden on select and multiselect sub-questions; typed text answers", () => {
    const onRespond = vi.fn();
    render(<BatchRenderer requestId="r" method="batch" params={{ title: "T", questions: qs }} status="pending" onRespond={onRespond} onCancel={vi.fn()} />);
    // Step 0: only X + the inline Other (the caller's own "Other" is not a second button).
    expect(screen.getAllByRole("button", { name: "Other" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Other answer" }), { target: { value: "C" } });
    fireEvent.click(next());
    // Step 1: A, B listed; "Other: specify" hidden; inline row present.
    expect(screen.queryByRole("checkbox", { name: "Other: specify" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "A" }));
    fireEvent.click(next());
    fireEvent.click(screen.getByText(/Submit all/));
    expect(onRespond).toHaveBeenCalledWith({ answers: [{ value: "C" }, { values: ["A"] }] });
  });
});

// ── #1117 prompt draft persistence. See change: fix-input-state-consistency ──
describe("BatchRenderer draft persistence (#1117)", () => {
  afterEach(() => {
    sessionStorage.clear();
    resetPromptDraftMemory();
  });
  const qs = [
    { method: "input", title: "One" },
    { method: "select", title: "Two", options: ["red", "blue"], allowOther: true },
    { method: "input", title: "Three" },
  ];
  const mount = (questions: unknown[] = qs, onRespond = vi.fn()) =>
    render(<BatchRenderer requestId="p1" sessionId="A" method="batch" params={{ title: "T", questions }} status="pending" onRespond={onRespond} onCancel={vi.fn()} />);
  const next = () => screen.getByText("Next →") as HTMLButtonElement;
  const key = `${PROMPT_DRAFT_KEY_PREFIX}A:p1`;

  function fillToStepThree() {
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "alpha" } });
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Other answer" }), { target: { value: "teal" } });
    fireEvent.click(next());
  }

  it("S44: step, answers 1-2 and the Other draft are restored after unmount and after a reload", () => {
    const first = mount();
    fillToStepThree();
    expect(screen.getByText("Question 3 of 3")).toBeTruthy();
    first.unmount();
    // (a) remount: memory is current
    const second = mount();
    expect(screen.getByText("Question 3 of 3")).toBeTruthy();
    fireEvent.click(screen.getByText("← Back"));
    expect((screen.getByRole("textbox", { name: "Other answer" }) as HTMLInputElement).value).toBe("teal");
    fireEvent.click(screen.getByText("← Back"));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("alpha");
    fireEvent.click(next());
    fireEvent.click(next()); // back on step 3 before the reload
    second.unmount();
    // (b) reload: module memory gone, sessionStorage kept
    resetPromptDraftMemory();
    mount();
    expect(screen.getByText("Question 3 of 3")).toBeTruthy();
    fireEvent.click(screen.getByText("← Back"));
    expect((screen.getByRole("textbox", { name: "Other answer" }) as HTMLInputElement).value).toBe("teal");
  });

  it.each([
    ["invalid json", "{nope"],
    ["wrong version", JSON.stringify({ v: 2, savedAt: Date.now(), state: {} })],
    ["null", "null"],
    ["state not an object", JSON.stringify({ v: 1, savedAt: Date.now(), state: 7 })],
    ["step out of range", JSON.stringify({ v: 1, savedAt: Date.now(), state: { step: 9, answers: [null, null, null], otherDraft: [] } })],
    ["expired", JSON.stringify({ v: 1, savedAt: 1, state: { step: 1, answers: [null, null, null], otherDraft: [] } })],
  ])("S32: a corrupt or stale entry (%s) is discarded and the wizard starts empty", (_n, raw) => {
    sessionStorage.setItem(key, raw);
    expect(() => mount()).not.toThrow();
    expect(screen.getByText("Question 1 of 3")).toBeTruthy();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("S34: a draft for a prompt whose shape changed (3 answers → 2 questions) is discarded; wizard on step 1", () => {
    const first = mount();
    fillToStepThree();
    first.unmount();
    mount(qs.slice(0, 2));
    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("the mirror holds answers without an images field", () => {
    const first = mount();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "with img" } });
    first.unmount();
    const stored = sessionStorage.getItem(key) ?? "";
    expect(stored).toContain("with img");
    expect(stored).not.toContain("images");
  });
});
