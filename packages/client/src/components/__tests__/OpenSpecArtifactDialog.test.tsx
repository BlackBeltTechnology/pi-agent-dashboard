import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenSpecArtifactDialog } from "../openspec/OpenSpecArtifactDialog.js";
import { ArtifactLetters } from "../openspec/openspec-helpers.js";

// Avoid full markdown rendering (ThemeProvider dependency) — assert on the raw
// content text the reader hands MarkdownPreviewView. Same pattern as
// MarkdownPreviewView.test.tsx.
vi.mock("../preview/MarkdownContent.js", () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="mock-markdown">{content}</div>
  ),
}));

beforeEach(() => {
  // The reader hook fires a fetch on mount (rules-of-hooks). Return a
  // successful markdown file so the cold-load path (X1) can converge to
  // content, and so any "Failed to fetch" seen in the not-found test (X2)
  // could ONLY come from the reader leaking — which must not happen.
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
    json: () => Promise.resolve({ success: true, data: { type: "file", content: "# Loaded artifact body" } }),
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

describe("OpenSpecArtifactDialog — live openspecMap transitions", () => {
  it("X1: cold-load converges — empty map shows loading, then content once the entry arrives", async () => {
    const empty = new Map<string, OpenSpecData>(); // no entry for /w yet
    const { rerender } = render(
      <OpenSpecArtifactDialog
        cwd="/w"
        changeName="e2e-artifact-demo"
        initialArtifact="proposal"
        openspecMap={empty}
        onClose={() => {}}
      />,
    );
    // Waiting-for-replay branch → loading spinner, no crash.
    expect(screen.getByTestId("preview-loading")).toBeTruthy();

    // WS replay populates the entry → dialog converges to artifact content.
    rerender(
      <OpenSpecArtifactDialog
        cwd="/w"
        changeName="e2e-artifact-demo"
        initialArtifact="proposal"
        openspecMap={mapWith(["e2e-artifact-demo"])}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText(/Loaded artifact body/)).toBeTruthy();
  });

  it("X3: change removed mid-dialog flips to not-found without throwing", async () => {
    const { rerender } = render(
      <OpenSpecArtifactDialog
        cwd="/w"
        changeName="e2e-artifact-demo"
        initialArtifact="proposal"
        openspecMap={mapWith(["e2e-artifact-demo"])}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText(/Loaded artifact body/)).toBeTruthy();

    // WS update drops the change from the (still-present) cwd entry.
    rerender(
      <OpenSpecArtifactDialog
        cwd="/w"
        changeName="e2e-artifact-demo"
        initialArtifact="proposal"
        openspecMap={mapWith([])}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/No OpenSpec change named "e2e-artifact-demo" in this folder\./)).toBeTruthy();
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
