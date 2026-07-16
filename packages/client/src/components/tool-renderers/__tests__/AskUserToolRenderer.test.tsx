import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { AskUserToolRenderer } from "../AskUserToolRenderer.js";
import { ThemeProvider } from "../../ThemeProvider.js";
import type { ToolContext } from "../types.js";

afterEach(cleanup);

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches: q === "(prefers-color-scheme: dark)",
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

const ctx: ToolContext = { cwd: "/r" };

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const questions = [
  { method: "input", title: "Project name" },
  { method: "select", title: "Language", options: ["TypeScript", "Go"] },
  { method: "confirm", title: "Init git?" },
  { method: "multiselect", title: "Tooling", options: ["ESLint", "Prettier", "Vitest"] },
];

describe("AskUserToolRenderer — batch", () => {
  it("renders every sub-question title and answer on reload (from toolDetails.results)", () => {
    renderWithTheme(
      <AskUserToolRenderer
        toolName="ask_user"
        args={{ method: "batch", title: "Project setup", questions }}
        status="complete"
        result={'User completed batch (4 answers).'}
        toolDetails={{
          method: "batch",
          cancelled: false,
          results: ["pi-plugin", "TypeScript", true, ["ESLint", "Vitest"]],
        }}
        context={ctx}
      />,
    );

    // All sub-question titles render.
    expect(screen.getByText("Project name")).toBeTruthy();
    expect(screen.getByText("Language")).toBeTruthy();
    expect(screen.getByText("Init git?")).toBeTruthy();
    expect(screen.getByText("Tooling")).toBeTruthy();

    // All answers render.
    expect(screen.getByText("pi-plugin")).toBeTruthy();
    expect(screen.getByText("TypeScript")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
    expect(screen.getByText("ESLint")).toBeTruthy();
    expect(screen.getByText("Vitest")).toBeTruthy();
  });

  it("shows a cancelled marker when the batch was cancelled", () => {
    renderWithTheme(
      <AskUserToolRenderer
        toolName="ask_user"
        args={{ method: "batch", title: "Project setup", questions }}
        status="complete"
        result={'User cancelled batch (0 of 4 answers submitted).'}
        toolDetails={{ method: "batch", cancelled: true, results: [] }}
        context={ctx}
      />,
    );
    expect(screen.getByText(/cancelled/i)).toBeTruthy();
  });
});
