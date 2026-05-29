import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { BashToolRenderer } from "../BashToolRenderer.js";
import type { ToolContext } from "../index.js";

const ctx: ToolContext = { editors: [] };

describe("BashToolRenderer", () => {
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
