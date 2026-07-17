import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { OpenSpecArtifactDialog } from "../OpenSpecArtifactDialog.js";
import { ArtifactLetters } from "../openspec-helpers.js";

beforeEach(() => {
  // The reader hook fires a fetch on mount (rules-of-hooks); in the not-found
  // branch its output is masked, but stub fetch so no real network is hit and
  // any "Failed to fetch" the reader might surface can only come from a real
  // resolution (which must NOT leak into the not-found dialog).
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
    json: () => Promise.resolve({ success: false, error: "Failed to fetch file" }),
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mapWith(changeNames: string[]): Map<string, OpenSpecData> {
  return new Map([[
    "/w",
    {
      initialized: true,
      pending: false,
      hasOpenspecDir: true,
      changes: changeNames.map((name) => ({
        name,
        status: "in-progress" as const,
        completedTasks: 0,
        totalTasks: 1,
        artifacts: [{ id: "proposal", status: "done" as const }],
      })),
    },
  ]]);
}

describe("OpenSpecArtifactDialog — not-found (X2)", () => {
  it("shows a dedicated not-found message, NOT the reader's generic fetch error", () => {
    // Populated map (entry present for /w) but "ch" is absent → not-found,
    // not cold-load.
    render(
      <OpenSpecArtifactDialog
        cwd="/w"
        changeName="ch"
        initialArtifact="proposal"
        openspecMap={mapWith(["some-other-change"])}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/No OpenSpec change named "ch" in this folder\./)).toBeTruthy();
    expect(screen.queryByText(/Failed to fetch/i)).toBeNull();
  });

  it("renders inside the flush dialog frame (testId present)", () => {
    render(
      <OpenSpecArtifactDialog
        cwd="/w"
        changeName="ch"
        initialArtifact="proposal"
        openspecMap={mapWith([])}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("openspec-artifact-dialog")).toBeTruthy();
  });
});

describe("artifact badge letter cursor hint (F8)", () => {
  it("each badge letter carries the pointer-cursor affordance", () => {
    render(
      <ArtifactLetters
        artifacts={[{ id: "proposal", status: "done" }, { id: "design", status: "ready" }]}
        changeName="ch"
      />,
    );
    const letters = screen.getAllByTestId("artifact-letter");
    expect(letters.length).toBe(2);
    for (const el of letters) expect(el.className).toContain("cursor-pointer");
  });
});
