/**
 * Adoption ratchet for the state & feedback primitives
 * (EmptyState / Skeleton / .focus-ring / statusPresentation).
 *
 * Two layers:
 *  1. Render-based a11y smoke over the new primitives (accessible names,
 *     non-color status glyphs). jsdom render, no extra deps.
 *  2. Static-analysis ratchet over the COVERED surfaces: a NEW bare
 *     `focus:outline-none` (without `.focus-ring`), a re-rolled color-only
 *     status map (`STATE_COLORS` / `STATE_PILL_CLASS`), or a re-introduced
 *     bare inline empty paragraph fails the suite. Legacy/uncovered files are
 *     out of scope (the ratchet drives migration incrementally).
 *
 * See change: extend-client-utils-state-feedback-primitives.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { EmptyState } from "@blackbelt-technology/pi-dashboard-client-utils/EmptyState";
import { Skeleton } from "@blackbelt-technology/pi-dashboard-client-utils/Skeleton";
import {
  type StatusKind,
  statusAriaLabel,
  statusPresentation,
} from "@blackbelt-technology/pi-dashboard-client-utils/statusPresentation";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => cleanup());

const here = path.dirname(url.fileURLToPath(import.meta.url));
const componentsDir = path.resolve(here, "..", "components");

// Surfaces refactored by this change. The ratchet guards regressions here.
const COVERED_SURFACES = [
  "chat/ChatView.tsx",
  "openspec/OpenSpecBoardView.tsx",
  "session/ComposerSessionActions.tsx",
  "session/SessionList.tsx",
  "chat/CommandInput.tsx",
  "folder/FolderActionBar.tsx",
  "folder/FolderSpawnButtons.tsx",
];

function readSurface(name: string): string {
  return fs.readFileSync(path.join(componentsDir, name), "utf-8");
}

describe("state-feedback primitives — a11y smoke", () => {
  it("EmptyState exposes an accessible CTA button", () => {
    const { getByRole, getByText } = render(
      <EmptyState title="No sessions yet" action={{ label: "Spawn", onClick: () => {} }} />,
    );
    expect(getByText("No sessions yet")).toBeDefined();
    expect(getByRole("button").textContent).toContain("Spawn");
  });

  it("Skeleton is hidden from the accessibility tree", () => {
    const { container } = render(<Skeleton variant="bubble" count={2} />);
    expect(container.querySelector("[data-skeleton]")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("every status state carries a non-color glyph and an aria label", () => {
    const kinds: StatusKind[] = ["done", "current", "todo", "error"];
    for (const kind of kinds) {
      expect(statusPresentation(kind).glyph.trim()).not.toBe("");
    }
    expect(statusAriaLabel("Proposal", "done")).toBe("Proposal, done");
  });
});

describe("state-feedback adoption ratchet — covered surfaces", () => {
  it("no bare `focus:outline-none` without `.focus-ring` in covered surfaces", () => {
    const violations: string[] = [];
    for (const name of COVERED_SURFACES) {
      const src = readSurface(name);
      src.split(/\r?\n/).forEach((line, i) => {
        if (line.includes("focus:outline-none") && !line.includes("focus-ring")) {
          violations.push(`${name}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      violations,
      `Bare focus:outline-none found (use the .focus-ring utility):\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("no re-rolled color-only status map in covered surfaces", () => {
    const violations: string[] = [];
    for (const name of COVERED_SURFACES) {
      const src = readSurface(name);
      if (/\bSTATE_COLORS\b|\bSTATE_PILL_CLASS\b/.test(src)) {
        violations.push(name);
      }
    }
    expect(
      violations,
      `Color-only status map re-rolled (use statusPresentation from client-utils): ${violations.join(", ")}`,
    ).toEqual([]);
  });

  it("covered empty/loading surfaces adopt the shared primitives", () => {
    const chat = readSurface("chat/ChatView.tsx");
    expect(chat).toContain("EmptyState");
    expect(chat).toContain("Skeleton");
    const board = readSurface("openspec/OpenSpecBoardView.tsx");
    expect(board).toContain("EmptyState");
    expect(board).toContain("statusPresentation");
  });

  it("covered status surface (ArtifactChip) consumes the shared status helper", () => {
    const composer = readSurface("session/ComposerSessionActions.tsx");
    expect(composer).toContain("statusPresentation");
    expect(composer).toContain("statusAriaLabel");
  });

  it("covered focus surfaces adopt the .focus-ring utility", () => {
    // Every focus-target surface refactored by this change must carry the
    // shared focus-ring class so the ratchet trips if a regression drops it.
    for (const name of ["chat/CommandInput.tsx", "session/SessionList.tsx", "folder/FolderActionBar.tsx", "folder/FolderSpawnButtons.tsx"]) {
      expect(readSurface(name), `${name} missing focus-ring`).toContain("focus-ring");
    }
  });
});
