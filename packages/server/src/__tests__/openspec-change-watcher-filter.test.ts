/**
 * Filter regex for OpenSpecChangeWatcher — guards against polling on
 * irrelevant filesystem events (README.md, .openspec.yaml, dotfiles, etc).
 *
 * See change: fix-openspec-taskcheck-delay.
 */
import { describe, it, expect } from "vitest";
import { matchesOpenSpecArtifact } from "../openspec/openspec-change-watcher.js";

describe("matchesOpenSpecArtifact", () => {
  const positives = [
    "my-change/tasks.md",
    "my-change/proposal.md",
    "my-change/design.md",
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
    "my-change/.openspec.yaml",        // config file
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
