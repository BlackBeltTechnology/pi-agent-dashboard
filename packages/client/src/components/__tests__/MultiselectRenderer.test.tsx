import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { MultiselectRenderer } from "../interactive-renderers/MultiselectRenderer.js";
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
  method: "multiselect",
  params: { title: "Pick files", options: ["a.ts", "b.ts", "c.ts"] },
};

describe("MultiselectRenderer", () => {
  describe("pending state", () => {
    it("renders title and checkboxes for each option", () => {
      render(
        <MultiselectRenderer
          {...baseProps}
          status="pending"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("Pick files")).toBeTruthy();
      expect(screen.getByText("a.ts")).toBeTruthy();
      expect(screen.getByText("b.ts")).toBeTruthy();
      expect(screen.getByText("c.ts")).toBeTruthy();
      // 3 real options + 1 synthetic "Select all" row = 4 checkboxes
      expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    });

    it("renders Submit and Cancel buttons", () => {
      render(
        <MultiselectRenderer
          {...baseProps}
          status="pending"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("Submit")).toBeTruthy();
      expect(screen.getByText("Cancel")).toBeTruthy();
    });
  });

  describe("toggle + submit", () => {
    it("submits selected values when clicking Submit", () => {
      const onRespond = vi.fn();
      render(
        <MultiselectRenderer
          {...baseProps}
          status="pending"
          onRespond={onRespond}
          onCancel={vi.fn()}
        />,
      );

      // Index 0 is the synthetic "Select all" row; real options start at 1.
      const checkboxes = screen.getAllByRole("checkbox");
      fireEvent.click(checkboxes[1]); // a.ts
      fireEvent.click(checkboxes[3]); // c.ts

      fireEvent.click(screen.getByText("Submit (2)"));

      expect(onRespond).toHaveBeenCalledWith({ values: ["a.ts", "c.ts"] });
    });

    it("submits empty array when nothing selected", () => {
      const onRespond = vi.fn();
      render(
        <MultiselectRenderer
          {...baseProps}
          status="pending"
          onRespond={onRespond}
          onCancel={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByText("Submit"));

      expect(onRespond).toHaveBeenCalledWith({ values: [] });
    });
  });

  describe("cancel", () => {
    it("calls onCancel when clicking Cancel", () => {
      const onCancel = vi.fn();
      render(
        <MultiselectRenderer
          {...baseProps}
          status="pending"
          onRespond={vi.fn()}
          onCancel={onCancel}
        />,
      );

      fireEvent.click(screen.getByText("Cancel"));

      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe("resolved state", () => {
    it("keeps the full option list with selected + unselected both shown", () => {
      render(
        <MultiselectRenderer
          {...baseProps}
          status="resolved"
          result={{ values: ["a.ts", "c.ts"] }}
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      // All three options remain visible (not collapsed to just the picks).
      expect(screen.getByText("a.ts")).toBeTruthy();
      expect(screen.getByText("b.ts")).toBeTruthy();
      expect(screen.getByText("c.ts")).toBeTruthy();
      // Count summary present.
      expect(screen.getByText(/2 of 3/)).toBeTruthy();
    });

    it("shows a 0 of N count when nothing selected", () => {
      render(
        <MultiselectRenderer
          {...baseProps}
          status="resolved"
          result={{ values: [] }}
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText(/0 of 3/)).toBeTruthy();
      // Options still listed.
      expect(screen.getByText("a.ts")).toBeTruthy();
    });
  });

  describe("cancelled state", () => {
    it("displays Cancelled label", () => {
      render(
        <MultiselectRenderer
          {...baseProps}
          status="cancelled"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("Cancelled")).toBeTruthy();
    });
  });

  describe("select all synthetic row", () => {
    it("renders 'Select all' row when options are non-empty and dialog is pending", () => {
      render(
        <MultiselectRenderer
          {...baseProps}
          status="pending"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByText("Select all")).toBeTruthy();
      expect(screen.getByTestId("select-all-row")).toBeTruthy();
      // 3 real + 1 synthetic = 4 checkboxes
      expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    });

    it("clicking 'Select all' when nothing is checked checks all options", () => {
      const onRespond = vi.fn();
      render(
        <MultiselectRenderer
          {...baseProps}
          status="pending"
          onRespond={onRespond}
          onCancel={vi.fn()}
        />,
      );
      const selectAllRow = screen.getByTestId("select-all-row");
      const selectAllCheckbox = selectAllRow.querySelector("input") as HTMLInputElement;
      fireEvent.click(selectAllCheckbox);
      fireEvent.click(screen.getByText("Submit (3)"));
      expect(onRespond).toHaveBeenCalledWith({ values: ["a.ts", "b.ts", "c.ts"] });
    });

    it("clicking 'Select all' when all are checked clears all", () => {
      const onRespond = vi.fn();
      render(
        <MultiselectRenderer
          {...baseProps}
          status="pending"
          onRespond={onRespond}
          onCancel={vi.fn()}
        />,
      );
      // Check all 3 real options
      const checkboxes = screen.getAllByRole("checkbox");
      fireEvent.click(checkboxes[1]); // a.ts (index 0 is Select all)
      fireEvent.click(checkboxes[2]); // b.ts
      fireEvent.click(checkboxes[3]); // c.ts
      // All checked → click Select all to clear
      fireEvent.click(checkboxes[0]);
      fireEvent.click(screen.getByText("Submit"));
      expect(onRespond).toHaveBeenCalledWith({ values: [] });
    });

    it("'Select all' never appears in returned values", () => {
      const onRespond = vi.fn();
      render(
        <MultiselectRenderer
          {...baseProps}
          status="pending"
          onRespond={onRespond}
          onCancel={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId("select-all-row").querySelector("input")!);
      fireEvent.click(screen.getByText("Submit (3)"));
      const values = (onRespond.mock.calls[0][0] as { values: string[] }).values;
      expect(values).not.toContain("Select all");
    });

    it("hides 'Select all' row when options array is empty", () => {
      render(
        <MultiselectRenderer
          requestId="req-empty"
          method="multiselect"
          params={{ title: "Nothing", options: [] }}
          status="pending"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.queryByText("Select all")).toBeNull();
      expect(screen.queryByTestId("select-all-row")).toBeNull();
    });
  });
});

describe("MultiselectRenderer — resolved shows message body (change: fix-ask-user-card-duplication)", () => {
  const MSG = "Choose all that apply.";
  it("renders params.message in the resolved state", () => {
    render(
      <ThemeProvider>
        <MultiselectRenderer
        requestId="r" method="multiselect"
        params={{ title: "Pick files", options: ["a.ts", "b.ts"], message: MSG }}
        status="resolved" result={{ values: ["a.ts"] }}
        onRespond={vi.fn()} onCancel={vi.fn()}
      />
      </ThemeProvider>,
    );
    expect(screen.getByText(MSG)).toBeTruthy();
  });
  it("renders no message body when params.message is absent", () => {
    render(
      <ThemeProvider>
        <MultiselectRenderer
        requestId="r" method="multiselect"
        params={{ title: "Pick files", options: ["a.ts", "b.ts"] }}
        status="resolved" result={{ values: ["a.ts"] }}
        onRespond={vi.fn()} onCancel={vi.fn()}
      />
      </ThemeProvider>,
    );
    expect(screen.queryByText(MSG)).toBeNull();
  });
});
