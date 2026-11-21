import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PROMPT_DRAFT_DEBOUNCE_MS, resetPromptDraftMemory, setPromptDraft } from "../../lib/state/prompt-draft-storage.js";
import { SelectRenderer } from "../interactive-renderers/SelectRenderer.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

afterEach(cleanup);

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

const baseProps = {
  requestId: "req-1",
  method: "select",
  params: { title: "Primary language?", options: ["TypeScript", "Python", "Go"] },
};

describe("SelectRenderer", () => {
  describe("pending state", () => {
    it("renders one full-width row per option", () => {
      render(<SelectRenderer {...baseProps} status="pending" onRespond={vi.fn()} onCancel={vi.fn()} />);
      // 3 options + 1 synthetic Cancel row = 4 buttons.
      expect(screen.getAllByRole("button")).toHaveLength(4);
      expect(screen.getByText("TypeScript")).toBeTruthy();
      expect(screen.getByText("Python")).toBeTruthy();
      expect(screen.getByText("Go")).toBeTruthy();
      expect(screen.getByText("Cancel")).toBeTruthy();
    });

    it("responds with the chosen option value", () => {
      const onRespond = vi.fn();
      render(<SelectRenderer {...baseProps} status="pending" onRespond={onRespond} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByText("Python"));
      expect(onRespond).toHaveBeenCalledWith({ value: "Python" });
    });

    it("splits an option into title + dimmed description on ' — '", () => {
      render(
        <SelectRenderer
          requestId="r"
          method="select"
          params={{ title: "Pick", options: ["Design 1 — lean one-line hook"] }}
          status="pending"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByText("Design 1")).toBeTruthy();
      expect(screen.getByText("lean one-line hook")).toBeTruthy();
    });

    it("synthetic Cancel row triggers onCancel", () => {
      const onCancel = vi.fn();
      render(<SelectRenderer {...baseProps} status="pending" onRespond={vi.fn()} onCancel={onCancel} />);
      fireEvent.click(screen.getByText("Cancel"));
      expect(onCancel).toHaveBeenCalled();
    });

    it("inline Cancel option calls onCancel (not onRespond) and suppresses synthetic Cancel row", () => {
      const onRespond = vi.fn();
      const onCancel = vi.fn();
      render(
        <SelectRenderer
          requestId="r"
          method="select"
          params={{ title: "Pick", options: ["Alpha", "Beta", "Cancel"] }}
          status="pending"
          onRespond={onRespond}
          onCancel={onCancel}
        />,
      );
      // Only ONE Cancel row (the inline option), not a synthetic duplicate.
      expect(screen.getAllByText("Cancel")).toHaveLength(1);
      fireEvent.click(screen.getByText("Cancel"));
      expect(onCancel).toHaveBeenCalled();
      expect(onRespond).not.toHaveBeenCalled();
    });
  });

  describe("resolved state", () => {
    it("keeps the full option list with the chosen option highlighted", () => {
      render(
        <SelectRenderer
          {...baseProps}
          status="resolved"
          result={{ value: "TypeScript" }}
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      // All three options remain visible (not collapsed to just the pick).
      expect(screen.getByText("TypeScript")).toBeTruthy();
      expect(screen.getByText("Python")).toBeTruthy();
      expect(screen.getByText("Go")).toBeTruthy();
    });

    it("renders all options with no +N more for a 10-option list", () => {
      const opts = Array.from({ length: 10 }, (_, i) => `model-${i}`);
      render(
        <SelectRenderer
          requestId="r"
          method="select"
          params={{ title: "Pick a base model", options: opts }}
          status="resolved"
          result={{ value: "model-3" }}
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      for (const o of opts) expect(screen.getByText(o)).toBeTruthy();
      expect(screen.queryByText(/\+\d+ more/)).toBeNull();
    });
  });

  describe("cancelled state", () => {
    it("displays Cancelled label", () => {
      render(<SelectRenderer {...baseProps} status="cancelled" onRespond={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("Cancelled")).toBeTruthy();
    });
  });
});

describe("SelectRenderer — resolved shows message body (change: fix-ask-user-card-duplication)", () => {
  const MSG = "Pick the primary one.";
  it("renders params.message in the resolved state", () => {
    render(
      <ThemeProvider>
        <SelectRenderer
        requestId="r" method="select"
        params={{ title: "Primary language?", options: ["TypeScript", "Python"], message: MSG }}
        status="resolved" result={{ value: "TypeScript" }}
        onRespond={vi.fn()} onCancel={vi.fn()}
      />
      </ThemeProvider>,
    );
    expect(screen.getByText(MSG)).toBeTruthy();
  });
  it("renders no message body when params.message is absent", () => {
    render(
      <ThemeProvider>
        <SelectRenderer
        requestId="r" method="select"
        params={{ title: "Primary language?", options: ["TypeScript", "Python"] }}
        status="resolved" result={{ value: "TypeScript" }}
        onRespond={vi.fn()} onCancel={vi.fn()}
      />
      </ThemeProvider>,
    );
    expect(screen.queryByText(MSG)).toBeNull();
  });
});

// ── Inline Other — test-plan #F1..#F5. See change: add-ask-user-inline-other ──
describe("SelectRenderer inline Other", () => {
  const optedProps = {
    requestId: "req-o",
    method: "select",
    params: { title: "Pick", options: ["A", "B"], allowOther: true },
  };
  const row = () => screen.getByRole("button", { name: "Other" });

  it("F1: click Other focuses the field; Enter responds with the trimmed text once", () => {
    const onRespond = vi.fn();
    render(<SelectRenderer {...optedProps} status="pending" onRespond={onRespond} onCancel={vi.fn()} />);
    fireEvent.click(row());
    const input = screen.getByRole("textbox", { name: "Other answer" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "  something else  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith({ value: "something else" });
  });

  it("F2: empty / whitespace text keeps Submit disabled and Enter inert", () => {
    const onRespond = vi.fn();
    render(<SelectRenderer {...optedProps} status="pending" onRespond={onRespond} onCancel={vi.fn()} />);
    fireEvent.click(row());
    const input = screen.getByRole("textbox", { name: "Other answer" });
    const submit = screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "   " } });
    expect(submit.disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("F3: keyboard — Space opens, Escape collapses and is consumed", () => {
    const onRespond = vi.fn();
    render(<SelectRenderer {...optedProps} status="pending" onRespond={onRespond} onCancel={vi.fn()} />);
    const r = row();
    r.focus();
    fireEvent.click(r); // keyboard activation of a button dispatches click
    const input = screen.getByRole("textbox", { name: "Other answer" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "typed" } });
    const notPrevented = fireEvent.keyDown(input, { key: "Escape" });
    expect(notPrevented).toBe(false); // preventDefault() was called
    expect(screen.queryByRole("textbox", { name: "Other answer" })).toBeNull();
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("F4: Other row appears only for an opted-in prompt", () => {
    const mount = (params: Record<string, unknown>) => {
      const onRespond = vi.fn();
      const { unmount } = render(
        <SelectRenderer requestId="r" method="select" params={params} status="pending" onRespond={onRespond} onCancel={vi.fn()} />,
      );
      const has = !!screen.queryByTestId("other-option");
      return { has, onRespond, unmount };
    };
    let m = mount({ title: "T", options: ["A", "B"] });
    expect(m.has).toBe(false);
    m.unmount();
    m = mount({ title: "T", options: ["A", "B"], allowOther: false });
    expect(m.has).toBe(false);
    m.unmount();
    // A non-opted-in prompt keeps its own Other as a normal option (S19, #1116).
    m = mount({ title: "T", options: ["Approve", "Other (describe)"] });
    expect(m.has).toBe(false);
    fireEvent.click(screen.getByText("Other (describe)"));
    expect(m.onRespond).toHaveBeenCalledWith({ value: "Other (describe)" });
    m.unmount();
    m = mount({ title: "T", options: ["A", "B"], allowOther: true });
    expect(m.has).toBe(true);
    fireEvent.click(screen.getByText("A"));
    expect(m.onRespond).toHaveBeenCalledWith({ value: "A" });
  });

  it("F5: resolved custom answer shows a picked Other row as plain text", () => {
    const { unmount } = render(
      <SelectRenderer requestId="r" method="select" params={{ title: "T", options: ["A", "B"] }} status="resolved" result={{ value: "C" }} onRespond={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByTestId("answered-other-text").textContent).toBe("C");
    expect(screen.getByText("Other")).toBeTruthy();
    unmount();
    render(
      <SelectRenderer requestId="r" method="select" params={{ title: "T", options: ["A", "B"] }} status="resolved" result={{ value: "<b>x</b> **y**" }} onRespond={vi.fn()} onCancel={vi.fn()} />,
    );
    const cell = screen.getByTestId("answered-other-text");
    expect(cell.textContent).toBe("<b>x</b> **y**");
    expect(cell.querySelector("b, strong")).toBeNull();
  });

  it("F5b: a resolved option answer shows no Other row", () => {
    render(
      <SelectRenderer requestId="r" method="select" params={{ title: "T", options: ["A", "B"] }} status="resolved" result={{ value: "A" }} onRespond={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByTestId("answered-other-text")).toBeNull();
  });

  it("X2: non-string options do not throw", () => {
    expect(() =>
      render(
        <SelectRenderer requestId="r" method="select" params={{ title: "T", options: [1, "A"] as unknown as string[], allowOther: true }} status="pending" onRespond={vi.fn()} onCancel={vi.fn()} />,
      ),
    ).not.toThrow();
  });
});

// ── #1116 own Other collapses into the inline row. See change: fix-input-state-consistency ──
describe("SelectRenderer own Other (#1116)", () => {
  const mountWith = (params: Record<string, unknown>, onRespond = vi.fn()) => {
    render(<SelectRenderer requestId="r" method="select" params={params} status="pending" onRespond={onRespond} onCancel={vi.fn()} />);
    return onRespond;
  };

  it("S18: opted-in own Other is hidden; the inline row's typed text answers", () => {
    const onRespond = mountWith({ title: "T", options: ["Approve", "Other (describe)"], allowOther: true });
    expect(screen.queryByText("Other (describe)")).toBeNull();
    // listed buttons: Approve + inline Other + (synthetic) Cancel
    expect(screen.getByText("Approve")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Other answer" }), { target: { value: "later" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith({ value: "later" });
  });

  it("S19: a non-opted-in prompt keeps its own Other as a normal option", () => {
    const onRespond = mountWith({ title: "T", options: ["Approve", "Other (describe)"] });
    expect(screen.queryByTestId("other-option")).toBeNull();
    expect(screen.getByText("Approve")).toBeTruthy();
    fireEvent.click(screen.getByText("Other (describe)"));
    expect(onRespond).toHaveBeenCalledWith({ value: "Other (describe)" });
  });

  it("S22: only an own Other listed -> only the inline row renders", () => {
    mountWith({ title: "T", options: ["Other"], allowOther: true });
    expect(screen.getByTestId("other-option")).toBeTruthy();
    // No listed option button besides the inline row's own button and Cancel.
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names.filter((n) => n === "Other")).toHaveLength(1);
  });

  it("S23: non-string options never count as an own Other", () => {
    mountWith({ title: "T", options: ["A", 42, null] as unknown as string[], allowOther: true });
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByTestId("other-option")).toBeTruthy();
  });
});

// ── #1117 prompt draft persistence. See change: fix-input-state-consistency ──
describe("SelectRenderer draft persistence (#1117)", () => {
  const props = (params: Record<string, unknown> = { title: "Pick", options: ["A", "B"], allowOther: true }) => ({
    requestId: "p1",
    sessionId: "A",
    method: "select",
    params,
    status: "pending" as const,
    onRespond: vi.fn(),
    onCancel: vi.fn(),
  });
  afterEach(() => {
    sessionStorage.clear();
    resetPromptDraftMemory();
  });

  it("S41: Other text survives an unmount/remount with the same ids", () => {
    const first = render(<SelectRenderer {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Other answer" }), { target: { value: "foo" } });
    first.unmount();
    render(<SelectRenderer {...props()} />);
    expect((screen.getByRole("textbox", { name: "Other answer" }) as HTMLInputElement).value).toBe("foo");
  });

  it("S33: a restored Other row is ignored when the prompt no longer opts in", () => {
    setPromptDraft("A", "p1", { otherActive: true, otherText: "x" });
    const onRespond = vi.fn();
    render(<SelectRenderer {...props({ title: "Pick", options: ["A", "B"] })} onRespond={onRespond} />);
    expect(screen.queryByTestId("other-option")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Other answer" })).toBeNull();
    fireEvent.click(screen.getByText("A"));
    expect(onRespond).toHaveBeenCalledWith({ value: "A" });
  });

  it("a corrupt draft shape is discarded and the renderer starts empty", () => {
    setPromptDraft("A", "p1", { otherActive: "yes" });
    render(<SelectRenderer {...props()} />);
    expect(screen.queryByRole("textbox", { name: "Other answer" })).toBeNull();
    expect(sessionStorage.getItem("ask-draft:A:p1")).toBeNull();
  });

  it("the draft is mirrored only after the debounce", () => {
    vi.useFakeTimers();
    try {
      render(<SelectRenderer {...props()} />);
      fireEvent.click(screen.getByRole("button", { name: "Other" }));
      expect(sessionStorage.getItem("ask-draft:A:p1")).toBeNull();
      vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS);
      expect(sessionStorage.getItem("ask-draft:A:p1")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
