import { describe, it, expect, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { CtxToolRenderer } from "../CtxToolRenderer.js";
import type { ToolContext } from "../index.js";
import { ctxFixtures as fx } from "../parse-ctx-result.fixtures.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";

const ctx: ToolContext = { cwd: "/r" };

// jsdom has no matchMedia; ThemeProvider's useTheme reads it for system theme.
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

function renderCtx(props: Parameters<typeof CtxToolRenderer>[0]) {
  return render(
    <ThemeProvider>
      <CtxToolRenderer {...props} />
    </ThemeProvider>,
  );
}

describe("CtxToolRenderer — header chip + body per kind", () => {
  it("execute: renders args.code as a code block, NOT JSON.stringify(args)", () => {
    const { container } = renderCtx({
      toolName: "ctx_execute",
      args: { language: "shell", code: "ls -la /tmp" },
      status: "complete",
      result: fx.execute_stdout,
      context: ctx,
    });
    const text = container.textContent ?? "";
    expect(text).toContain("ls -la /tmp"); // the code arg
    expect(text).not.toContain('"language": "shell"'); // no JSON dump
    expect(text).toMatch(/⚙ shell/); // header chip
  });

  it("execute_file: renders the path header", () => {
    const { container } = renderCtx({
      toolName: "ctx_execute_file",
      args: { path: "/tmp/foo.ts", language: "typescript", code: "const a = 1" },
      status: "complete",
      result: fx.execute_file_stdout,
      context: ctx,
    });
    expect(container.textContent).toContain("/tmp/foo.ts");
  });

  it("batch: chip shows cmds/sections/queries and section list renders", () => {
    const { container } = renderCtx({
      toolName: "ctx_batch_execute",
      args: { commands: [], queries: [] },
      status: "complete",
      result: fx.batch,
      context: ctx,
    });
    expect(container.textContent).toMatch(/6 cmds · 31 sections · 5 queries/);
    expect(container.textContent).toContain("Indexed Sections");
  });

  it("search: chip shows query count", () => {
    const { container } = renderCtx({
      toolName: "ctx_search",
      args: { queries: ["a", "b"] },
      status: "complete",
      result: fx.search,
      context: ctx,
    });
    expect(container.textContent).toMatch(/🔍 \d+ quer/);
  });

  it("search no-results: renders a 'No results found' indicator", () => {
    const { container } = renderCtx({
      toolName: "ctx_search",
      args: { queries: [] },
      status: "complete",
      result: fx.search_no_results,
      context: ctx,
    });
    // accordion titles render; expand state hidden, but the query titles render
    expect(container.textContent).toContain("remove pi core agent legacy fork");
  });

  it("index: compact one-liner with section count + source, no code block", () => {
    const { container } = renderCtx({
      toolName: "ctx_index",
      args: { source: "docs/" },
      status: "complete",
      result: fx.index,
      context: ctx,
    });
    expect(container.textContent).toMatch(/830 sections/);
    expect(container.textContent).toContain("docs/");
    expect(container.querySelector("ul")).toBeNull();
  });

  it("fetch: shows section count, source, and url", () => {
    const { container } = renderCtx({
      toolName: "ctx_fetch_and_index",
      args: { url: "https://raw.githubusercontent.com/x/y" },
      status: "complete",
      result: fx.fetch,
      context: ctx,
    });
    expect(container.textContent).toContain("145 sections");
    expect(container.textContent).toContain("openspec-workflows");
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toContain("raw.githubusercontent.com");
  });

  it("insight: renders a link to the dashboard url", () => {
    const { container } = renderCtx({
      toolName: "ctx_insight",
      args: {},
      status: "complete",
      result: fx.insight,
      context: ctx,
    });
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("http://localhost:4747");
  });
});

describe("CtxToolRenderer — running-state preview", () => {
  it("batch running: chip is args-derived and differs from the tool-name subtitle", () => {
    const { container } = renderCtx({
      toolName: "ctx_batch_execute",
      args: {
        commands: [
          { label: "a", command: "echo a" },
          { label: "b", command: "echo b" },
          { label: "c", command: "echo c" },
        ],
      },
      status: "running",
      result: "",
      context: ctx,
    });
    const chip = container.querySelector("span");
    expect(chip?.textContent).toBe("▦ 3 cmds");
    // subtitle still shows the tool name, but the chip does NOT equal it
    expect(chip?.textContent).not.toBe("ctx_batch_execute");
    expect(container.textContent).toContain("ctx_batch_execute"); // subtitle present
  });

  it("batch running: lists each command label", () => {
    const { container } = renderCtx({
      toolName: "ctx_batch_execute",
      args: {
        commands: [
          { label: "build", command: "npm run build" },
          { label: "test", command: "npm test" },
        ],
      },
      status: "running",
      result: "",
      context: ctx,
    });
    expect(container.textContent).toContain("build");
    expect(container.textContent).toContain("test");
    expect(container.textContent).toContain("npm run build");
  });

  it("execute running: chip shows language and body shows the code", () => {
    const { container } = renderCtx({
      toolName: "ctx_execute",
      args: { language: "javascript", code: "console.log(42)" },
      status: "running",
      result: "",
      context: ctx,
    });
    expect(container.textContent).toMatch(/⚙ javascript/);
    expect(container.textContent).toContain("console.log(42)");
  });

  it("search running: chip shows query count and body lists queries", () => {
    const { container } = renderCtx({
      toolName: "ctx_search",
      args: { queries: ["first query", "second query"] },
      status: "running",
      result: "",
      context: ctx,
    });
    expect(container.textContent).toMatch(/🔍 2 queries/);
    expect(container.textContent).toContain("first query");
    expect(container.textContent).toContain("second query");
  });
});

describe("CtxToolRenderer — error variants", () => {
  it("validation error renders error card with collapsible Received arguments", () => {
    const { container } = renderCtx({
      toolName: "ctx_execute",
      args: {},
      status: "error",
      result: fx.err_validation,
      context: ctx,
    });
    expect(container.textContent).toMatch(/validation error/i);
    expect(container.textContent).toContain("Received arguments");
    expect(container.textContent).toContain("must have required properties code");
  });

  it("timeout error renders error card", () => {
    const { container } = renderCtx({
      toolName: "ctx_execute",
      args: {},
      status: "error",
      result: fx.err_timeout,
      context: ctx,
    });
    expect(container.textContent).toMatch(/timeout error/i);
  });

  // ── repair-tool-error-surfaces: severity on the chrome, structure in the body ──
  const errCard = (result: string) =>
    renderCtx({ toolName: "ctx_execute", args: {}, status: "error", result, context: ctx });

  it("the container carries the severity signal and the body does not", () => {
    const { container } = errCard(fx.err_runtime_plain);
    const card = container.querySelector("div.rounded.border") as HTMLElement;
    expect(card.className).toContain("bg-[var(--severity-error-bg)]");
    expect(card.className).toContain("border-[var(--severity-error-border)]");
    // The label is the third redundant channel alongside fill + border.
    const label = container.querySelector("div.uppercase") as HTMLElement;
    expect(label.className).toContain("text-[var(--severity-error-fg)]");
    // The body is code-coloured — no severity class, no raw red literal.
    const body = container.querySelector("pre") as HTMLElement;
    expect(body.className).toContain("text-[var(--text-secondary)]");
    expect(body.className).toContain("bg-[var(--bg-code)]");
    expect(body.className).not.toMatch(/severity|red-\d{3}/);
  });

  it("a structured runtime error renders sections, not raw fence/label text", () => {
    const { container } = errCard(fx.err_runtime_fenced);
    const text = container.textContent ?? "";
    expect(text).toContain("npm run test:e2e"); // the command, via CodeBlock
    expect(text).toContain("exit 1"); // the badge
    expect(text).toContain("stdout");
    expect(text).toContain("stderr");
    expect(text).not.toContain("```");
    expect(text).not.toContain("Exit code:");
  });

  it("an unstructured runtime error falls back to the flat message, verbatim", () => {
    const { container } = errCard(fx.err_runtime_plain);
    expect(container.textContent).toContain(fx.err_runtime_plain);
    expect(container.textContent).not.toContain("exit ");
  });
});

describe("CtxToolRenderer — noise + raw fallback", () => {
  it("strips the upgrade banner from rendered bodies", () => {
    const { container } = renderCtx({
      toolName: "ctx_index",
      args: {},
      status: "complete",
      result: fx.index_with_banner,
      context: ctx,
    });
    expect(container.textContent).not.toMatch(/context-mode v/);
    expect(container.textContent).toMatch(/830 sections/);
  });

  it("malformed result renders raw fallback with header chip, no crash", () => {
    const { container } = renderCtx({
      toolName: "ctx_batch_execute",
      args: { commands: [] },
      status: "complete",
      result: "garbage output with no header",
      context: ctx,
    });
    expect(container.textContent).toContain("garbage output with no header");
    // header chip still present (tool name fallback)
    expect(container.textContent).toContain("ctx_batch_execute");
  });

  it("unmapped ctx_* tool renders raw card without JSON args dump", () => {
    const { container } = renderCtx({
      toolName: "ctx_stats",
      args: { foo: "bar" },
      status: "complete",
      result: "some stats output",
      context: ctx,
    });
    expect(container.textContent).toContain("some stats output");
    expect(container.textContent).not.toContain('"foo": "bar"');
  });
});
