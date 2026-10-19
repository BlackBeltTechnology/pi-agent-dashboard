import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
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

  it("F4: Other row appears only for an opted-in prompt without its own Other option", () => {
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
    m = mount({ title: "T", options: ["Approve", "Other (describe)"], allowOther: true });
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
