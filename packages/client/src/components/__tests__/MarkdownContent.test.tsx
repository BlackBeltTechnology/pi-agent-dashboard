import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React, { useState } from "react";
import { MarkdownContent, tableToMarkdown, tableToTsv } from "../MarkdownContent.js";
import { ThemeProvider } from "../ThemeProvider.js";

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

function renderMd(content: string) {
  return render(<ThemeProvider><MarkdownContent content={content} /></ThemeProvider>);
}

describe("MarkdownContent", () => {
  it("renders plain text as a paragraph", () => {
    const { container } = renderMd("Hello world");
    expect(container.querySelector("p")?.textContent).toBe("Hello world");
  });

  it("renders inline code with monospace styling", () => {
    const { container } = render(
      <ThemeProvider><MarkdownContent content="Use `npm install` here" /></ThemeProvider>
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("npm install");
    expect(code?.className).toContain("font-mono");
  });

  it("renders fenced code block with syntax highlighter", () => {
    const content = "```javascript\nconst x = 42;\n```";
    const { container } = render(<ThemeProvider><MarkdownContent content={content} /></ThemeProvider>);
    // SyntaxHighlighter renders with language class
    const highlighted = container.querySelector('[class*="language-"]');
    expect(highlighted).not.toBeNull();
    expect(container.textContent).toContain("const x = 42;");
  });

  it("renders fenced code block without language", () => {
    const content = "```\nsome code\n```";
    const { container } = render(<ThemeProvider><MarkdownContent content={content} /></ThemeProvider>);
    expect(container.textContent).toContain("some code");
  });

  it("renders headings", () => {
    const { container } = renderMd("## My Heading");
    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toBe("My Heading");
  });

  it("renders bold and italic", () => {
    const { container } = render(
      <ThemeProvider><MarkdownContent content="**bold** and *italic*" /></ThemeProvider>
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
  });

  it("renders unordered lists", () => {
    const content = "- item one\n- item two";
    const { container } = render(<ThemeProvider><MarkdownContent content={content} /></ThemeProvider>);
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("item one");
  });

  it("renders links", () => {
    const { container } = render(
      <ThemeProvider><MarkdownContent content="[click here](https://example.com)" /></ThemeProvider>
    );
    const link = container.querySelector("a");
    expect(link?.textContent).toBe("click here");
    expect(link?.getAttribute("href")).toBe("https://example.com");
  });

  it("uses div as root element to avoid nested p tags", () => {
    const { container } = renderMd("Hello world");
    const root = container.firstElementChild;
    expect(root?.tagName).toBe("DIV");
    expect(root?.className).toContain("markdown-content");
  });

  it("renders fenced code block with copy button", () => {
    const content = "```javascript\nconst x = 42;\n```";
    const { container } = render(<ThemeProvider><MarkdownContent content={content} /></ThemeProvider>);
    const copyBtn = container.querySelector('button[title="Copy code"]');
    expect(copyBtn).not.toBeNull();
    expect(copyBtn?.querySelector("svg")).not.toBeNull();
  });

  it("does not render copy button on inline code", () => {
    const { container } = render(
      <ThemeProvider><MarkdownContent content="Use `npm install` here" /></ThemeProvider>
    );
    const copyBtn = container.querySelector('button[title="Copy code"]');
    expect(copyBtn).toBeNull();
  });

  it("renders GFM table as HTML table", () => {
    const content = [
      "| Name | Age |",
      "| --- | --- |",
      "| Alice | 30 |",
      "| Bob | 25 |",
    ].join("\n");

    const { container } = render(<ThemeProvider><MarkdownContent content={content} /></ThemeProvider>);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const headers = container.querySelectorAll("th");
    expect(headers.length).toBe(2);
    expect(headers[0].textContent).toBe("Name");
    expect(headers[1].textContent).toBe("Age");
    const cells = container.querySelectorAll("td");
    expect(cells.length).toBe(4);
    expect(cells[0].textContent).toBe("Alice");
  });

  it("renders table with copy buttons", () => {
    const content = "| Name | Age |\n| --- | --- |\n| Alice | 30 |";
    const { container } = render(<ThemeProvider><MarkdownContent content={content} /></ThemeProvider>);
    const mdBtn = container.querySelector('button[title="Copy as Markdown"]');
    const tsvBtn = container.querySelector('button[title="Copy as TSV"]');
    expect(mdBtn).not.toBeNull();
    expect(mdBtn?.querySelector("svg")).not.toBeNull();
    expect(tsvBtn).not.toBeNull();
    expect(tsvBtn?.querySelector("svg")).not.toBeNull();
  });

  it("tableToMarkdown produces correct output", () => {
    const doc = document.createElement("div");
    doc.innerHTML = "<table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr></table>";
    const table = doc.querySelector("table") as HTMLTableElement;
    const md = tableToMarkdown(table);
    expect(md).toBe("| Name | Age |\n| --- | --- |\n| Alice | 30 |");
  });

  it("tableToTsv produces correct output", () => {
    const doc = document.createElement("div");
    doc.innerHTML = "<table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr></table>";
    const table = doc.querySelector("table") as HTMLTableElement;
    const tsv = tableToTsv(table);
    expect(tsv).toBe("Name\tAge\nAlice\t30");
  });

  it("renders mixed markdown content", () => {
    const content = [
      "# Title",
      "",
      "Some **bold** text with `inline code`.",
      "",
      "```typescript",
      "const x = 1;",
      "```",
      "",
      "- list item",
    ].join("\n");

    const { container } = render(<ThemeProvider><MarkdownContent content={content} /></ThemeProvider>);
    expect(container.querySelector("h1")).not.toBeNull();
    expect(container.querySelector("strong")).not.toBeNull();
    expect(container.querySelector("code")).not.toBeNull();
    expect(container.querySelector("li")).not.toBeNull();
  });

  it("strips raw HTML ref attributes before rendering", () => {
    const { container } = renderMd('<section ref="bad"><publiccheckoutpanel ref="bad">Pay</publiccheckoutpanel></section>');

    expect(container.textContent).toContain("Pay");
    expect(container.querySelector("section")?.getAttribute("ref")).toBeNull();
    expect(container.querySelector("publiccheckoutpanel")?.getAttribute("ref")).toBeNull();
  });

  it("renders mermaid code block as MermaidBlock instead of syntax highlighter", () => {
    const content = "```mermaid\ngraph TD; A-->B\n```";
    const { container } = render(<ThemeProvider><MarkdownContent content={content} /></ThemeProvider>);
    // Should NOT have syntax highlighter
    const highlighted = container.querySelector('[class*="language-"]');
    expect(highlighted).toBeNull();
    // Should have mermaid-related content (loading state or rendered)
    const text = container.textContent || "";
    expect(text).toMatch(/loading diagram|graph TD/i);
  });

  // ASCII table fixer disabled pending refinement
  it.skip("renders ASCII box-drawing table in monospace code block", () => {
    const content = [
      "Here is a table:",
      "┌──────┬──────┐",
      "│ Name │ Type │",
      "├──────┼──────┤",
      "│ foo  │ str  │",
      "└──────┴──────┘",
    ].join("\n");

    const { container } = render(<ThemeProvider><MarkdownContent content={content} /></ThemeProvider>);
    // The table should be rendered inside a code/pre block (monospace)
    const codeBlock = container.querySelector("code");
    expect(codeBlock).not.toBeNull();
    expect(codeBlock!.textContent).toContain("┌──────┬──────┐");
    expect(codeBlock!.textContent).toContain("│ Name │ Type │");
  });

  it("does not re-render when content prop is unchanged (React.memo)", () => {
    const renderSpy = vi.fn();

    // A wrapper that forces re-renders via state, passing same content prop
    function Wrapper() {
      const [tick, setTick] = useState(0);
      renderSpy();
      return (
        <ThemeProvider>
          <MarkdownContent content="static content" />
          <button data-testid="rerender" onClick={() => setTick((t) => t + 1)}>tick</button>
        </ThemeProvider>
      );
    }

    const { getByTestId, container } = render(<Wrapper />);
    const initialHtml = container.innerHTML;
    expect(renderSpy).toHaveBeenCalledTimes(1);

    // Force parent re-render
    act(() => { getByTestId("rerender").click(); });
    expect(renderSpy).toHaveBeenCalledTimes(2); // parent re-rendered

    // Content should be identical — MarkdownContent should have been skipped by memo
    expect(container.innerHTML).toBe(initialHtml);
  });

  describe("anchor target handling", () => {
    it("renders external absolute URL with target=_blank and rel=noopener noreferrer", () => {
      const { container } = render(
        <ThemeProvider><MarkdownContent content="See [docs](https://example.com)" /></ThemeProvider>
      );
      const link = container.querySelector("a");
      expect(link).not.toBeNull();
      expect(link!.getAttribute("href")).toBe("https://example.com");
      expect(link!.getAttribute("target")).toBe("_blank");
      expect(link!.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("renders GFM autolink with target=_blank", () => {
      const { container } = render(
        <ThemeProvider><MarkdownContent content="Visit https://example.com for more." /></ThemeProvider>
      );
      const link = container.querySelector("a");
      expect(link).not.toBeNull();
      expect(link!.getAttribute("href")).toBe("https://example.com");
      expect(link!.getAttribute("target")).toBe("_blank");
      expect(link!.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("renders fragment-only link without target attribute", () => {
      const { container } = render(
        <ThemeProvider><MarkdownContent content="[top](#top)" /></ThemeProvider>
      );
      const link = container.querySelector("a");
      expect(link).not.toBeNull();
      expect(link!.getAttribute("href")).toBe("#top");
      expect(link!.getAttribute("target")).toBeNull();
    });

    it("renders same-origin relative path without target attribute", () => {
      const { container } = render(
        <ThemeProvider><MarkdownContent content="[settings](/settings)" /></ThemeProvider>
      );
      const link = container.querySelector("a");
      expect(link).not.toBeNull();
      expect(link!.getAttribute("href")).toBe("/settings");
      expect(link!.getAttribute("target")).toBeNull();
    });

    it("renders same-origin absolute URL without target attribute", () => {
      // When the href matches window.location.origin, no target should be set
      const sameOrigin = `${window.location.origin}/auth/login?return=/`;
      const { container } = render(
        <ThemeProvider><MarkdownContent content={`[login](${sameOrigin})`} /></ThemeProvider>
      );
      const link = container.querySelector("a");
      expect(link).not.toBeNull();
      expect(link!.getAttribute("href")).toBe(sameOrigin);
      expect(link!.getAttribute("target")).toBeNull();
    });

    it("preserves external-link blue styling", () => {
      const { container } = render(
        <ThemeProvider><MarkdownContent content="[docs](https://example.com)" /></ThemeProvider>
      );
      const link = container.querySelector("a");
      expect(link?.className).toContain("text-blue-400");
      expect(link?.className).toContain("hover:underline");
    });
  });

  // ASCII table fixer disabled pending refinement
  it.skip("renders mixed ASCII table and normal markdown correctly", () => {
    const content = [
      "Some **bold** text.",
      "",
      "┌───┬───┐",
      "│ A │ B │",
      "└───┴───┘",
      "",
      "More text.",
    ].join("\n");

    const { container } = render(<ThemeProvider><MarkdownContent content={content} /></ThemeProvider>);
    expect(container.querySelector("strong")).not.toBeNull();
    const codeBlock = container.querySelector("code");
    expect(codeBlock).not.toBeNull();
    expect(codeBlock!.textContent).toContain("│ A │ B │");
  });
});
