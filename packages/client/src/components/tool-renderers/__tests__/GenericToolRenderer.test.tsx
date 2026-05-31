import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { GenericToolRenderer } from "../GenericToolRenderer.js";
import type { ToolContext } from "../types.js";

const ctx: ToolContext = { cwd: "/r", editors: [] };

describe("GenericToolRenderer — linkification", () => {
  it("renders two file links for a grep-style result", () => {
    const result = "src/foo.ts:42:7: error\nsrc/bar.ts:9: warning";
    const { container } = render(
      <GenericToolRenderer
        toolName="bash"
        args={{ cmd: "grep" }}
        status="complete"
        result={result}
        context={ctx}
      />,
    );
    // The args JSON pre block also renders, but it contains no file
    // extensions / line suffixes so only the result block contributes links.
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(2);
  });

  it("renders zero links for a `version 1.0.0` sample", () => {
    const { container } = render(
      <GenericToolRenderer
        toolName="bash"
        args={{ cmd: "echo" }}
        status="complete"
        result="installed version 1.0.0 today"
        context={ctx}
      />,
    );
    expect(container.querySelectorAll("button").length).toBe(0);
    expect(container.querySelectorAll("a").length).toBe(0);
  });

  it("leaves args JSON verbatim with no link processing", () => {
    const { container } = render(
      <GenericToolRenderer
        toolName="t"
        args={{ url: "https://example.com/x", file: "src/foo.ts:42" }}
        status="complete"
        context={ctx}
      />,
    );
    // No result → no LinkifiedText, but args JSON pre contains URL-like
    // text. It MUST NOT be linkified.
    expect(container.querySelectorAll("a").length).toBe(0);
    expect(container.querySelectorAll("button").length).toBe(0);
  });
});
