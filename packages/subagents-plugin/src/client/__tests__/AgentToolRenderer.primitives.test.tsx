/**
 * The moved `AgentToolRenderer` reads every host surface through the UI
 * primitive registry — no import from `packages/client`, one shared definition
 * of the formatting helpers (test-plan #E36).
 *
 * @structural-pin the renderer must not import packages/client and the formatting helpers must have one shared definition; both are properties of the source text, not of rendered output
 *
 * See change: decouple-plugins-from-core (tasks 4.3, 4.4).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentToolRenderer, HOST_PRIMITIVES, withHostPrimitives } from "./agent-test-harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../..");
const rendererPath = path.resolve(here, "../AgentToolRenderer.tsx");

afterEach(cleanup);

describe("AgentToolRenderer — host surfaces via ui: primitives (E36)", () => {
  it("imports nothing from packages/client (relative, alias or package name)", () => {
    const src = fs.readFileSync(rendererPath, "utf8");
    const specifiers = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    const offenders = specifiers.filter((s) => /packages\/client\/|pi-dashboard-web|(^|\/)\.\.\/\.\.\/(lib|components|hooks)\//.test(s));
    expect(offenders).toEqual([]);
    // The only client-utils import is the pure minimal-chat sentence helper.
    expect(specifiers.filter((s) => s.includes("client-utils"))).toEqual([
      "@blackbelt-technology/pi-dashboard-client-utils/minimal-chat",
    ]);
  });

  it("renders its card through ui:agent-card with activity / prompt / result as children", () => {
    const Card = vi.fn(({ name, status, children }: { name: string; status: string; children?: React.ReactNode }) => (
      <section data-testid="spy-card" data-name={name} data-status={status}>{children}</section>
    ));
    const view = (status: string, toolDetails: Record<string, unknown>, result?: string) =>
      render(
        withHostPrimitives(
          <AgentToolRenderer
            toolName="Agent"
            args={{ subagent_type: "Explore", description: "find", prompt: "PROMPT_TEXT" }}
            status={status as "running"}
            result={result}
            toolDetails={toolDetails}
          />,
          { "ui:agent-card": Card as never },
        ),
      );

    view("running", { status: "running", displayName: "explorer", activity: "ACTIVITY_TEXT" });
    expect(Card).toHaveBeenCalled();
    const card = screen.getByTestId("spy-card");
    expect(card.getAttribute("data-status")).toBe("running");
    expect(card.textContent).toContain("ACTIVITY_TEXT");
    expect(card.textContent).toContain("PROMPT_TEXT");
    cleanup();

    view("complete", { status: "completed", displayName: "explorer" }, "RESULT_TEXT");
    expect(screen.getByTestId("spy-card").getAttribute("data-status")).toBe("complete");
    expect(screen.getByTestId("spy-card").textContent).toContain("RESULT_TEXT");
  });

  it("formats the elapsed duration through ui:format-duration", () => {
    const formatDuration = vi.fn((ms: number) => `FMT(${ms})`);
    render(
      withHostPrimitives(
        <AgentToolRenderer toolName="Agent" args={{}} status="complete" toolDetails={{ status: "completed", durationMs: 4321 }} />,
        { "ui:format-duration": formatDuration },
      ),
    );
    expect(formatDuration).toHaveBeenCalledWith(4321);
    expect(screen.getByText("FMT(4321)")).toBeTruthy();
  });

  it("the harness primitives cover every key the renderer reads (a missing one would throw)", () => {
    expect(Object.keys(HOST_PRIMITIVES).sort()).toEqual([
      "ui:agent-card",
      "ui:dialog",
      "ui:elapsed-badge",
      "ui:format-duration",
      "ui:markdown-content",
    ]);
  });

  it("agent-card formatTokens / formatDuration have one shared definition; no plugin redefines them", () => {
    // (The shell's `lib/util/format.ts` has an unrelated token-stats `formatTokens`; the
    // requirement covers the agent-card helpers every agent card consumer shares.)
    const files = execFileSync("git", ["ls-files", "packages/*-plugin/src/*.ts", "packages/*-plugin/src/*.tsx", "packages/client-utils/src/*.ts"], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => f && !/__tests__|\.test\./.test(f));
    for (const name of ["formatTokens", "formatDuration"]) {
      const defRe = new RegExp(String.raw`(?:function|const)\s+${name}\b\s*(?:\(|=\s*\()`);
      const defs = files.filter((f) => defRe.test(fs.readFileSync(path.join(repoRoot, f), "utf8")));
      expect(defs, `${name} definitions`).toEqual(["packages/client-utils/src/agent-card-utils.ts"]);
    }
  });
});
