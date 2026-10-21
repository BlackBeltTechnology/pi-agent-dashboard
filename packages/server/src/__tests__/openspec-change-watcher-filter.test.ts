/**
 * Filter regex for OpenSpecChangeWatcher — guards against polling on
 * irrelevant filesystem events (README.md, .openspec.yaml, dotfiles, etc).
 *
 * See change: fix-openspec-taskcheck-delay.
 */
import { describe, expect, it } from "vitest";
import { matchesOpenSpecArtifact, matchesOpenSpecRootEvent } from "../openspec/openspec-change-watcher.js";

describe("matchesOpenSpecArtifact", () => {
  const positives = [
    "my-change/tasks.md",
    "my-change/proposal.md",
    "my-change/design.md",
    "my-change/.openspec.yaml",        // change metadata (schema / error state)
    "my-change",                       // change dir created / renamed
    "my-change/specs/cap/spec.md",
    "my-change/specs/deep/nested/cap/spec.md",
    "fix-openspec-taskcheck-delay/specs/server-openspec-polling/spec.md",
    // Windows-style separators (Node may emit these on win32)
    "my-change\\tasks.md",
    "my-change\\specs\\cap\\spec.md",
  ];

  const negatives = [
    null,
    undefined,
    "",
    "README.md",                       // top-level — not under a change dir
    "my-change/README.md",             // wrong file at change root
    "archive",                         // the archive container is not a change
    "archive/2026-01-01-old/tasks.md", // archived changes are not polled
    "my-change/notes.txt",             // non-markdown
    "my-change/specs/cap/notes.txt",   // wrong extension under specs
    "my-change/specs/cap/spec.txt",    // wrong extension
    "my-change/tasks.md.bak",          // backup file
    "tasks.md",                        // top-level — outside change dir
    "specs/cap/spec.md",               // top-level — outside change dir
  ];

  it.each(positives)("matches: %s", (input) => {
    expect(matchesOpenSpecArtifact(input as any)).toBe(true);
  });

  it.each(negatives)("rejects: %s", (input) => {
    expect(matchesOpenSpecArtifact(input as any)).toBe(false);
  });
});

describe("matchesOpenSpecArtifact — schema-declared outputs and root events (#E13)", () => {
  const outputs = { known: ["dependencies.yaml", "specs/**/*.md", "plan.md"] };

  it("matches a not-yet-created schema output of a known change", () => {
    expect(matchesOpenSpecArtifact("known/dependencies.yaml", outputs)).toBe(true);
    expect(matchesOpenSpecArtifact("known/plan.md", outputs)).toBe(true);
  });
  it("does not match the same name for an unknown change or without patterns", () => {
    expect(matchesOpenSpecArtifact("other/dependencies.yaml", outputs)).toBe(false);
    expect(matchesOpenSpecArtifact("known/dependencies.yaml")).toBe(false);
  });
  it("README.md under a known change is not an output", () => {
    expect(matchesOpenSpecArtifact("known/README.md", outputs)).toBe(false);
  });
  it("a new change directory (rename event) and an unknown-change proposal.md match", () => {
    expect(matchesOpenSpecArtifact("new-x", outputs, "rename")).toBe(true);
    expect(matchesOpenSpecArtifact("new-x", outputs, "change")).toBe(false); // only its mtime moved
    expect(matchesOpenSpecArtifact("new-x/proposal.md", outputs)).toBe(true);
  });
  it("root events: config.yaml and schemas match; specs/ and others do not", () => {
    expect(matchesOpenSpecRootEvent("config.yaml")).toBe(true);
    expect(matchesOpenSpecRootEvent("schemas")).toBe(true);
    expect(matchesOpenSpecRootEvent("specs")).toBe(false);
    expect(matchesOpenSpecRootEvent("changes")).toBe(false);
    expect(matchesOpenSpecRootEvent(null)).toBe(false);
  });
});
