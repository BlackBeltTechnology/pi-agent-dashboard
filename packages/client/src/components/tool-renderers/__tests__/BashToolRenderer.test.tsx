import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { BashToolRenderer } from "../BashToolRenderer.js";
import type { ToolContext } from "../index.js";

const ctx: ToolContext = { cwd: "/r", editors: [] };

describe("BashToolRenderer", () => {
  it("linkifies a file reference inside the result block", () => {
    const { container } = render(
      <BashToolRenderer
        toolName="bash"
        args={{ command: "tsc" }}
        status="complete"
        result="src/foo.ts:42:7: error TS2322"
        context={ctx}
      />,
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe("src/foo.ts:42:7");
  });

  it("linkifies a URL inside the result block as a target=_blank anchor", () => {
    const { container } = render(
      <BashToolRenderer
        toolName="bash"
        args={{ command: "curl" }}
        status="complete"
        result="reached https://example.com/path"
        context={ctx}
      />,
    );
    const anchors = container.querySelectorAll("a");
    expect(anchors.length).toBe(1);
    expect(anchors[0].getAttribute("href")).toBe("https://example.com/path");
    expect(anchors[0].getAttribute("target")).toBe("_blank");
    expect(anchors[0].getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("strips ANSI escapes before linkification", () => {
    // Red-coloured `src/foo.ts:42` wrapped in CSI codes — link MUST still detect.
    const ansiResult = "\x1B[31msrc/foo.ts:42\x1B[0m: error";
    const { container } = render(
      <BashToolRenderer
        toolName="bash"
        args={{ command: "x" }}
        status="complete"
        result={ansiResult}
        context={ctx}
      />,
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe("src/foo.ts:42");
  });

  it("renders the full command without the truncate class (wraps long commands)", () => {
    const longCommand =
      "test -e openspec/changes/archive/2026-05-28-bump-pi-compat-to-0-75/proposal.md && echo ok";
    const { container } = render(
      <BashToolRenderer
        toolName="bash"
        args={{ command: longCommand }}
        status="complete"
        context={ctx}
      />,
    );
    const commandSpan = container.querySelector("span.font-mono.whitespace-pre-wrap");
    expect(commandSpan).not.toBeNull();
    expect(commandSpan!.textContent).toBe(longCommand);
    // Must NOT carry the truncate class — the whole point of this change.
    expect(commandSpan!.className).not.toMatch(/\btruncate\b/);
    expect(commandSpan!.className).toMatch(/\bwhitespace-pre-wrap\b/);
    expect(commandSpan!.className).toMatch(/\bbreak-all\b/);
  });
});
