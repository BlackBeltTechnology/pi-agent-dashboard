/**
 * Ordinal stamping parity between the rendered markdown and the apply-fix
 * locator. See change: add-preview-apply-fix-to-file (test-plan E11, E12).
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { locateMermaidBlock, verifyMermaidBlock } from "../../lib/preview/mermaid-block-locator.js";

const seen: Array<{ code: string; ordinal: number | undefined }> = [];
vi.mock("../preview/MermaidBlock.js", () => ({
  MermaidBlock: ({ code, ordinal }: { code: string; ordinal?: number }) => {
    seen.push({ code, ordinal });
    return <div data-testid="mmd" />;
  },
}));

import { MarkdownContent } from "../preview/MarkdownContent.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

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
afterEach(() => {
  cleanup();
  seen.length = 0;
});

const renderMd = (content: string) =>
  render(
    <ThemeProvider>
      <MarkdownContent content={content} />
    </ThemeProvider>,
  );

describe("remarkMermaidOrdinal ↔ locator parity", () => {
  it("E11: fences get ordinals 0..n in locator order; a raw-HTML block gets none", async () => {
    const md = [
      "```mermaid\nA-->B\n```",
      "",
      "```js\nconst x = 1;\n```",
      "",
      '<pre><code class="language-mermaid">RAW-->HTML</code></pre>',
      "",
      "- item\n\n  ```mermaid\n  C-->D\n  ```",
      "",
      "~~~mermaid\nE-->F\n~~~",
      "",
    ].join("\n");
    renderMd(md);
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(4));
    const byCode = new Map(seen.map((s) => [s.code, s.ordinal]));
    expect(byCode.get("A-->B")).toBe(0);
    expect(byCode.get("C-->D")).toBe(1);
    expect(byCode.get("E-->F")).toBe(2);
    expect(byCode.get("RAW-->HTML")).toBeUndefined();
    // Locator agrees on ordinal → source for every stamped block.
    for (const { code, ordinal } of seen) {
      if (ordinal === undefined) continue;
      const loc = locateMermaidBlock(md, "md", ordinal);
      expect(loc.ok && verifyMermaidBlock(loc, code), `ordinal ${ordinal}`).toBe(true);
    }
    expect(locateMermaidBlock(md, "md", 0).ok && (locateMermaidBlock(md, "md", 0) as { count: number }).count).toBe(3);
  });

  it("E12: entity-looking and HTML-looking fence content renders byte-identical to the located value", async () => {
    const bodies = ["A -->|a &gt; b &amp; c| B", "A --> B<br>C", "A[\"x < y > z\"] --> B"];
    const md = bodies.map((b) => `\`\`\`mermaid\n${b}\n\`\`\``).join("\n\n");
    renderMd(md);
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(3));
    for (const { code, ordinal } of seen) {
      expect(ordinal).toBeDefined();
      const loc = locateMermaidBlock(md, "md", ordinal as number);
      expect(loc.ok && loc.value).toBe(code);
      expect(loc.ok && verifyMermaidBlock(loc, code)).toBe(true);
    }
  });

  it("a raw-HTML block cannot forge an ordinal", async () => {
    const md = [
      "```mermaid\nREAL\n```",
      "",
      '<pre><code class="language-mermaid" data-mermaid-ordinal="0">FORGED</code></pre>',
      '<pre><code class="language-mermaid" data-mermaid-ordinal="abc:0">FORGED2</code></pre>',
      "",
    ].join("\n");
    renderMd(md);
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(3));
    const byCode = new Map(seen.map((s) => [s.code, s.ordinal]));
    expect(byCode.get("REAL")).toBe(0);
    expect(byCode.get("FORGED")).toBeUndefined();
    expect(byCode.get("FORGED2")).toBeUndefined();
  });
});
