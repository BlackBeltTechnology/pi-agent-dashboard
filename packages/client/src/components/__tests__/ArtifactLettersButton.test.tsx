import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { ArtifactLetters, ArtifactLettersButton } from "../openspec/openspec-helpers.js";
import type { OpenSpecArtifact } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

const artifacts: OpenSpecArtifact[] = [
  { id: "proposal", status: "done" },
  { id: "design", status: "ready" },
  { id: "specs", status: "blocked" },
  { id: "tasks", status: "blocked" },
];

describe("ArtifactLettersButton", () => {
  it("renders nothing when artifacts is empty", () => {
    const { container } = render(
      <ArtifactLettersButton artifacts={[]} changeName="x" />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders all letters in a single button", () => {
    render(<ArtifactLettersButton artifacts={artifacts} changeName="my-change" />);
    const btn = screen.getByTestId("artifact-letters-btn");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.textContent).toBe("PDST");
  });

  it("applies status colors to each letter", () => {
    render(<ArtifactLettersButton artifacts={artifacts} changeName="my-change" />);
    const btn = screen.getByTestId("artifact-letters-btn");
    const spans = btn.querySelectorAll("span");
    expect(spans[0].className).toContain("text-green-500");  // done
    expect(spans[1].className).toContain("text-yellow-500"); // ready
    expect(spans[2].className).toContain("text-[var(--text-muted)]"); // blocked
    expect(spans[3].className).toContain("text-[var(--text-muted)]"); // blocked
  });

  it("calls onReadArtifact with proposal on click", () => {
    const handler = vi.fn();
    render(
      <ArtifactLettersButton artifacts={artifacts} changeName="my-change" onReadArtifact={handler} />
    );
    fireEvent.click(screen.getByTestId("artifact-letters-btn"));
    expect(handler).toHaveBeenCalledWith("my-change", "proposal");
  });

  it("does not throw when onReadArtifact is undefined", () => {
    render(<ArtifactLettersButton artifacts={artifacts} changeName="my-change" />);
    expect(() => fireEvent.click(screen.getByTestId("artifact-letters-btn"))).not.toThrow();
  });
});

// #F7 — the pi-spec-driven `dependencies` artifact gets its own letter.
// See change: add-openspec-change-dependencies.
describe("dependencies artifact letter", () => {
  const withDeps: OpenSpecArtifact[] = [
    { id: "proposal", status: "done" },
    { id: "design", status: "done" },
    { id: "specs", status: "done" },
    { id: "tasks", status: "blocked" },
    { id: "dependencies", status: "ready" },
    { id: "zeta", status: "blocked" },
  ];

  it("renders P D S T L and falls back to the first letter for unknown ids", () => {
    render(<ArtifactLettersButton artifacts={withDeps} changeName="c" />);
    expect(screen.getByTestId("artifact-letters-btn").textContent).toBe("PDSTLZ");
  });

  it("the per-letter tooltip names the artifact Dependencies", () => {
    render(<ArtifactLetters artifacts={withDeps} changeName="c" />);
    const letters = screen.getAllByTestId("artifact-letter");
    expect(letters.map((l) => l.textContent)).toEqual(["P", "D", "S", "T", "L", "Z"]);
    expect(letters[4].getAttribute("title")).toBe("Dependencies: ready");
    expect(letters[5].getAttribute("title")).toBe("zeta: blocked");
  });
});
