/**
 * SpreadsheetPreview: grid + tabs + active-sheet switching + fallback.
 * See change: render-office-previews (test-plan #22, #23).
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { SpreadsheetPreview } from "../SpreadsheetPreview.js";

const target = { kind: "file" as const, cwd: "/proj", path: "book.xlsx" };

function mockFetch(body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({ json: async () => body }) as any;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SpreadsheetPreview", () => {
  it("renders grid + tabs and switches the active sheet within loaded data (test-plan #22)", async () => {
    mockFetch({
      success: true,
      data: {
        activeSheet: 0,
        sheets: [
          { name: "Alpha", header: ["a"], rows: [["alpha-row"]], totalRows: 1, totalCols: 1, truncated: false },
          { name: "Beta", header: ["b"], rows: [["beta-row"]], totalRows: 1, totalCols: 1, truncated: false },
        ],
      },
    });
    render(<SpreadsheetPreview target={target} />);
    await waitFor(() => expect(screen.getByTestId("sheet-grid")).toBeTruthy());
    // Two tabs; Alpha's data visible first.
    const tabs = screen.getAllByTestId("sheet-tab");
    expect(tabs.length).toBe(2);
    expect(screen.getByText("alpha-row")).toBeTruthy();
    // Switch to Beta → its row renders (client-only, no refetch).
    fireEvent.click(screen.getByText("Beta"));
    await waitFor(() => expect(screen.getByText("beta-row")).toBeTruthy());
  });

  it("shows a charset pill + banner for a csv payload", async () => {
    mockFetch({
      success: true,
      data: {
        activeSheet: 0,
        encoding: "ISO-8859-2",
        sheets: [
          { name: "Sheet1", header: ["nev"], rows: [["Árvíztűrő"]], totalRows: 40, totalCols: 1, truncated: true },
        ],
      },
    });
    render(<SpreadsheetPreview target={{ ...target, path: "hu.csv" }} />);
    await waitFor(() => expect(screen.getByTestId("charset-pill")).toBeTruthy());
    expect(screen.getByTestId("charset-pill").textContent).toBe("ISO-8859-2");
  });

  it("{success:false} → FallbackPreview download card (test-plan #23)", async () => {
    mockFetch({ success: false, error: "password protected" });
    render(<SpreadsheetPreview target={target} />);
    await waitFor(() => {
      const link = document.querySelector("a[download]");
      expect(link).toBeTruthy();
      expect(link?.getAttribute("href")).toContain("/api/file/raw");
    });
  });
});
