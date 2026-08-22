import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { AskUserToolRenderer } from "../AskUserToolRenderer.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
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

/**
 * #F4 (repair-tool-error-surfaces) — the ask_user error line: the icon carries
 * the severity accent, the message stays in normal text colours, and the old
 * `text-red-400/80` literal must not return.
 */
describe("AskUserToolRenderer — error line severity tokens", () => {
  it("#F4 icon takes the accent and the message stays neutral", () => {
    const { container } = renderWithTheme(
      <AskUserToolRenderer
        toolName="ask_user"
        args={{ method: "input", title: "Project name" }}
        status="error"
        result="User cancelled the prompt."
        context={ctx}
      />,
    );
    // Scope to the error ROW (the line holding the message), not the whole card:
    // the method badge above it carries its own, ungoverned icon.
    const message = container.querySelector("pre") as HTMLElement;
    expect(message.className).toContain("text-[var(--text-secondary)]");

    const row = message.parentElement as HTMLElement;
    // @mdi/react puts the className on the <svg> itself, whose `.className` is an
    // SVGAnimatedString — read the attribute instead.
    const icon = row.querySelector("svg") as SVGElement;
    expect(icon.getAttribute("class")).toContain("text-[var(--severity-error-fg)]");
    // `innerHTML` excludes the row's OWN class attribute, so a raw red added to
    // the row itself would slip through — assert on both.
    expect(row.className).not.toMatch(/\bred-\d{2,3}\b/);
    expect(row.innerHTML).not.toMatch(/\bred-\d{2,3}\b/);
  });
});
