import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

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
import { ThemeProvider } from "../ThemeProvider.js";
import { ReadToolRenderer } from "../tool-renderers/ReadToolRenderer.js";
import { WriteToolRenderer } from "../tool-renderers/WriteToolRenderer.js";
import { BashToolRenderer } from "../tool-renderers/BashToolRenderer.js";
import type { ToolContext } from "../tool-renderers/types.js";

// Mock SyntaxHighlighter to capture props
vi.mock("react-syntax-highlighter", () => ({
  Prism: (props: Record<string, unknown>) => (
    <div data-testid="syntax-highlighter" data-custom-style={JSON.stringify(props.customStyle)}>
      {props.children as React.ReactNode}
    </div>
  ),
}));

const ctx: ToolContext = {};

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("ReadToolRenderer theme integration", () => {
  it("passes background var(--bg-code) via customStyle", () => {
    const { getByTestId } = renderWithTheme(
      <ReadToolRenderer
        toolName="read"
        args={{ path: "test.ts" }}
        status="complete"
        result="const x = 1;"
        context={ctx}
      />,
    );
    const highlighter = getByTestId("syntax-highlighter");
    const customStyle = JSON.parse(highlighter.getAttribute("data-custom-style")!);
    expect(customStyle.background).toBe("var(--bg-code)");
  });
});

describe("WriteToolRenderer theme integration", () => {
  it("passes background var(--bg-code) via customStyle", () => {
    const { getAllByTestId } = renderWithTheme(
      <WriteToolRenderer
        toolName="write"
        args={{ path: "test.ts", content: "const x = 1;" }}
        status="complete"
        context={ctx}
      />,
    );
    const highlighters = getAllByTestId("syntax-highlighter");
    const customStyle = JSON.parse(highlighters[0].getAttribute("data-custom-style")!);
    expect(customStyle.background).toBe("var(--bg-code)");
  });
});

describe("BashToolRenderer theme integration", () => {
  it("uses var(--accent-green) for the $ prompt", () => {
    const { container } = renderWithTheme(
      <BashToolRenderer
        toolName="bash"
        args={{ command: "ls" }}
        status="complete"
        result="file.ts"
        context={ctx}
      />,
    );
    const prompt = container.querySelector("span.font-mono");
    expect(prompt?.textContent).toBe("$");
    expect(prompt?.className).toContain("text-[var(--accent-green)]");
  });
});
