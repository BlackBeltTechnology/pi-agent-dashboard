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
